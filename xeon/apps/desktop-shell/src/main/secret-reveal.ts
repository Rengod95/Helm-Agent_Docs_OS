// 값 보기의 로컬 일회용 채널(L4.desktop.spec §4.17, L4.cli.spec §4.7 [결정: 2026-11-12]). 같은 컴퓨터의 서비스 연결에서
// 호스트는 값을 wire로 보내지 않고 이 채널의 소켓에만 쓴다. 셸이 mkdtemp로 0700 폴더를 만들고 그 안에 유닉스 소켓을 연다.
// 경로만 `secret.beginReveal`의 `channel`로 wire에 실린다(값이 아니다). 호스트가 쓰고 닫으면 셸이 EOF까지 읽어 화면에 넘긴다.
// 값은 셸 메모리와 IPC 응답에만 있고 로그에 쓰지 않는다. 시한이 지나거나, 상한을 넘거나, 화면이 닫으면 `null`이고 폴더는 지운다.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import {
  attemptAsync,
  detach,
  rethrow,
  type Scheduler,
  type TimerHandle,
} from "@fresnel/contracts";
import { ShellError } from "./commands.ts";
import type { ShellContext, ShellModule } from "./context.ts";
import { nodeScheduler } from "./lib/scheduler.ts";

/** 호스트가 값을 쓸 때까지 기다리는 시한(ms). 넘으면 이번 열람은 없던 일이다 */
export const REVEAL_WAIT_MS = 60_000;
/** 값의 상한. CLI 열람과 같다(L4.cli.spec §4.7) */
export const REVEAL_MAX_BYTES: number = 64 * 1024;

const FOLDER_PREFIX = "fresnel-reveal-";
const SOCKET_NAME = "reveal.sock";
const UUID_PATTERN: RegExp = /^[0-9a-f-]{36}$/u;

export interface RevealChannelDeps {
  /** 소켓 폴더를 만들 자리. 운영은 `os.tmpdir()`다(macOS는 소켓 경로가 104바이트를 넘지 못한다) */
  readonly root: string;
  readonly scheduler: Scheduler;
  readonly waitMs: number;
  readonly maxBytes: number;
}

export interface OpenedReveal {
  readonly id: string;
  /** 소켓의 절대 경로. 값이 아니다. `secret.beginReveal`의 `channel`로 보낸다 */
  readonly path: string;
}

export interface RevealChannels {
  /** 소켓을 연다. 열린 채널이 이미 있으면 그것을 먼저 닫는다(한 번에 하나) */
  open(): Promise<OpenedReveal>;
  /** 호스트가 쓴 값을 EOF까지 기다려 받는다. 없거나, 시한이 지나거나, 상한을 넘거나, 닫히면 `null`이다 */
  take(id: string): Promise<Uint8Array | null>;
  /** 채널을 닫는다. 기다리던 받기는 `null`로 끝난다. 모르는 `id`면 아무 일도 없다 */
  close(id: string): Promise<void>;
  /** 앱이 끝날 때 열린 채널을 닫는다 */
  closeAll(): Promise<void>;
}

interface OpenChannel {
  readonly id: string;
  readonly done: Promise<Uint8Array | null>;
  /** 한 번만 효과가 있다. 값을 주면 받기가 그 값으로 끝나고, `null`이면 없이 끝난다 */
  readonly finish: (value: Uint8Array | null) => Promise<void>;
}

/** 조각을 한 덩어리로 잇고 조각은 0으로 덮는다 */
function joinAndWipe(chunks: Uint8Array[], total: number): Uint8Array {
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
    chunk.fill(0);
  }
  chunks.length = 0;
  return joined;
}

