import { createInterface, type Interface } from "node:readline";
import { attemptAsync, parseJson } from "@xeon/contracts";
import { systemClock } from "@xeon/platform-os";
import { devWireRoundTripOf } from "./dev-mode.ts";
import type { CliDeps, CliIo, CliSignal, DoctorProbes } from "./io.ts";

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
interface LineReader {
  readLine(prompt: string, signal: AbortSignal): Promise<string | null>;
  setCompleter(complete: (line: string) => readonly string[]): void;
  /** 다른 입력 방식(가려진 입력)이 stdin을 쓰는 동안 readline을 멈춘다 */
  pause(): void;
  resume(): void;
}

function createLineReader(onSigint: () => void): LineReader {
  const queue: string[] = [];
  const state: {
    rl: Interface | undefined;
    closed: boolean;
    waiter: ((line: string | null) => void) | undefined;
    completer: (line: string) => readonly string[];
  } = {
    rl: undefined,
    closed: false,
    waiter: undefined,
    completer: () => [],
  };
  const open = (): Interface => {
    if (state.rl !== undefined) return state.rl;
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: isTty(process.stdin),
      completer: (line: string) => [[...state.completer(line)], line],
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
  return {
    readLine(prompt, signal) {
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
    },
    setCompleter(complete) {
      state.completer = complete;
    },
    pause() {
      state.rl?.pause();
    },
    resume() {
      state.rl?.resume();
    },
  };
}

/** UTF-8 바이트 배열 끝에서 글자 하나를 지운다(백스페이스) */
function dropLastChar(bytes: number[]): void {
  while (bytes.length > 0 && ((bytes.at(-1) ?? 0) & 0xc0) === 0x80) bytes.pop();
  bytes.pop();
}

/**
 * 에코 없는 한 줄 입력을 바이트로 받는다(§4.7). raw 모드에서 바이트를 직접 읽어 문자열을 만들지 않는다.
 * Ctrl+C, Ctrl+D(빈 입력)는 null이다. 쓴 뒤 호출한 쪽이 반환 배열을 0으로 덮는다
 */
function readHiddenBytes(prompt: string, signal: AbortSignal): Promise<Uint8Array | null> {
  const { stdin } = process;
  if (!isTty(stdin) || signal.aborted) return Promise.resolve(null);
  process.stdout.write(prompt);
  return new Promise<Uint8Array | null>((resolve) => {
    const bytes: number[] = [];
    const finish = (result: Uint8Array | null): void => {
      stdin.off("data", onData);
      signal.removeEventListener("abort", onAbort);
      stdin.setRawMode(false);
      stdin.pause();
      bytes.fill(0);
      bytes.length = 0;
      process.stdout.write("\n");
      resolve(result);
    };
    const onAbort = (): void => {
      finish(null);
    };
    function onData(chunk: Buffer): void {
      for (const byte of chunk) {
        if (byte === 0x0d || byte === 0x0a) {
          finish(Uint8Array.from(bytes));
          return;
        }
        if (byte === 0x03 || (byte === 0x04 && bytes.length === 0)) {
          finish(null);
          return;
        }
        if (byte === 0x7f || byte === 0x08) dropLastChar(bytes);
        else bytes.push(byte);
      }
      // 읽은 버퍼에도 값이 있었다: 바로 덮는다
      chunk.fill(0);
    }
    signal.addEventListener("abort", onAbort, { once: true });
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function fileSinkStream(sink: {
  write(chunk: Uint8Array): unknown;
  flush(): unknown;
}): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    async write(chunk) {
      sink.write(chunk);
      await sink.flush();
    },
  });
}

export function createRealIo(): CliIo {
  const signals = createSignals();
  const lines = createLineReader(() => {
    signals.fire("SIGINT");
  });
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
    readLine: (prompt, signal) => lines.readLine(prompt, signal),
    setCompleter: (complete) => {
      lines.setCompleter(complete);
    },
    async readSecret(prompt, signal) {
      lines.pause();
      try {
        return await readHiddenBytes(prompt, signal);
      } finally {
        lines.resume();
      }
    },
    stdoutStream: fileSinkStream(Bun.stdout.writer()),
    stderrStream: fileSinkStream(Bun.stderr.writer()),
  };
}

/** 루프백 후보 하나에 SearXNG 탐침을 보낸다(L2.web.spec §4.8.3). 응답은 64 KiB까지만 읽는다 */
const SEARXNG_PROBE_TIMEOUT_MS = 1500;
const SEARXNG_PROBE_MAX_BYTES = 64 * 1024;

async function probeSearxng(
  baseUrl: string,
  signal: AbortSignal,
): Promise<"ok" | "json-disabled" | "unreachable"> {
  const attempted = await attemptAsync(async () => {
    const response = await fetch(`${baseUrl}/search?q=xeon&format=json&pageno=1`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(SEARXNG_PROBE_TIMEOUT_MS)]),
      redirect: "manual",
    });
    if (response.status === 403) return "json-disabled" as const;
    if (response.status !== 200) return "unreachable" as const;
    const text = (await response.text()).slice(0, SEARXNG_PROBE_MAX_BYTES);
    const body = parseJson(text);
    if (!body.ok || typeof body.value !== "object" || body.value === null) {
      return "unreachable" as const;
    }
    const results: unknown = Reflect.get(body.value, "results");
    const query: unknown = Reflect.get(body.value, "query");
    return Array.isArray(results) && typeof query === "string"
      ? ("ok" as const)
      : ("unreachable" as const);
  });
  // 연결 거부, 시간 초과, 중단은 모두 응답이 없는 것으로 본다. 진단 항목이라 원인을 따로 알리지 않는다
  return attempted.ok ? attempted.value : "unreachable";
}

const REAL_PROBES: DoctorProbes = { probeSearxng };

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
    startStdioHost: async (options) => {
      const { startStdioHost } = await import("@xeon/host");
      return startStdioHost(options);
    },
    resolveRemote: async (options) => {
      const { resolveRemoteEndpoint } = await import("@xeon/host");
      return resolveRemoteEndpoint(options);
    },
    bridgeStdio: async (options) => {
      const { bridgeStdioToService } = await import("@xeon/host");
      return bridgeStdioToService(options);
    },
    probes: REAL_PROBES,
    // 합성 루트의 시계는 L0.os의 운영 시계다(eng.typescript.guide TY-21). 엔진 안의 시각도 같은 구현이 낸다
    clock: systemClock(),
    devWireRoundTrip: devWireRoundTripOf(env, Bun.main),
    bunVersion: Bun.version,
    stateFile: env[STATE_FILE_ENV] ?? null,
  };
}
