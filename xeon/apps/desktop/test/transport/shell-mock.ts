import { parse, type Result } from "@fresnel/contracts";
import { SecretNameSchema } from "@fresnel/contracts/capabilities";
import type { DesktopIpc, IpcError, RestartOptions } from "../../src/transport/ipc.ts";
import { createDesktopIpc } from "../../src/transport/ipc.ts";
import { createElectronBridge, type FresnelShellApi } from "../../src/shell/electron-bridge.ts";
import type { FakeIpc } from "./fake-ipc.ts";

// 실제 `createDesktopIpc`와 Electron 다리(`createElectronBridge`)를 preload의 `window.fresnelShell` 대역 위에서 돌린다.
// 셸 역할은 `FakeIpc`가 맡고, 이 파일은 셸 명령(engine_*)을 FakeIpc 호출로, FakeIpc의 출력을 채널 메시지로 옮긴다.
// 바이트 명령은 `{ body, headers }`로 오고 세대는 `x-fresnel-epoch` 헤더에서 읽는다(셸 모듈과 같은 모양).

export type Call = { readonly cmd: string; readonly args: unknown };

type Sink = (message: unknown) => void;

/** preload의 `openChannel`과 같이 `{ $channel: 번호 }` 값을 돌려주고, 번호로 메시지를 보낸다 */
function channelHub(): {
  readonly open: (onMessage: Sink) => unknown;
  readonly sinkOf: (value: unknown) => Sink;
} {
  const sinks = new Map<number, Sink>();
  return {
    open: (onMessage) => {
      const id = sinks.size + 1;
      sinks.set(id, onMessage);
      return { $channel: id };
    },
    sinkOf: (value) => {
      const id = isRecord(value) ? value["$channel"] : undefined;
      const sink = typeof id === "number" ? sinks.get(id) : undefined;
      if (sink === undefined) throw new Error("expected a channel value");
      return sink;
    },
  };
}

/** 바이트 명령의 본문과 헤더. 호출 목록에는 본문만 남긴다 */
function bytesIn(args: unknown): Uint8Array {
  const body = field(args, "body");
  if (body instanceof Uint8Array) return body;
  throw new Error("expected a byte command body");
}

