// 엔진 감독자 시험의 대역. 가짜 시계(시간은 `advance`로만 간다), 가짜 launcher(엔진마다 이벤트 대기열과 stdin 기록),
// 기록하는 릴레이 수신 끝, 기록하는 앱 로그다. 실제 프로세스는 띄우지 않는다.
import {
  err,
  ok,
  repeatAsync,
  type Result,
  type Scheduler,
  type TimerHandle,
} from "@fresnel/contracts";
import type { AppLog } from "../../src/main/lib/applog.ts";
import type {
  EngineEvent,
  EngineEvents,
  Launched,
  LaunchFailure,
  Launcher,
  OnceOutput,
} from "../../src/main/engine/launcher.ts";
import type { SafeMode } from "../../src/main/engine/policy.ts";
import type { Sink } from "../../src/main/engine/relay.ts";
import type { EngineState, EngineTarget } from "../../src/main/engine/state.ts";
import type { EngineClock } from "../../src/main/engine/wait.ts";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** 시험 시계의 출발 시각(2026-10-24 UTC) */
const EPOCH_START: number = Date.UTC(2026, 9, 24);

/** 실제 시간으로 한 번 양보한다. 기다리는 비동기 작업이 진행될 만큼 돈다. 가짜 시계는 움직이지 않는다 */
export function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, 0);
  });
}

/** 조건이 참이 될 때까지 양보한다. 오래 참이 되지 않으면 실패다 */
export function until(what: string, condition: () => boolean): Promise<void> {
  let rounds = 0;
  return repeatAsync<void>(async () => {
    if (condition()) return { value: undefined };
    rounds += 1;
    if (rounds > 500) throw new Error(`timed out waiting for ${what}`);
    await flush();
    return undefined;
  });
}

export function enc(text: string): Uint8Array {
  return ENCODER.encode(text);
}

// ---------------------------------------------------------------------------------------------
// 가짜 시계

export interface FakeClock extends EngineClock {
  /** 시간을 `ms`만큼 간다. 그 사이 시한이 된 타이머를 시각 순서대로 부르고, 부른 뒤마다 양보한다 */
  advance(ms: number): Promise<void>;
  /** 아직 기다리는 타이머 수. 시험이 타이머 누수를 본다 */
  pending(): number;
}

interface FakeTimer {
  readonly at: number;
  readonly fn: () => void;
}

