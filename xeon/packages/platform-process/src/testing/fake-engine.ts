import type { Clock, Scheduler, TimerHandle } from "@xeon/contracts";
import { parse, parseJson } from "@xeon/contracts";
import { Type } from "typebox";
import type { Transport } from "@xeon/contracts/wire";
import { createHostShutdownHandler, watchChildLease } from "../lease/child-lease.ts";
import { createProcessShutdown, type ProcessShutdown } from "../lease/shutdown.ts";
import { openProcessStdio, writableFromSink } from "../transport/process-stdio.ts";
import { createStdioTransportWith } from "@xeon/contracts/wire";
import { serveConformanceHost } from "./conformance-host.ts";

// L0.process.plan PR-05 `testing/fake-engine.ts`, L0.process.spec §8 `fakeEngine`.
// 사이드카 시뮬레이터: stdio 전송 + watchChildLease + host.shutdown 처리기 + 지연 가능한 종료 참여자를 가진 자식 엔진.
// 이 파일은 모듈이면서 자식 진입점이다. 직접 실행하면(`bun fake-engine.ts [--participant-delay-ms=N] [--hang] [--timeout-ms=N]`)
// 자기 stdin/stdout으로 서고, 진단은 stderr에 JSON 한 줄씩 쓴다.

export interface FakeEngineConfig {
  /** 종료 참여자가 끝나기까지 걸리는 시간 */
  readonly participantDelayMs: number;
  /** 참 이면 참여자가 끝나지 않는다(시한 초과 시험) */
  readonly hangParticipant: boolean;
  /** l0.process.shutdown.timeoutMs */
  readonly shutdownTimeoutMs: number;
}

export const FAKE_ENGINE_DEFAULTS: FakeEngineConfig = {
  participantDelayMs: 0,
  hangParticipant: false,
  shutdownTimeoutMs: 3000,
};

/** 자식이 stderr에 쓰는 진단 사건 */
export type FakeEngineEvent =
  | { readonly event: "ready"; readonly pid: number }
  | { readonly event: "participant_started"; readonly reason: string }
  | { readonly event: "participant_done" }
  | { readonly event: "exit"; readonly code: number };

export interface FakeEngineDeps {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly exit: (code: number) => never;
  readonly report: (event: FakeEngineEvent) => void;
  readonly config: FakeEngineConfig;
}

export interface FakeEngine {
  readonly transport: Transport;
  readonly shutdown: ProcessShutdown;
}

/** 엔진을 세운다. 호스트 메시지는 적합성 서버(conformance-host)가 처리한다 */
export function runFakeEngine(deps: FakeEngineDeps): FakeEngine {
  const { config, scheduler } = deps;
  const transport = createStdioTransportWith({ readable: deps.readable, writable: deps.writable });
  const shutdown = createProcessShutdown({
    timeoutMs: config.shutdownTimeoutMs,
    clock: deps.clock,
    scheduler,
    exit: (code) => {
      deps.report({ event: "exit", code });
      return deps.exit(code);
    },
  });
  shutdown.onShutdown("fake-engine", async (reason) => {
    deps.report({ event: "participant_started", reason });
    if (config.hangParticipant) {
      await new Promise<never>(() => undefined);
    }
    if (config.participantDelayMs > 0) {
      await new Promise<void>((resolve) => {
        scheduler.setTimeout(resolve, config.participantDelayMs);
      });
    }
    deps.report({ event: "participant_done" });
  });
  const reportedExit = (code: number): never => {
    deps.report({ event: "exit", code });
    return deps.exit(code);
  };
  watchChildLease(shutdown, { transport, exit: reportedExit });
  serveConformanceHost(transport, {
    onShutdown: createHostShutdownHandler({
      coordinator: shutdown,
      transport,
      scheduler,
      exit: reportedExit,
    }),
  });
  deps.report({ event: "ready", pid: process.pid });
  return { transport, shutdown };
}

// ── 자식 진입점 ──────────────────────────────────────────────────────────

function numberFlag(args: readonly string[], name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  if (found === undefined) return fallback;
  const value = Number(found.slice(prefix.length));
  return Number.isFinite(value) ? value : fallback;
}

export function parseFakeEngineArgs(args: readonly string[]): FakeEngineConfig {
  return {
    participantDelayMs: numberFlag(
      args,
      "participant-delay-ms",
      FAKE_ENGINE_DEFAULTS.participantDelayMs,
    ),
    hangParticipant: args.includes("--hang"),
    shutdownTimeoutMs: numberFlag(args, "timeout-ms", FAKE_ENGINE_DEFAULTS.shutdownTimeoutMs),
  };
}

