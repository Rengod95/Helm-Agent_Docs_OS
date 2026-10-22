import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@xeon/contracts";
import type { JsonRpcMessage, StoreId } from "@xeon/contracts/wire";
import type { AssembleOptions, CommandIo, HostCommand } from "@xeon/host";
import { createHostConnection } from "../../src/host-client.ts";
import type { TerminalFacts } from "../../src/cli/command.ts";
import { createConnectEngine, type ConnectEngine, type HostApi } from "../../src/engine.ts";
import type { ExitCode } from "../../src/exit-codes.ts";
import type { CliDeps, CliIo, CliSignal } from "../../src/io.ts";
import { runCli } from "../../src/main.ts";
import {
  createFakeStore,
  startFakeServer,
  type FakeServer,
  type FakeServerOptions,
} from "./fake-server.ts";
import { storeId } from "./ids.ts";
import { createTransportPair } from "./memory-transport.ts";

// 시험 도구: 가짜 CliIo(출력 수집, 입력 대본, 신호), 가짜 호스트 서버 위에서 도는 connectEngine, 임시 상태 파일.
// 실제 엔진을 쓰지 않는다. 실제 엔진과 모델 테이프는 통합 시험의 몫이다(L4.cli.plan §5.2).

export interface ManualClock {
  now(): number;
  advance(ms: number): void;
}

export function manualClock(start = 1_767_571_200_000): ManualClock {
  const state = { at: start };
  return {
    now: () => state.at,
    advance(ms) {
      state.at += ms;
    },
  };
}

export interface HarnessOptions {
  readonly server?: Partial<FakeServerOptions>;
  readonly terminal?: Partial<TerminalFacts> & { readonly columns?: number | null };
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** stdin 내용. 없으면 빈 스트림 */
  readonly stdin?: string;
  /** 대화형 입력 대본. 끝나면 EOF(null)다 */
  readonly lines?: readonly string[];
  /** false면 XEON_CLI_STATE_FILE 덮어쓰기를 주지 않아 호스트가 정한 기본 위치를 쓴다 */
  readonly stateFile?: boolean;
  /** resolveHostStatePaths 가짜를 바꾼다(상태 디렉터리 오류 시험) */
  readonly resolveStatePaths?: HostApi["resolveHostStatePaths"];
  /** n번째 stdout 쓰기부터 EPIPE로 거부한다 */
  readonly stdoutBreaksAfter?: number;
  readonly cwd?: string;
  readonly devWireRoundTrip?: boolean;
  /** connect를 통째로 바꾼다(시작 실패 시험) */
  readonly connect?: ConnectEngine;
  /** runHostCommand 가짜(config schema, service, host) */
  readonly runHostCommand?: (command: HostCommand, io: CommandIo) => Promise<0 | 1 | 2>;
  readonly readLine?: (prompt: string, signal: AbortSignal) => Promise<string | null>;
}