export function fakeClock(start: number = EPOCH_START): FakeClock {
  let current = start;
  let nextId = 1;
  const timers = new Map<number, FakeTimer>();
  const scheduler: Scheduler = {
    setTimeout(fn, ms) {
      const handle: TimerHandle = nextId;
      nextId += 1;
      timers.set(handle, { at: current + ms, fn });
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
  };
  /** 한계 시각 안에서 가장 이른 타이머. 같은 시각이면 먼저 만든 것이다 */
  function nextDue(limit: number): { readonly id: number; readonly timer: FakeTimer } | null {
    let best: { readonly id: number; readonly timer: FakeTimer } | null = null;
    for (const [id, timer] of timers) {
      if (timer.at > limit) continue;
      if (
        best === null ||
        timer.at < best.timer.at ||
        (timer.at === best.timer.at && id < best.id)
      ) {
        best = { id, timer };
      }
    }
    return best;
  }
  return {
    now: () => current,
    scheduler,
    pending: () => timers.size,
    async advance(ms) {
      // 먼저 양보해서 방금 시작한 작업이 타이머를 만들게 한다
      await flush();
      const target = current + ms;
      await repeatAsync<void>(async () => {
        const due = nextDue(target);
        if (due === null) {
          current = target;
          return { value: undefined };
        }
        timers.delete(due.id);
        current = due.timer.at;
        due.timer.fn();
        await flush();
        return undefined;
      });
      await flush();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 이벤트 대기열과 자식 엔진

/** 엔진 이벤트를 밀어 넣는 대기열. `events`를 감독자가 읽는다 */
export interface EventQueue {
  readonly events: EngineEvents;
  push(event: EngineEvent): void;
}

function eventQueue(): EventQueue {
  const items: EngineEvent[] = [];
  let wake: (() => void) | null = null;
  return {
    events: {
      next: () =>
        repeatAsync<EngineEvent | null>(async () => {
          const head = items.shift();
          if (head !== undefined) return { value: head };
          await new Promise<void>((resolve) => {
            wake = () => {
              resolve();
            };
          });
          return undefined;
        }),
    },
    push(event) {
      items.push(event);
      const awake = wake;
      wake = null;
      awake?.();
    },
  };
}

/** 미리 정한 이벤트를 차례로 주는 이벤트 원천. 끝나면 null이다 */
export function sourceOf(events: readonly EngineEvent[]): EngineEvents {
  const queue = [...events];
  return {
    next: () => Promise.resolve(queue.shift() ?? null),
  };
}

export interface FakeBehavior {
  /** stdin이 닫히면 엔진이 끝난다(EOF 처리) */
  readonly exitOnEof: boolean;
  /** stdin 쓰기가 `releaseWrites`까지 막힌다 */
  readonly blockWrites: boolean;
  /** 그룹 종료를 받으면 끝난다 */
  readonly dieOnKill: boolean;
}

/** EOF에 끝나는 엔진. 대부분의 시험이 쓴다 */
export const EOF_EXIT: FakeBehavior = { exitOnEof: true, blockWrites: false, dieOnKill: true };

/** 가짜 엔진 하나. stdin 쓰기와 닫기, 그룹 종료를 기록한다 */
export class FakeEngine {
  readonly pid: number;
  private readonly queue: EventQueue = eventQueue();
  private readonly calls: string[];
  private readonly killed: number[];
  private readonly behavior: FakeBehavior;
  private readonly received: string[] = [];
  private gateOpen: boolean;
  private gateWaiters: (() => void)[] = [];
  private closed = false;

  constructor(pid: number, behavior: FakeBehavior, calls: string[], killed: number[]) {
    this.pid = pid;
    this.behavior = behavior;
    this.calls = calls;
    this.killed = killed;
    this.gateOpen = !behavior.blockWrites;
  }

  /** stdout에 조각 하나를 보낸다 */
  stdout(text: string): void {
    this.queue.push({ kind: "stdout", bytes: enc(text) });
  }

  /** stderr에 조각 하나를 보낸다 */
  stderr(text: string): void {
    this.queue.push({ kind: "stderr", bytes: enc(text) });
  }

  /** 엔진이 코드로 끝났다 */
  crash(code: number): void {
    this.queue.push({ kind: "terminated", code, signal: null });
  }

  /** 지금까지 stdin에 실제로 쓰인 글 */
  written(): string {
    return this.received.join("");
  }

  stdinClosed(): boolean {
    return this.closed;
  }

  /** 막힌 쓰기를 푼다. 쌓인 순서대로 쓰인다 */
  releaseWrites(): void {
    this.gateOpen = true;
    const waiting = this.gateWaiters;
    this.gateWaiters = [];
    for (const commit of waiting) commit();
  }

  launched(): Launched {
    return {
      pid: this.pid,
      events: this.queue.events,
      stdin: {
        write: (bytes) => this.write(bytes),
        close: () => {
          this.close();
        },
      },
      killGroup: () => {
        this.kill();
      },
    };
  }

  private write(bytes: Uint8Array): Promise<void> {
    return new Promise<void>((resolve) => {
      const commit = (): void => {
        const text = DECODER.decode(bytes);
        if (text.includes("host.shutdown")) this.calls.push(`shutdown:${String(this.pid)}`);
        this.received.push(text);
        resolve();
      };
      if (this.gateOpen) commit();
      else this.gateWaiters.push(commit);
    });
  }

  private close(): void {
    this.closed = true;
    this.calls.push(`stdin-closed:${String(this.pid)}`);
    if (this.behavior.exitOnEof) this.queue.push({ kind: "terminated", code: 0, signal: null });
  }

  private kill(): void {
    this.calls.push(`kill:${String(this.pid)}`);
    this.killed.push(this.pid);
    if (this.behavior.dieOnKill) {
      this.releaseWrites();
      this.queue.push({ kind: "terminated", code: null, signal: 9 });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 가짜 launcher

export class FakeLauncher implements Launcher {
  /** 사건 순서: `launch:<pid>`, `shutdown:<pid>`, `stdin-closed:<pid>`, `kill:<pid>`, `run-once:<인자>` */
  readonly calls: string[] = [];
  readonly targets: EngineTarget[] = [];
  readonly safeModes: SafeMode[] = [];
  readonly killed: number[] = [];
  readonly engines: FakeEngine[] = [];
  /** 참이면 다음 띄우기부터 바이너리가 없다고 답한다 */
  failLaunch = false;
  /** 참이면 띄운 엔진이 서비스 브리지다(`viaService`). 서비스에 붙은 로컬 엔진을 재현한다 */
  viaService = false;
  /** 다음 띄우기가 시작할 때 한 번 실행한다. 띄우는 사이의 대상 바꾸기를 재현한다 */
  beforeLaunch: (() => void) | null = null;
  /** 다음 `runOnce`의 결과. 한 번 쓰고 나면 기본값(종료 코드 0, 빈 출력)으로 돌아간다 */
  scriptedOnce: Result<OnceOutput, LaunchFailure> | null = null;
  /** 다음 `--check` 실행(복원 전 사본 검증)의 결과. 기본값은 종료 코드 0. 문이 닫혀 있어도 막히지 않는다 */
  scriptedCheck: Result<OnceOutput, LaunchFailure> | null = null;
  private readonly behavior: FakeBehavior;
  private onceOpen = true;
  private onceWaiters: (() => void)[] = [];

  constructor(behavior: FakeBehavior) {
    this.behavior = behavior;
  }

  /** `n`번째(0부터) 띄운 엔진 */
  engine(index: number): FakeEngine {
    const found = this.engines[index];
    if (found === undefined) throw new Error(`no engine ${String(index)}`);
    return found;
  }

  launches(): number {
    return this.engines.length;
  }

  launch(target: EngineTarget, safeMode: SafeMode): Promise<Result<Launched, LaunchFailure>> {
    const hook = this.beforeLaunch;
    this.beforeLaunch = null;
    if (hook !== null) hook();
    if (this.failLaunch) return Promise.resolve(err({ message: "no such binary" }));
    this.targets.push(target);
    this.safeModes.push(safeMode);
    const pid = 1001 + this.engines.length;
    this.calls.push(`launch:${String(pid)}`);
    const engine = new FakeEngine(pid, this.behavior, this.calls, this.killed);
    this.engines.push(engine);
    const launched = engine.launched();
    return Promise.resolve(ok(this.viaService ? { ...launched, viaService: true } : launched));
  }

  runOnce(args: readonly string[]): Promise<Result<OnceOutput, LaunchFailure>> {
    this.calls.push(`run-once:${args.join(" ")}`);
    if (args.includes("--check")) {
      const scripted = this.scriptedCheck;
      this.scriptedCheck = null;
      return Promise.resolve(scripted ?? ok({ exitCode: 0, stdout: "", stderr: "" }));
    }
    return repeatAsync<Result<OnceOutput, LaunchFailure>>(async () => {
      if (this.onceOpen) return { value: this.takeOnce() };
      await new Promise<void>((resolve) => {
        this.onceWaiters.push(() => {
          resolve();
        });
      });
      return undefined;
    });
  }

  /** 다음 `runOnce`가 끝나지 못하게 막는다. 시험이 그 사이에 다른 일을 본다 */
  closeOnceGate(): void {
    this.onceOpen = false;
  }

  openOnceGate(): void {
    this.onceOpen = true;
    const waiting = this.onceWaiters;
    this.onceWaiters = [];
    for (const wake of waiting) wake();
  }

  private takeOnce(): Result<OnceOutput, LaunchFailure> {
    const scripted = this.scriptedOnce;
    this.scriptedOnce = null;
    return scripted ?? ok({ exitCode: 0, stdout: "", stderr: "" });
  }
}

// ---------------------------------------------------------------------------------------------
// 기록하는 수신 끝과 로그

export interface RecordingSink extends Sink {
  readonly states: EngineState[];
  /** 페이지로 간 엔진 stdout 바이트를 글로 읽는다 */
  text(): string;
  /** 페이지로 간 상태의 `kind` 목록 */
  kinds(): string[];
  /** 지금까지 `running`으로 간 횟수 */
  runningCount(): number;
}

export function recordingSink(): RecordingSink {
  const bytes: Uint8Array[] = [];
  const states: EngineState[] = [];
  return {
    states,
    sendBytes(chunk) {
      bytes.push(chunk.slice());
      return ok(undefined);
    },
    sendState(state) {
      states.push(state);
      return ok(undefined);
    },
    text: () => bytes.map((chunk) => DECODER.decode(chunk)).join(""),
    kinds: () => states.map((state) => state.kind),
    runningCount: () => states.filter((state) => state.kind === "running").length,
  };
}

export interface RecordingLog extends AppLog {
  readonly lines: string[];
}

export function recordingLog(): RecordingLog {
  const lines: string[] = [];
  return {
    lines,
    line(message) {
      lines.push(message);
    },
  };
}