export function createRevealChannels(deps: RevealChannelDeps): RevealChannels {
  const slot: { current: OpenChannel | null } = { current: null };

  async function openOne(): Promise<OpenedReveal> {
    const previous = slot.current;
    if (previous !== null) await previous.finish(null);
    const made = await attemptAsync(() => mkdtemp(path.join(deps.root, FOLDER_PREFIX)));
    if (!made.ok) throw new ShellError("reveal_unavailable");
    const folder = made.value;
    const socketPath = path.join(folder, SOCKET_NAME);
    const id = randomUUID();
    const done = Promise.withResolvers<Uint8Array | null>();
    const state: {
      finished: boolean;
      total: number;
      chunks: Uint8Array[];
      socket: Socket | null;
      server: Server | null;
      timer: TimerHandle | null;
    } = { finished: false, total: 0, chunks: [], socket: null, server: null, timer: null };
    // 끝내기는 한 번만 한다. 소켓, 서버, 시한을 정리하고 폴더를 지운 뒤 받기를 끝낸다
    const finish = async (value: Uint8Array | null): Promise<void> => {
      if (state.finished) return;
      state.finished = true;
      if (state.timer !== null) deps.scheduler.clearTimeout(state.timer);
      state.timer = null;
      for (const chunk of state.chunks) chunk.fill(0);
      state.chunks.length = 0;
      state.socket?.destroy();
      state.server?.close();
      if (slot.current?.id === id) slot.current = null;
      // 지우지 못한 폴더는 임시 폴더 정리에 맡긴다. 받기는 이미 끝났다
      await attemptAsync(() => rm(folder, { recursive: true, force: true }));
      done.resolve(value);
    };
    const server: Server = createServer((socket) => {
      // 첫 연결만 받는다. 더 오는 연결은 끊는다
      if (state.socket !== null || state.finished) {
        socket.destroy();
        return;
      }
      state.socket = socket;
      socket.on("data", (chunk: Uint8Array) => {
        state.total += chunk.byteLength;
        if (state.total > deps.maxBytes) {
          detach(finish(null), rethrow);
          return;
        }
        // 조각은 풀에서 온 버퍼일 수 있어 복사해 둔다
        state.chunks.push(new Uint8Array(chunk));
      });
      socket.on("end", () => {
        detach(finish(state.total === 0 ? null : joinAndWipe(state.chunks, state.total)), rethrow);
      });
      socket.on("error", () => {
        detach(finish(null), rethrow);
      });
      socket.on("close", () => {
        detach(finish(null), rethrow);
      });
    });
    state.server = server;
    server.on("error", () => {
      detach(finish(null), rethrow);
    });
    const listening = await new Promise<boolean>((resolve) => {
      server.once("error", () => {
        resolve(false);
      });
      server.listen(socketPath, () => {
        resolve(true);
      });
    });
    if (!listening) {
      server.close();
      // 지우지 못한 빈 폴더는 임시 폴더 정리에 맡긴다. 열람은 이미 실패했다
      await attemptAsync(() => rm(folder, { recursive: true, force: true }));
      throw new ShellError("reveal_unavailable");
    }
    state.timer = deps.scheduler.setTimeout(() => {
      detach(finish(null), rethrow);
    }, deps.waitMs);
    slot.current = { id, done: done.promise, finish };
    return { id, path: socketPath };
  }

  return {
    open: openOne,
    async take(id) {
      const current = slot.current;
      if (current === null || current.id !== id) return null;
      return current.done;
    },
    async close(id) {
      const current = slot.current;
      if (current !== null && current.id === id) await current.finish(null);
    },
    async closeAll() {
      const current = slot.current;
      if (current !== null) await current.finish(null);
    },
  };
}

/** 인자는 `{ id }`다. 모양이 맞지 않으면 `bad-request`다 */
function idOf(args: unknown): string {
  if (typeof args === "object" && args !== null && "id" in args) {
    const id: unknown = args.id;
    if (typeof id === "string" && UUID_PATTERN.test(id)) return id;
  }
  throw new ShellError("bad-request");
}

/** 명령 `secret_reveal_open`, `secret_reveal_take`, `secret_reveal_close`를 등록한다. 한 번에 채널 하나다 */
export const secretRevealModule: ShellModule = {
  name: "secret-reveal",
  register(ctx: ShellContext): void {
    const channels = createRevealChannels({
      root: os.tmpdir(),
      scheduler: nodeScheduler(),
      waitMs: REVEAL_WAIT_MS,
      maxBytes: REVEAL_MAX_BYTES,
    });
    ctx.handle("secret_reveal_open", () => channels.open());
    ctx.handle("secret_reveal_take", (_caller, args) => channels.take(idOf(args)));
    ctx.handle("secret_reveal_close", (_caller, args) => channels.close(idOf(args)));
    ctx.onQuit(() => channels.closeAll());
  },
};