function epochHeader(args: unknown): number {
  const headers = field(args, "headers");
  return Number(field(headers, "x-fresnel-epoch"));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function field(args: unknown, name: string): unknown {
  return isRecord(args) ? args[name] : undefined;
}

/** 셸 명령은 문자열 오류 코드로 거부된다. 코드 쪽 `codeOf`가 이 문자열을 읽는다 */
function rejectWith(code: string): Promise<never> {
  // oxlint-disable-next-line prefer-promise-reject-errors -- 셸 명령 오류는 Error가 아니라 문자열로 거부된다 (preload invoke)
  return Promise.reject(code);
}

/** 셸 명령의 결과를 invoke의 값이나 거부로 옮긴다. 명령 오류는 코드 문자열로, 모양이 틀린 오류는 "invalid"로 거부한다 */
function settled<T>(result: Result<T, IpcError>): Promise<T> {
  if (result.ok) return Promise.resolve(result.value);
  return rejectWith(result.error.kind === "command" ? result.error.code : "invalid");
}

/** 셸이 `{kind, ...}` 오류 값으로 거부하면 invoke는 그 값(객체)으로 거부된다 */
export function rejectLikeShell(value: unknown): Promise<never> {
  // oxlint-disable-next-line prefer-promise-reject-errors -- 셸 명령 오류는 Error가 아니라 값 그대로 거부된다 (preload invoke)
  return Promise.reject(value);
}

/** `engine_restart`의 인자를 옵션으로 읽는다. 셸과 같이 boolean이 아닌 값과 빠진 키는 옵션에 없다 */
function restartOptionsOf(args: unknown): RestartOptions {
  const safeMode = field(args, "safeMode");
  const confirmed = field(args, "confirmed");
  return {
    ...(typeof safeMode === "boolean" ? { safeMode } : {}),
    ...(typeof confirmed === "boolean" ? { confirmed } : {}),
  };
}

/** `secret_register`의 본문 `<동작> <이름>\n<값>`을 나눈다. 셸의 `secret_register` 본문 규칙과 같다 */
function entryOf(args: unknown): { name: string; action: string; value: Uint8Array } {
  const body = bytesIn(args);
  const at = body.indexOf(10);
  if (at < 0) throw new Error("secret_register body has no head line");
  const [action = "", name = ""] = new TextDecoder().decode(body.slice(0, at)).split(" ");
  return { name, action, value: body.slice(at + 1) };
}

/** 명령마다 정해진 대답이 아니라 `reply`가 돌려주는 값을 그대로 주는 셸 대역(스키마에 맞지 않는 응답을 시험할 때 쓴다) */
export function rawShellIpc(reply: (command: string) => unknown): DesktopIpc {
  const api: FresnelShellApi = {
    invoke: async (command) => reply(command),
    openChannel: () => ({ $channel: 0 }),
    closeChannel: () => {},
    listen: () => () => {},
  };
  return createDesktopIpc(createElectronBridge(api));
}

export function shellMockIpc(fake: FakeIpc): {
  readonly ipc: DesktopIpc;
  readonly calls: Call[];
  /** 상태 채널에 검사 전의 값을 그대로 보낸다 */
  sendRawState(value: unknown): void;
  /** 연결이 선 뒤 이 명령의 대답을 시험이 정한 값으로 바꾼다 */
  overrideReply(reply: (command: string) => unknown): void;
  readonly dispose: () => void;
} {
  const raw: { state: Sink } = { state: () => {} };
  const calls: Call[] = [];
  const hub = channelHub();
  const replaced: { reply: ((command: string) => unknown) | null } = { reply: null };
  const handle = async (cmd: string, args: unknown): Promise<unknown> => {
    if (cmd === "engine_attach") {
      const sendBytes = hub.sinkOf(field(args, "onBytes"));
      const sendState = hub.sinkOf(field(args, "onState"));
      raw.state = sendState;
      const attached = await fake.ipc.attach(
        (chunk) => {
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
      const written = await fake.ipc.write(epochHeader(args), bytesIn(args));
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
      await fake.ipc.restart(restartOptionsOf(args));
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
    if (cmd === "db_restore") {
      const backupDir = field(args, "backupDir");
      if (typeof backupDir !== "string") throw new Error("db_restore expects a backupDir string");
      const restored = await fake.ipc.dbRestore(backupDir);
      if (!restored.ok) {
        return rejectWith(restored.error.kind === "command" ? restored.error.code : "invalid");
      }
      return restored.value;
    }
    if (cmd === "db_export") {
      const parent = field(args, "parent");
      if (typeof parent !== "string") throw new Error("db_export expects a parent string");
      return settled(await fake.ipc.dbExport(parent));
    }
    if (cmd === "db_usage") return settled(await fake.ipc.dbUsage());
    if (cmd === "db_previous_remove") {
      const name = field(args, "name");
      if (typeof name !== "string") throw new Error("db_previous_remove expects a name string");
      return settled(await fake.ipc.dbPreviousRemove(name));
    }
    if (cmd === "open_data_dir") return settled(await fake.ipc.openDataDir());
    if (cmd === "service_status") return settled(await fake.ipc.serviceStatus());
    if (cmd === "service_ensure") return settled(await fake.ipc.serviceEnsure());
    if (cmd === "service_stop") return settled(await fake.ipc.serviceStop());
    if (cmd === "engine_detach") {
      await fake.ipc.detach(Number(field(args, "epoch")));
      return null;
    }
    throw new Error(`unexpected command ${cmd}`);
  };
  const api: FresnelShellApi = {
    invoke: (command, args) => {
      // 바이트 명령은 호출 목록에 본문(Uint8Array)만 남긴다. 호출이 끝난 뒤 그 버퍼가 0인지 시험이 본다
      calls.push({ cmd: command, args: isByteCommand(command) ? bytesIn(args) : args });
      return replaced.reply === null
        ? handle(command, args)
        : Promise.resolve(replaced.reply(command));
    },
    openChannel: hub.open,
    closeChannel: () => {},
    listen: () => () => {},
  };
  return {
    ipc: createDesktopIpc(createElectronBridge(api)),
    calls,
    sendRawState: (value) => {
      raw.state(value);
    },
    overrideReply: (reply) => {
      replaced.reply = reply;
    },
    dispose: () => {},
  };
}

function isByteCommand(command: string): boolean {
  return command === "engine_write" || command === "secret_register";
}
