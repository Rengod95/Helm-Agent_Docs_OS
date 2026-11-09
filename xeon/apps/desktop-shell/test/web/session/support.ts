// 세션 시험의 공용 대역: 실제 Unix 소켓으로 서비스를 흉내 내는 서버, 탭 입력 대역, 기다림, 프레임 읽기.
import { createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import { repeatAsync } from "@fresnel/contracts";
import { isRecord, ownField } from "../../../src/main/lib/narrow.ts";
import { encodeFrame, decodeFrame } from "../../../src/web/session/protocol.ts";
import type { TabSessionInput } from "../../../src/web/session/ports.ts";
import { tempDir } from "../support/fixtures.ts";
import type { EngineConfig } from "../../../src/main/engine/policy.ts";
import { nodeScheduler } from "../../../src/main/lib/scheduler.ts";
import type { TabSessionOptions } from "../../../src/web/session/tab-session.ts";

export const ENCODER: TextEncoder = new TextEncoder();
const DECODER: TextDecoder = new TextDecoder();

export interface RecordedLog {
  readonly lines: string[];
  line(message: string): void;
}

/** 기록하는 앱 로그. 로그 줄이 값(시크릿 포함)을 싣지 않는지 시험이 본다 */
export function recordedLog(): RecordedLog {
  const lines: string[] = [];
  return {
    lines,
    line(message) {
      lines.push(message);
    },
  };
}

/** 조건이 참이 될 때까지 기다린다. `timeoutMs` 안에 참이 되지 않으면 실패다 */
export function waitFor(what: string, condition: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return repeatAsync<void>(async () => {
    if (condition()) return { value: undefined };
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
    return undefined;
  });
}

/** 서비스 소켓 흉내의 연결 하나. 받은 바이트를 모으고, 보낸 바이트와 끊김을 기록한다 */
interface ServiceConnection {
  readonly socket: Socket;
  /** 지금까지 받은 바이트 전부 */
  received(): Uint8Array;
  /** 받은 글(UTF-8) */
  receivedText(): string;
  /** 클라이언트가 연결을 닫았다(`end`) 또는 연결이 끝났다(`close`) */
  closed(): boolean;
  write(bytes: Uint8Array): void;
}

export interface FakeService {
  readonly socketPath: string;
  /** 받아들인 순서대로 */
  readonly connections: ServiceConnection[];
  close(): Promise<void>;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** 임시 폴더의 Unix 소켓에서 듣는 서비스 흉내. 연결을 받아 기록하고 바이트를 보낼 수 있다 */
export async function startFakeService(): Promise<FakeService> {
  const socketPath = path.join(tempDir(), "service.sock");
  const connections: ServiceConnection[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    const parts: Uint8Array[] = [];
    const state = { closed: false };
    socket.on("data", (chunk: Buffer) => {
      parts.push(new Uint8Array(chunk));
    });
    socket.on("end", () => {
      state.closed = true;
    });
    socket.on("close", () => {
      state.closed = true;
    });
    connections.push({
      socket,
      received: () => concat(parts),
      receivedText: () => DECODER.decode(concat(parts)),
      closed: () => state.closed,
      write: (bytes) => {
        socket.write(bytes);
      },
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    socketPath,
    connections,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** 탭 입력 대역. 보낸 텍스트 프레임과 연결 닫기를 기록한다 */
export interface TabHarness {
  readonly input: TabSessionInput;
  /** 보낸 프레임을 해석한 값(보낸 순서) */
  frames(): unknown[];
  /** 보낸 프레임의 글 그대로 */
  texts(): string[];
  /** 연결을 닫으라는 요청(순서대로) */
  closes(): { readonly code: number; readonly reason: string }[];
}

export function tabInput(deviceId = "dev_test"): TabHarness {
  const texts: string[] = [];
  const closes: { code: number; reason: string }[] = [];
  return {
    input: {
      deviceId,
      deviceName: "test device",
      send: (text) => {
        texts.push(text);
      },
      closeConnection: (code, reason) => {
        closes.push({ code, reason });
      },
    },
    frames: () => texts.map((text) => decodeFrame(text)),
    texts: () => [...texts],
    closes: () => [...closes],
  };
}

/** 보낼 클라이언트 프레임을 글로 만든다 */
export function invokeText(id: number, cmd: string, args?: unknown): string {
  return encodeFrame({ t: "invoke", id, cmd, args });
}

/** 해석된 프레임 목록에서 답(`reply`)을 찾는다. 없으면 undefined다 */
export function replyOf(frames: readonly unknown[], id: number): unknown {
  return frames.find(
    (frame) => isRecord(frame) && ownField(frame, "t") === "reply" && ownField(frame, "id") === id,
  );
}

/** 해석된 프레임 목록에서 채널 `id`로 간 바이트의 글(UTF-8)을 이어 붙인다 */
export function channelTextOf(frames: readonly unknown[], id: number): string {
  const parts: Uint8Array[] = [];
  for (const frame of frames) {
    if (!isRecord(frame) || ownField(frame, "t") !== "channel" || ownField(frame, "id") !== id) {
      continue;
    }
    const message = ownField(frame, "message");
    if (message instanceof Uint8Array) parts.push(message);
  }
  return DECODER.decode(concat(parts));
}

/** 프레임 중 채널 `id`가 받은 객체 메시지의 `kind` 목록 */
export function channelKindsOf(frames: readonly unknown[], id: number): unknown[] {
  const kinds: unknown[] = [];
  for (const frame of frames) {
    if (!isRecord(frame) || ownField(frame, "t") !== "channel" || ownField(frame, "id") !== id) {
      continue;
    }
    const message = ownField(frame, "message");
    kinds.push(ownField(message, "kind"));
  }
  return kinds;
}

/** 탭 세션의 옵션. 시계는 실제 시계와 노드 타이머를 쓰고, 종료 시한은 짧게 둔다(멈추는 일을 빨리 드러낸다) */
export function sessionOptions(
  socketPath: string,
  log: RecordedLog,
  config: EngineConfig = { shutdownGraceMs: 300, restartLimit: 0 },
): TabSessionOptions {
  return {
    env: {},
    platform: "darwin",
    arch: "arm64",
    stateDir: tempDir(),
    resources: tempDir(),
    home: tempDir(),
    socketPath,
    clock: { now: () => Date.now(), scheduler: nodeScheduler() },
    config,
    log,
  };
}
