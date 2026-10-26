import { Channel } from "@tauri-apps/api/core";
import { parse } from "@xeon/contracts";
import { SecretNameSchema } from "@xeon/contracts/capabilities";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { DesktopIpc } from "../../src/transport/ipc.ts";
import { createTauriIpc } from "../../src/transport/ipc.ts";
import type { FakeIpc } from "./fake-ipc.ts";

// 실제 `createTauriIpc`(invoke, Channel)를 Tauri 쪽 모의(`@tauri-apps/api/mocks`의 mockIPC) 위에서 돌린다.
// 셸 역할은 `FakeIpc`가 맡고, 이 파일은 셸 명령(engine_*)을 FakeIpc 호출로, FakeIpc의 출력을 Channel 메시지로 옮긴다.
// mockIPC는 invoke의 세 번째 인자(헤더 `x-xeon-epoch`)를 콜백에 넘기지 않는다. 세대 검사는 Rust 시험(relay.rs)이 맡고,
// 여기서는 가장 최근 attach의 세대를 쓴다.

export type Call = { readonly cmd: string; readonly args: unknown };

type Internals = {
  runCallback(id: number, data: unknown): void;
};

function internals(): Internals {
  const holder: unknown = Reflect.get(globalThis, "__TAURI_INTERNALS__");
  if (
    typeof holder === "object" &&
    holder !== null &&
    "runCallback" in holder &&
    typeof holder.runCallback === "function"
  ) {
    const run = holder.runCallback;
    return { runCallback: (id, data) => void run.call(holder, id, data) };
  }
  throw new Error("mockIPC did not install __TAURI_INTERNALS__.runCallback");
}

/** 메시지를 번호 붙여 Channel에 전달한다. 번호는 Channel이 순서를 지키는 데 쓴다 */
function sender(channel: Channel): (message: unknown) => void {
  let index = 0;
  return (message) => {
    internals().runCallback(channel.id, { index, message });
    index += 1;
  };
}

function bytesIn(args: unknown): Uint8Array {
  if (args instanceof Uint8Array) return args;
  throw new Error("engine_write expects raw bytes");
}

function field(args: unknown, name: string): unknown {
  return typeof args === "object" && args !== null ? Reflect.get(args, name) : undefined;
}

/** Rust 명령은 문자열 오류로 거부된다(Result<_, String>). 코드 쪽 `codeOf`가 이 문자열을 읽는다 */
function rejectWith(code: string): Promise<never> {
  // oxlint-disable-next-line prefer-promise-reject-errors -- Tauri 명령 오류는 Error가 아니라 문자열로 거부된다 (@tauri-apps/api core.d.ts invoke)
  return Promise.reject(code);
}

/** 셸이 `Result<_, 오류 구조체>`로 거부하면 invoke는 직렬화된 JSON 값(객체)으로 거부된다 */
export function rejectLikeShell(value: unknown): Promise<never> {
  // oxlint-disable-next-line prefer-promise-reject-errors -- Tauri 명령 오류는 Error가 아니라 직렬화된 값으로 거부된다 (@tauri-apps/api core.d.ts invoke)
  return Promise.reject(value);
}

/** `secret_register`의 본문 `<동작> <이름>\n<값>`을 나눈다. 셸(secret_entry.rs `parse_request`)과 같은 규칙이다 */
function entryOf(args: unknown): { name: string; action: string; value: Uint8Array } {
  const body = bytesIn(args);
  const at = body.indexOf(10);
  if (at < 0) throw new Error("secret_register body has no head line");
  const [action = "", name = ""] = new TextDecoder().decode(body.slice(0, at)).split(" ");
  return { name, action, value: body.slice(at + 1) };
}

export function tauriMockIpc(fake: FakeIpc): {
  readonly ipc: DesktopIpc;
  readonly calls: Call[];
  /** 상태 Channel에 검사 전의 값을 그대로 보낸다 */
  sendRawState(value: unknown): void;
  readonly dispose: () => void;
} {
  const raw: { state: (value: unknown) => void } = { state: () => {} };
  // bun에는 window가 없다. Tauri API는 window.__TAURI_INTERNALS__와 window.crypto를 쓴다
  Reflect.set(globalThis, "window", globalThis);
  const calls: Call[] = [];
  mockIPC(async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "engine_attach") {
      const bytes = field(args, "onBytes");
      const state = field(args, "onState");
      if (!(bytes instanceof Channel) || !(state instanceof Channel)) {
        throw new Error("engine_attach expects two channels");
      }
      const sendBytes = sender(bytes);
      const sendState = sender(state);
      raw.state = sendState;
      const attached = await fake.ipc.attach(
        (chunk) => {
          // 실제 셸은 바이트를 ArrayBuffer로 보낸다
          sendBytes(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength));
        },
        (next) => {
          sendState(next);
        },
      );
      if (!attached.ok) {
        return rejectWith(attached.error.kind === "command" ? attached.error.code : "invalid");
      }
      return attached.value;
    }
    if (cmd === "engine_write") {
      const written = await fake.ipc.write(fake.epoch(), bytesIn(args));
      if (!written.ok) {
        return rejectWith(written.error.kind === "command" ? written.error.code : "invalid");
      }
      return null;
    }
    if (cmd === "engine_ack") {
      await fake.ipc.ack(Number(field(args, "epoch")), Number(field(args, "bytes")));
      return null;
    }
    if (cmd === "engine_restart") {
      await fake.ipc.restart();
      return null;
    }
    if (cmd === "secret_register") {
      const entry = entryOf(args);
      const name = parse(SecretNameSchema, entry.name);
      if (!name.ok) return rejectLikeShell({ kind: "bad-request" });
      const registered = await fake.ipc.registerSecret(
        name.value,
        entry.action === "set" ? "set" : "add",
        entry.value,
      );
      // 셸은 오류를 `{kind, ...}` 객체로 거부한다
      return registered.ok ? null : rejectLikeShell(registered.error);
    }
    if (cmd === "engine_detach") {
      await fake.ipc.detach(Number(field(args, "epoch")));
      return null;
    }
    throw new Error(`unexpected command ${cmd}`);
  });
  return {
    ipc: createTauriIpc(),
    calls,
    sendRawState: (value) => {
      raw.state(value);
    },
    dispose: () => {
      clearMocks();
    },
  };
}