export interface Harness {
  readonly dir: string;
  /** 덮어쓰기로 넘기는 상태 파일. stateFile: false이면 호스트 기본 위치 {@link defaultStateFile}을 쓴다 */
  readonly stateFile: string;
  /** 가짜 호스트가 덮어쓰기 없이 돌려주는 상태 파일 위치(<state>/cli/state.json) */
  readonly defaultStateFile: string;
  readonly stdout: string[];
  readonly stderr: string[];
  readonly observed: JsonRpcMessage[];
  readonly startOptions: Omit<AssembleOptions, "mode">[];
  readonly clock: ManualClock;
  server(): FakeServer;
  /** 지금까지 서버가 받은 요청의 메서드 이름 */
  methods(): readonly string[];
  /** 다음 실행부터 터미널 사실을 바꾼다 */
  useTerminal(next: HarnessOptions["terminal"]): void;
  /** 다음 실행부터 대화형 입력 대본을 바꾼다 */
  useLines(next: readonly string[]): void;
  /** 다음 연결부터 가짜 서버의 동작을 바꾼다(재개 시험) */
  useServer(options: Partial<FakeServerOptions>): void;
  stdoutText(): string;
  stderrText(): string;
  run(argv: readonly string[]): Promise<ExitCode>;
  signal(name: CliSignal): void;
  closed(): boolean;
  dispose(): void;
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (text.length > 0) controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

export const TEST_STORE_ID: StoreId = storeId(1);

export function createHarness(options: HarnessOptions = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), "xcli-"));
  const stateFile = join(dir, "state", "cli-state.json");
  const defaultStateFile = join(dir, "host-state", "cli", "state.json");
  const stdout: string[] = [];
  const stderr: string[] = [];
  const observed: JsonRpcMessage[] = [];
  const startOptions: Omit<AssembleOptions, "mode">[] = [];
  const clock = manualClock();
  const store = createFakeStore(options.server?.knownThreads);
  const handlers = new Map<CliSignal, Set<() => void>>();
  const script: { lines: string[]; terminal: HarnessOptions["terminal"] } = {
    lines: [...(options.lines ?? [])],
    terminal: options.terminal,
  };
  const state: {
    server: FakeServer | undefined;
    serverOptions: Partial<FakeServerOptions>;
    closed: boolean;
    stdoutWrites: number;
    requestIds: number;
  } = {
    server: undefined,
    serverOptions: { ...options.server },
    closed: false,
    stdoutWrites: 0,
    requestIds: 0,
  };

  const hostApi: HostApi = {
    startInProcessHost(assembleOptions) {
      startOptions.push(assembleOptions ?? {});
      const pair = createTransportPair();
      state.server = startFakeServer(
        pair.server,
        {
          storeId: TEST_STORE_ID,
          settings: { "l4.cli.outputMode": "text" },
          ...state.serverOptions,
        },
        store,
      );
      return Promise.resolve({
        client: pair.client,
        engine: {
          ports: {
            ids: {
              next: () => {
                state.requestIds += 1;
                return `evt_request${state.requestIds}`;
              },
            },
            clock,
          },
        },
        close: async () => {
          state.closed = true;
          await pair.server.close();
        },
      });
    },
    resolveHostStatePaths:
      options.resolveStatePaths ??
      ((resolveOptions) =>
        Promise.resolve(
          ok({
            stateDir: join(dir, "host-state"),
            cliStateFile: resolveOptions?.cliStateFileOverride ?? defaultStateFile,
          }),
        )),
    createHostConnection,
  };

  const io: CliIo = {
    stdin: streamOf(options.stdin ?? ""),
    stdout: (text) => {
      state.stdoutWrites += 1;
      if (
        options.stdoutBreaksAfter !== undefined &&
        state.stdoutWrites > options.stdoutBreaksAfter
      ) {
        return Promise.reject(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      }
      stdout.push(text);
      return Promise.resolve();
    },
    stderr: (text) => {
      stderr.push(text);
      return Promise.resolve();
    },
    get terminal() {
      return {
        stdinIsTty: script.terminal?.stdinIsTty ?? false,
        stdoutIsTty: script.terminal?.stdoutIsTty ?? false,
        columns: script.terminal?.columns ?? null,
      };
    },
    env: options.env ?? {},
    cwd: options.cwd ?? "/work/project",
    onSignal(signal, handler) {
      const set = handlers.get(signal) ?? new Set<() => void>();
      set.add(handler);
      handlers.set(signal, set);
      return () => {
        set.delete(handler);
      };
    },
    readLine: options.readLine ?? (() => Promise.resolve(script.lines.shift() ?? null)),
  };

  const deps: CliDeps = {
    connect:
      options.connect ??
      ((connectOptions) =>
        createConnectEngine(hostApi)({
          ...connectOptions,
          observe: (message) => {
            observed.push(message);
            connectOptions.observe?.(message);
          },
        })),
    runHostCommand: options.runHostCommand ?? (() => Promise.resolve(0)),
    clock,
    devWireRoundTrip: options.devWireRoundTrip ?? false,
    bunVersion: "1.4.3",
    stateFile: options.stateFile === false ? null : stateFile,
  };

  return {
    dir,
    stateFile,
    defaultStateFile,
    stdout,
    stderr,
    observed,
    startOptions,
    clock,
    server() {
      if (state.server === undefined) throw new Error("the fake server has not started yet");
      return state.server;
    },
    methods: () => state.server?.requests.map((request) => request.method) ?? [],
    useTerminal(next) {
      script.terminal = next;
    },
    useLines(next) {
      script.lines = [...next];
    },
    useServer(next) {
      state.serverOptions = { ...state.serverOptions, ...next };
    },
    stdoutText: () => stdout.join(""),
    stderrText: () => stderr.join(""),
    run: (argv) => runCli(argv, io, deps),
    signal(name) {
      for (const handler of Array.from(handlers.get(name) ?? [])) handler();
    },
    closed: () => state.closed,
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 조건이 참이 될 때까지 기다린다(폴링 + 상한, eng.testing.guide TS-03). 고정 지연을 쓰지 않는다 */
export async function waitFor(condition: () => boolean, attempts = 500): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (condition()) return;
    // oxlint-disable-next-line no-await-in-loop -- 폴링: 한 번에 한 번씩 이벤트 루프를 넘긴다 (eng.testing.guide TS-03)
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  throw new Error("waitFor: condition did not become true");
}