function realScheduler(): Scheduler {
  const timers = new Map<TimerHandle, ReturnType<typeof setTimeout>>();
  const counter = { next: 1 };
  return {
    setTimeout(fn, ms) {
      const handle = counter.next;
      counter.next += 1;
      timers.set(
        handle,
        setTimeout(() => {
          timers.delete(handle);
          fn();
        }, ms),
      );
      return handle;
    },
    clearTimeout(handle) {
      const timer = timers.get(handle);
      if (timer === undefined) return;
      clearTimeout(timer);
      timers.delete(handle);
    },
  };
}

if (import.meta.main) {
  const stdio = openProcessStdio();
  runFakeEngine({
    readable: stdio.readable,
    writable: stdio.writable,
    clock: { now: () => Date.now() },
    scheduler: realScheduler(),
    exit: (code) => process.exit(code),
    report: (event) => {
      process.stderr.write(`${JSON.stringify(event)}\n`);
    },
    config: parseFakeEngineArgs(process.argv.slice(2)),
  });
}

// ── 부모 쪽 실행기 ───────────────────────────────────────────────────────

const FakeEngineEventSchema = Type.Union([
  Type.Object({ event: Type.Literal("ready"), pid: Type.Integer() }),
  Type.Object({ event: Type.Literal("participant_started"), reason: Type.String() }),
  Type.Object({ event: Type.Literal("participant_done") }),
  Type.Object({ event: Type.Literal("exit"), code: Type.Integer() }),
]);

export interface SpawnedFakeEngine {
  readonly pid: number;
  /** 엔진과 이야기하는 클라이언트 쪽 전송 */
  readonly client: Transport;
  /** 지금까지 자식이 stderr로 알린 사건 */
  readonly events: readonly FakeEngineEvent[];
  /** stdin을 닫는다(수명 임대 해제). 부모가 죽는 것과 같은 신호다 */
  closeStdin(): Promise<void>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
}

export interface SpawnFakeEngineOptions {
  readonly config?: Partial<FakeEngineConfig>;
}

function argsFor(config: FakeEngineConfig): string[] {
  return [
    `--participant-delay-ms=${String(config.participantDelayMs)}`,
    `--timeout-ms=${String(config.shutdownTimeoutMs)}`,
    ...(config.hangParticipant ? ["--hang"] : []),
  ];
}

/** 이 파일을 자식 프로세스로 띄운다. 준비 사건(`ready`)이 올 때까지 기다린다 */
export async function spawnFakeEngine(
  options: SpawnFakeEngineOptions = {},
): Promise<SpawnedFakeEngine> {
  const config: FakeEngineConfig = { ...FAKE_ENGINE_DEFAULTS, ...options.config };
  const child = Bun.spawn([process.execPath, import.meta.path, ...argsFor(config)], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const events: FakeEngineEvent[] = [];
  const ready = Promise.withResolvers<void>();
  const decoder = new TextDecoder();
  const pending = { text: "" };
  child.stderr
    .pipeTo(
      new WritableStream<Uint8Array>({
        write(chunk) {
          pending.text += decoder.decode(chunk, { stream: true });
          const lines = pending.text.split("\n");
          pending.text = lines.pop() ?? "";
          for (const line of lines) {
            if (line === "") continue;
            const json = parseJson(line);
            if (!json.ok) continue;
            const parsed = parse(FakeEngineEventSchema, json.value);
            if (!parsed.ok) continue;
            events.push(parsed.value);
            if (parsed.value.event === "ready") ready.resolve();
          }
        },
      }),
    )
    .then(
      () => {
        // stderr가 끝났다. ready 전이면 자식이 준비 사건 없이 끝난 것이다(ready가 이미 풀렸으면 아무 일도 아니다)
        ready.reject(new Error("fake engine exited before ready"));
        return undefined;
      },
      (cause: unknown) => {
        ready.reject(cause);
      },
    );
  await ready.promise;
  const client = createStdioTransportWith({
    readable: child.stdout,
    writable: writableFromSink(child.stdin),
  });
  return {
    pid: child.pid,
    client,
    events,
    async closeStdin() {
      await client.close("lease released");
    },
    kill(signal) {
      child.kill(signal);
    },
    exited: child.exited.then((code) => {
      const signal = child.signalCode;
      return { code, signal: typeof signal === "string" ? signal : null };
    }),
  };
}
