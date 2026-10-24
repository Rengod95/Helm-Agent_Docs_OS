import { createInterface, type Interface } from "node:readline";
import { systemClock } from "@xeon/platform-os";
import { devWireRoundTripOf } from "./dev-mode.ts";
import type { CliDeps, CliIo, CliSignal } from "./io.ts";

// L4.cli.spec §3.4 "최상위 코드". 실제 프로세스(process, Bun)를 직접 쓰는 코드는 이 파일에만 둔다. 테스트는 이 파일을 쓰지 않고
// runCli에 가짜 io·deps를 넣는다(그래서 이 파일은 커버리지 대상에서 제외하는 편이 맞다).

/**
 * 테스트 격리용 상태 파일 덮어쓰기. 운영 경로는 @xeon/host의 resolveHostStatePaths()가 정한 `<OsDirs.state>/cli/state.json`이고
 * 이 변수가 없을 때 그 경로를 쓴다 [결정: review.decisions-2 B-07]
 */
const STATE_FILE_ENV = "XEON_CLI_STATE_FILE";

/** 터미널이 아니면 isTTY는 false가 아니라 undefined다 */
function isTty(stream: { readonly isTTY?: boolean | undefined }): boolean {
  return stream.isTTY ?? false;
}

/** EPIPE도 그대로 거부한다: 호출자가 출력을 멈추고 종료 요청을 보낸다(§4.6) */
async function writeTo(file: typeof Bun.stdout, text: string): Promise<void> {
  await Bun.write(file, text);
}

/** readline이 잡은 Ctrl+C(raw 모드의 \x03)와 프로세스 신호를 같은 처리기로 보낸다(§4.6) */
function createSignals(): {
  onSignal(signal: CliSignal, handler: () => void): () => void;
  fire(signal: CliSignal): void;
} {
  const handlers = new Map<CliSignal, Set<() => void>>();
  const installed = new Set<CliSignal>();
  const fire = (signal: CliSignal): void => {
    for (const handler of Array.from(handlers.get(signal) ?? [])) handler();
  };
  return {
    fire,
    onSignal(signal, handler) {
      const set = handlers.get(signal) ?? new Set<() => void>();
      set.add(handler);
      handlers.set(signal, set);
      if (!installed.has(signal)) {
        installed.add(signal);
        process.on(signal, () => {
          fire(signal);
        });
      }
      return () => {
        set.delete(handler);
      };
    },
  };
}

/**
 * 줄 입력. 줄은 도착하는 대로 큐에 쌓는다: turn이 도는 동안 친 글자(type-ahead)와 파이프로 한꺼번에 들어온 줄이
 * 다음 readLine에서 차례로 나온다. EOF(Ctrl+D)나 닫힘은 null이다.
 */
function createLineReader(
  onSigint: () => void,
): (prompt: string, signal: AbortSignal) => Promise<string | null> {
  const queue: string[] = [];
  const state: {
    rl: Interface | undefined;
    closed: boolean;
    waiter: ((line: string | null) => void) | undefined;
  } = {
    rl: undefined,
    closed: false,
    waiter: undefined,
  };
  const open = (): Interface => {
    if (state.rl !== undefined) return state.rl;
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: isTty(process.stdin),
    });
    rl.on("line", (line) => {
      const waiter = state.waiter;
      if (waiter === undefined) {
        queue.push(line);
        return;
      }
      state.waiter = undefined;
      waiter(line);
    });
    rl.on("close", () => {
      state.closed = true;
      const waiter = state.waiter;
      state.waiter = undefined;
      waiter?.(null);
    });
    rl.on("SIGINT", onSigint);
    state.rl = rl;
    return rl;
  };
  return (prompt, signal) => {
    const queued = queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (state.closed || signal.aborted) return Promise.resolve(null);
    const rl = open();
    return new Promise<string | null>((resolve) => {
      const done = (line: string | null): void => {
        signal.removeEventListener("abort", onAbort);
        resolve(line);
      };
      const onAbort = (): void => {
        if (state.waiter === done) state.waiter = undefined;
        done(null);
      };
      state.waiter = done;
      signal.addEventListener("abort", onAbort, { once: true });
      rl.setPrompt(prompt);
      rl.prompt();
    });
  };
}

export function createRealIo(): CliIo {
  const signals = createSignals();
  return {
    stdin: Bun.stdin.stream(),
    stdout: (text) => writeTo(Bun.stdout, text),
    stderr: (text) => writeTo(Bun.stderr, text),
    terminal: {
      stdinIsTty: isTty(process.stdin),
      stdoutIsTty: isTty(process.stdout),
      columns: process.stdout.isTTY ? process.stdout.columns : null,
    },
    env: process.env,
    cwd: process.cwd(),
    onSignal: (signal, handler) => signals.onSignal(signal, handler),
    readLine: createLineReader(() => {
      signals.fire("SIGINT");
    }),
  };
}

export function createRealDeps(env: Readonly<Record<string, string | undefined>>): CliDeps {
  return {
    // 엔진을 끌어오는 모듈은 부를 때 읽는다: 엔진이 필요 없는 명령(version, help)이 빨리 끝난다
    connect: async (options) => {
      const { connectEngine } = await import("./engine.ts");
      return connectEngine(options);
    },
    runHostCommand: async (command, io) => {
      const { runHostCommand } = await import("@xeon/host");
      return runHostCommand(command, io);
    },
    // 합성 루트의 시계는 L0.os의 운영 시계다(eng.typescript.guide TY-21). 엔진 안의 시각도 같은 구현이 낸다
    clock: systemClock(),
    devWireRoundTrip: devWireRoundTripOf(env, Bun.main),
    bunVersion: Bun.version,
    stateFile: env[STATE_FILE_ENV] ?? null,
  };
}
