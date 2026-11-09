// 엔진 감독자(engine.rs의 Supervisor, L4.desktop.spec 3.3, 4.1, 4.3, 4.4). 엔진을 띄우고, 죽으면 재기동 정책을 따르고,
// 대상과 안전 모드가 바뀌면 다시 띄우고, 종료와 데이터베이스 복원 때 엔진을 멈춘다.
// 상태는 `shared` 한 객체에 두고, 바꿀 때마다 `pulse`로 기다리는 쪽을 깨운다(wait.ts). 모든 바꾸기는 `mutate`를 거친다.
// 종료 순서: host.shutdown 한 줄, stdin 닫기(EOF), 시한까지 기다림, 그룹 종료(E4, E9). EOF를 주기 전에 그룹을 죽이지 않는다.
import { detach, err, ok, repeatAsync, assertNever, type Result } from "@fresnel/contracts";
import type { AppLog } from "../lib/applog.ts";
import type { EngineEvents, Launched, Launcher } from "./launcher.ts";
import {
  createRestartPolicy,
  createStderrSplitter,
  engineDetailOf,
  ENV_EXIT_CODE,
  exitOf,
  KILL_SETTLE_MS,
  RESTORE_SLACK_MS,
  safeModeChosen,
  isLocalSocketAddress,
  sameTarget,
  shutdownRequestFrame,
  validateTarget,
  type EngineConfig,
  type RestartDecision,
  type RestartPolicy,
  type SafeMode,
} from "./policy.ts";
import { createPipeWriter, WRITE_QUEUE_FRAMES, type PipeHandle, type Relay } from "./relay.ts";
import type { CommandError, EngineExit, EngineTarget } from "./state.ts";
import { createPulse, waitUntil, withTimeout, type EngineClock, type Pulse } from "./wait.ts";

/** `engine_detach`가 아닌 종료 요청이 할 일. `main`의 종료 순서가 이것을 본다(L4.desktop.spec 4.3) */
export type ExitAction = "allow" | "preventAndShutdown" | "prevent" | "preventUntilRestore";

/** `db_restore`가 돌려주는 결과. 종료 코드와 출력을 해석하지 않고 그대로 옮긴다 */
export interface RestoreOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** 시험과 점검이 읽는 감독자 상태의 사본. 바꾸는 손잡이가 아니다 */
export interface SupervisorSnapshot {
  readonly target: EngineTarget;
  readonly safeMode: SafeMode;
  readonly failed: boolean;
  readonly hold: boolean;
  readonly exitWaitsForRestore: boolean;
  readonly stopRequested: boolean;
  readonly livePid: number | null;
}

export interface SupervisorDeps {
  readonly launcher: Launcher;
  readonly relay: Relay;
  readonly config: EngineConfig;
  readonly log: AppLog;
  readonly clock: EngineClock;
}

/** 살아 있는 엔진 하나의 기록. 세대 번호로 늦은 종료 기록을 구분한다 */
interface Live {
  readonly generation: number;
  readonly pid: number;
  readonly pipe: PipeHandle;
  /** 원격 대상으로 띄운 엔진이거나 서비스 브리지다. 이 엔진에는 host.shutdown을 보내지 않는다(서비스 쪽 엔진을 끄지 않는다) */
  readonly remote: boolean;
  readonly child: Launched;
}

/** 감독자의 공유 상태. 모든 바꾸기는 `mutate`로 하고, 기다리는 쪽은 여기 값을 다시 본다 */
interface Shared {
  /** 마지막으로 띄운 엔진 세대 */
  generation: number;
  live: Live | null;
  stopRequested: boolean;
  shutdownStarted: boolean;
  exitAllowed: boolean;
  /** 자동 재기동을 다 써서 `failed`다 */
  failed: boolean;
  /** `failed`에서 수동 재기동이 불렸다. 다음 대기가 이것을 보고 깬다 */
  restartRequested: boolean;
  /** 지금 바라는 대상. 실행 루프가 띄울 때 읽는다 */
  target: EngineTarget;
  /** 대상이나 안전 모드를 바꿀 때마다 1씩 오른다. 실행 루프는 띄울 때의 값과 비교한다 */
  targetEpoch: number;
  /** 앱을 켜 둔 동안 남는 안전 모드 선택 */
  safeMode: SafeMode;
  /** 데이터베이스 복원 중이다. 참인 동안 실행 루프는 엔진을 띄우지 않는다 */
  hold: boolean;
  /** 띄우는 사이다. 복원은 이 값이 거짓이 된 뒤에 보류를 건다 */
  launching: boolean;
  /** 복원 중에 종료 요청이 와서 끝나기를 기다리는 과제가 이미 있다 */
  exitWaitsForRestore: boolean;
  /** 마지막으로 끝난 엔진 세대 */
  exitedGeneration: number;
  /** 실행 루프가 끝났다 */
  stopped: boolean;
}

interface LaunchPlan {
  readonly target: EngineTarget;
  readonly epoch: number;
  readonly safeMode: SafeMode;
}

type BeginLaunch =
  | { readonly kind: "stop" }
  | { readonly kind: "held" }
  | { readonly kind: "launch"; readonly plan: LaunchPlan };

/** 대상 바꾸기 결과. 살아 있던 엔진이 있으면 그 엔진을 끈다 */
interface RetargetPlan {
  readonly live: Live | null;
}

/** 재기동 결과. 살아 있는 엔진이 있으면 그 엔진을 끄고 새 세대로 띄운다 */
interface RestartPlan {
  readonly live: Live;
  readonly safe: SafeMode;
}

/** 데이터베이스 복원을 돌리는 CLI의 인자. `fresnel db restore <dir> --json` */
function restoreArgs(backupDir: string, check = false): string[] {
  return check
    ? ["db", "restore", backupDir, "--check", "--json"]
    : ["db", "restore", backupDir, "--json"];
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.name : "non-error";
}

function show(value: number | null): string {
  return value === null ? "none" : String(value);
}

function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

/** 대상으로 본 공급원. 로컬 소켓 주소는 서비스다. 서비스 브리지인지는 띄운 뒤에야 알 수 있다 */
function sourceOfTarget(target: EngineTarget): "sidecar" | "service" {
  return target.kind === "remote" && isLocalSocketAddress(target.address) ? "service" : "sidecar";
}

export class Supervisor {
  private readonly deps: SupervisorDeps;
  private readonly policy: RestartPolicy;
  private readonly pulse: Pulse = createPulse();
  private readonly shared: Shared = {
    generation: 0,
    live: null,
    stopRequested: false,
    shutdownStarted: false,
    exitAllowed: false,
    failed: false,
    restartRequested: false,
    target: { kind: "local" },
    targetEpoch: 0,
    safeMode: "default",
    hold: false,
    launching: false,
    exitWaitsForRestore: false,
    exitedGeneration: 0,
    stopped: false,
  };
  /** 실행 루프의 재기동 횟수(표시용)와 정책이 맞춘 대상 세대 */
  private attempt = 0;
  private policyEpoch = 0;

  constructor(deps: SupervisorDeps) {
    this.deps = deps;
    this.policy = createRestartPolicy(deps.config.restartLimit);
  }

  /** 실행 루프를 띄운다. 앱당 한 번 부른다 */
  start(): void {
    detach(this.runLoop(), (cause) => {
      this.deps.log.line(`engine supervisor failed: ${describeError(cause)}`);
    });
  }

  /** WebView의 stdin 쓰기. 종료 중이면 거부하고, 엔진이 없으면 거부한다 */
  async write(bytes: Uint8Array): Promise<Result<void, CommandError>> {
    if (this.shared.stopRequested) return err("engine-stopping");
    const live = this.shared.live;
    if (live === null) return err("engine-not-running");
    const written = await live.pipe.writeFrame(bytes);
    if (!written.ok) return err("engine-not-running");
    return ok(undefined);
  }

  /**
   * 재기동(W-35, `engine_restart`). `failed`면 확인 없이 다시 띄운다. 살아 있는 엔진은 `confirmed`가 참일 때만
   * 대상 바꾸기와 같은 길(정상 종료 뒤 재기동, 자동 재기동 횟수에 세지 않음)로 다시 띄운다. 엔진이 없으면 거부한다.
   * `safeMode`가 있으면 그 값을 앱을 켜 둔 동안 쓴다. 원격 대상에서 켜려 하면 확인 여부와 관계없이 `bad-request`다.
   */
  restartManually(safeMode: boolean | null, confirmed: boolean): Result<void, CommandError> {
    const decided = this.mutate((s): Result<RestartPlan | null, CommandError> => {
      if (s.stopRequested) return err("engine-stopping");
      if (safeMode === true && s.target.kind === "remote") return err("bad-request");
      if (s.failed) {
        if (safeMode !== null) s.safeMode = safeModeChosen(safeMode);
        s.restartRequested = true;
        return ok(null);
      }
      const live = s.live;
      if (live === null) return err("engine-not-running");
      if (!confirmed) return err("not-confirmed");
      if (safeMode !== null) s.safeMode = safeModeChosen(safeMode);
      s.targetEpoch += 1;
      return ok({ live, safe: s.safeMode });
    });
    if (!decided.ok) return err(decided.error);
    if (decided.value === null) return ok(undefined);
    const { live, safe } = decided.value;
    this.deps.log.line(`restart: the live engine restarts, safe mode=${safe}`);
    this.endForNewEpoch(live);
    return ok(undefined);
  }

  /**
   * 대상 바꾸기(W-08). 같은 대상이면 아무 일도 하지 않는다. 다르면 살아 있는 엔진을 정상 종료 순서로 끝내고,
   * 실행 루프가 새 대상으로 다시 띄운다. 이 재기동은 자동 재기동 횟수에 세지 않는다. 주소는 로그에 남기지 않는다(E11).
   */
  retarget(target: EngineTarget): Result<void, CommandError> {
    const invalid = validateTarget(target);
    if (invalid !== null) return err(invalid);
    const decided = this.mutate((s): Result<RetargetPlan | null, CommandError> => {
      if (s.stopRequested) return err("engine-stopping");
      if (sameTarget(s.target, target)) return ok(null);
      s.target = target;
      s.targetEpoch += 1;
      return ok({ live: s.live });
    });
    if (!decided.ok) return err(decided.error);
    if (decided.value === null) return ok(undefined);
    this.deps.log.line("retarget: the engine target changed");
    this.endForNewEpoch(decided.value.live);
    return ok(undefined);
  }

  /**
   * 데이터베이스를 백업 폴더에서 되돌린다. 살아 있는 엔진은 정상 종료 순서로 끄고, CLI를 한 번 돌리고,
   * 끝나면 엔진을 다시 띄운다. 종료 코드와 출력은 해석하지 않고 그대로 돌려준다. 원격 대상이면 거부한다.
   */
  async restoreDatabase(backupDir: string): Promise<Result<RestoreOutput, CommandError>> {
    const begun = await this.beginHold();
    if (!begun.ok) return err(begun.error);
    try {
      const result = await this.restoreHeld(begun.value, backupDir);
      return result;
    } finally {
      this.releaseHold();
    }
  }

  /** `ExitRequested`에서 할 일을 정한다. 살아 있는 엔진이 없으면 대기 중인 재기동도 취소한다 */
  onExitRequested(): ExitAction {
    return this.mutate((s): ExitAction => {
      if (s.exitAllowed) return "allow";
      if (s.hold) {
        // 복원 중에는 엔진이 내려가 있어 `live`가 없다. 그대로 허용하면 CLI가 도는 채로 앱이 끝나 결과를 잃는다
        if (s.exitWaitsForRestore) return "prevent";
        s.exitWaitsForRestore = true;
        return "preventUntilRestore";
      }
      if (s.live === null) {
        s.stopRequested = true;
        return "allow";
      }
      if (s.shutdownStarted) return "prevent";
      s.shutdownStarted = true;
      return "preventAndShutdown";
    });
  }

  /** 복원 보류가 풀릴 때까지 기다린다. 보류가 없으면 바로 돌아온다. 기다린 뒤에는 종료 요청을 다시 받는다 */
  async waitRestoreEnd(): Promise<void> {
    await this.waitFor(() => !this.shared.hold, null);
    this.mutate((s) => {
      s.exitWaitsForRestore = false;
    });
  }

  /** 두 번째 종료 요청이 막히지 않게 한다 */
  allowExit(): void {
    this.mutate((s) => {
      s.exitAllowed = true;
    });
  }

  /** 정상 종료 순서(L4.desktop.spec 4.3 2~5단계). 실행 루프가 멈췄다고 알릴 때까지 기다린다 */
  async shutdown(): Promise<void> {
    const live = this.mutate((s) => {
      s.stopRequested = true;
      return s.live;
    });
    this.deps.relay.beginDrain();
    if (live !== null) {
      this.deps.relay.setState({ kind: "stopping" });
      // 원격 엔진에는 host.shutdown을 보내지 않는다. 브리지가 그 줄을 원격 서비스로 넘긴다
      await this.stopEngine(live, !live.remote);
    }
    const stopped = await this.waitFor(
      () => this.shared.stopped,
      this.deps.clock.now() + KILL_SETTLE_MS,
    );
    if (!stopped) this.deps.log.line("shutdown: run loop did not report stopped in time");
  }

  /** 앱이 끝나는 마지막 순간의 방어. 남은 그룹이 있으면 강제 종료를 보낸다(동기) */
  killRemaining(): void {
    const live = this.shared.live;
    if (live !== null) live.child.killGroup();
  }

  /** 시험과 점검이 읽는다 */
  snapshot(): SupervisorSnapshot {
    const s = this.shared;
    return {
      target: s.target,
      safeMode: s.safeMode,
      failed: s.failed,
      hold: s.hold,
      exitWaitsForRestore: s.exitWaitsForRestore,
      stopRequested: s.stopRequested,
      livePid: s.live === null ? null : s.live.pid,
    };
  }

  // -------------------------------------------------------------------------------------------
  // 실행 루프

  private async runLoop(): Promise<void> {
    await repeatAsync<void>(async () => {
      const goOn = await this.runStep();
      return goOn ? undefined : { value: undefined };
    });
    this.deps.relay.setState({ kind: "stopped" });
    this.mutate((s) => {
      s.stopped = true;
    });
  }

  /** 엔진 한 번의 수명: 보류 기다림, 띄우기, 끝날 때까지 펌프, 재기동 결정. `false`면 루프를 끝낸다 */
  private async runStep(): Promise<boolean> {
    if (!(await this.waitWhileHeld())) return false;
    const begin = this.beginLaunch();
    if (begin.kind === "stop") return false;
    if (begin.kind === "held") return true;
    const plan = begin.plan;
    if (plan.epoch !== this.policyEpoch) {
      this.policy.reset();
      this.attempt = 0;
      this.policyEpoch = plan.epoch;
    }
    this.deps.relay.setState({
      kind: "starting",
      source: sourceOfTarget(plan.target),
      attempt: this.attempt,
    });
    const launched = await this.deps.launcher.launch(plan.target, plan.safeMode);
    if (!launched.ok) {
      // 바이너리 없음, 실행 권한 없음은 되풀이해도 같다. 재기동하지 않는다(spec 5)
      this.endLaunch();
      this.deps.log.line(`launch failed: ${launched.error.message}`);
      // 띄우지 못했으니 stderr도 없다
      const kept = await this.failAndWait(
        this.attempt,
        exitOf(null, null, this.deps.clock.now(), null),
        plan.epoch,
      );
      if (!kept) return false;
      this.policy.reset();
      this.attempt = 0;
      return true;
    }
    return this.runEngine(plan, launched.value);
  }

  /** 띄운 엔진 하나를 등록하고 끝날 때까지 펌프한 뒤, 끝난 이유에 따라 재기동 여부를 정한다 */
  private async runEngine(plan: LaunchPlan, child: Launched): Promise<boolean> {
    const pipe = createPipeWriter(child.stdin, WRITE_QUEUE_FRAMES);
    // 서비스 브리지는 로컬 대상으로 띄워도 원격 엔진과 같이 다룬다(host.shutdown을 보내지 않는다)
    const viaService = child.viaService === true;
    const remote = plan.target.kind === "remote" || viaService;
    const registered = this.mutate((s) => {
      s.launching = false;
      s.generation += 1;
      s.failed = false;
      const entry: Live = { generation: s.generation, pid: child.pid, pipe, remote, child };
      s.live = entry;
      // 띄우는 사이에 대상이 바뀌었거나 종료가 시작됐으면 이 엔진은 새 대상과 맞지 않으므로 바로 끝낸다
      return { entry, stale: s.targetEpoch !== plan.epoch || s.stopRequested };
    });
    const live = registered.entry;
    const generation = live.generation;
    this.deps.log.line(`engine[${String(generation)}] started pid=${String(child.pid)}`);
    const source = viaService ? "service" : sourceOfTarget(plan.target);
    // 프로세스가 아닌 엔진(웹 게이트웨이의 소켓 연결)은 pid 0이다. 화면은 1 이상 또는 null만 받는다
    this.deps.relay.setState({ kind: "running", source, pid: child.pid > 0 ? child.pid : null });
    if (registered.stale) this.detached(this.stopEngine(live, !remote), "stale engine stop");

    const exit = await this.pump(generation, child.events);
    const after = this.mutate((s) => {
      s.live = null;
      s.exitedGeneration = generation;
      return { stopping: s.stopRequested, current: s.targetEpoch, held: s.hold };
    });
    this.deps.log.line(
      `engine[${String(generation)}] exited code=${show(exit.code)} signal=${show(exit.signal)}`,
    );
    if (after.stopping) return false;
    if (after.current !== plan.epoch) {
      // 대상을 바꾸려고 끝낸 엔진이다. 자동 재기동 횟수에 세지 않고 새 대상으로 바로 띄운다
      this.policy.reset();
      this.policyEpoch = after.current;
      this.attempt = 1;
      this.deps.relay.setState({
        kind: "restarting",
        attempt: 1,
        retryAt: isoAt(this.deps.clock.now()),
        lastExit: exit,
      });
      return true;
    }
    // 복원 때문에 끝낸 엔진이다. 자동 재기동 횟수에 세지 않는다. 보류가 풀리면 맨 위에서 다시 띄운다
    if (after.held) return true;
    const now = this.deps.clock.now();
    // 종료코드 3은 환경 문제라 되풀이해도 같다. 재기동 정책을 거치지 않고 자동 재기동 없이 바로 `failed`로 둔다.
    // `attempts`는 `giveUp`과 같은 뜻이라 이 세대까지 쓴 자동 재기동 횟수다(정책 창에 아무것도 더하지 않는다)
    const decision: RestartDecision =
      exit.code === ENV_EXIT_CODE
        ? { kind: "giveUp", attempts: this.attempt }
        : this.policy.onExit(now);
    if (decision.kind === "giveUp") {
      const kept = await this.failAndWait(decision.attempts, exit, plan.epoch);
      if (!kept) return false;
      this.policy.reset();
      this.attempt = 0;
      return true;
    }
    this.attempt = decision.attempt;
    this.deps.relay.setState({
      kind: "restarting",
      attempt: decision.attempt,
      retryAt: isoAt(now + decision.delayMs),
      lastExit: exit,
    });
    if (decision.delayMs > 0 && this.shared.targetEpoch === plan.epoch) {
      await this.waitFor(
        () => this.shared.stopRequested || this.shared.targetEpoch !== plan.epoch,
        now + decision.delayMs,
      );
    }
    return true;
  }

  /** 복원 보류가 풀릴 때까지 기다린다. 기다리는 동안 상태는 `stopped`다. 종료 요청이 오면 거짓이다 */
  private async waitWhileHeld(): Promise<boolean> {
    return repeatAsync<boolean>(async () => {
      if (this.shared.stopRequested) return { value: false };
      if (!this.shared.hold) return { value: true };
      this.deps.relay.setState({ kind: "stopped" });
      await this.waitFor(() => !this.shared.hold || this.shared.stopRequested, null);
      return undefined;
    });
  }

  /** 띄울 차례를 얻는다. 종료 중이면 띄우지 않고, 보류 중이면 기다리러 돌아간다 */
  private beginLaunch(): BeginLaunch {
    return this.mutate((s): BeginLaunch => {
      if (s.stopRequested) return { kind: "stop" };
      if (s.hold) return { kind: "held" };
      s.launching = true;
      return {
        kind: "launch",
        plan: { target: s.target, epoch: s.targetEpoch, safeMode: s.safeMode },
      };
    });
  }

  private endLaunch(): void {
    this.mutate((s) => {
      s.launching = false;
    });
  }

  /**
   * `failed`로 두고 수동 재기동, 종료, 대상 바꾸기를 기다린다. 다시 띄울 때면 참이다.
   * `epoch`는 이 엔진을 띄울 때의 대상 세대다. 그 뒤에 대상이 바뀌었으면 기다리지 않는다.
   */
  private async failAndWait(
    attempts: number,
    lastExit: EngineExit,
    epoch: number,
  ): Promise<boolean> {
    const early = this.mutate((s): boolean | null => {
      if (s.stopRequested) return false;
      if (s.targetEpoch !== epoch) return true;
      s.failed = true;
      s.restartRequested = false;
      return null;
    });
    if (early !== null) return early;
    this.deps.relay.setState({ kind: "failed", attempts, lastExit });
    await this.waitFor(
      () =>
        this.shared.restartRequested ||
        this.shared.stopRequested ||
        this.shared.targetEpoch !== epoch,
      null,
    );
    return !this.shared.stopRequested;
  }

  /**
   * 엔진 이벤트를 소비한다. stdout은 세대 전용 스트림으로, stderr는 줄 단위 로그로 보낸다.
   * 세대의 첫 비어 있지 않은 stderr 줄은 종료 기록의 `detail`로 싣는다(로그에는 아무것도 더 남기지 않는다).
   */
  private async pump(generation: number, events: EngineEvents): Promise<EngineExit> {
    const stream = this.deps.relay.openStream();
    const splitter = createStderrSplitter();
    // 객체로 감싸 클로저가 바꾼 값을 TS가 `null`로 좁히지 않게 한다
    const firstLine: { detail: string | null } = { detail: null };
    const logStderr = (line: string): void => {
      this.deps.log.line(`engine[${String(generation)}] stderr: ${line}`);
      if (firstLine.detail === null) firstLine.detail = engineDetailOf(line);
    };
    const exit = await repeatAsync<EngineExit | null>(async () => {
      const event = await events.next();
      if (event === null) return { value: null };
      switch (event.kind) {
        case "stdout":
          await stream.push(event.bytes);
          return undefined;
        case "stderr":
          for (const line of splitter.push(event.bytes)) logStderr(line);
          return undefined;
        case "terminated":
          return { value: exitOf(event.code, event.signal, this.deps.clock.now()) };
        case "error":
          this.deps.log.line(`engine[${String(generation)}] event error: ${event.message}`);
          return undefined;
        default:
          return assertNever(event, "engine event");
      }
    });
    const tail = splitter.finish();
    if (tail !== null) logStderr(tail);
    // E11: 프레임 내용은 남기지 않고 바이트 수만 남긴다
    const stats = stream.finish();
    this.deps.log.line(
      `engine[${String(generation)}] relay forwarded=${String(stats.forwardedBytes)}B dropped=${String(stats.droppedBytes)}B dropped_tail=${String(stats.droppedTailBytes)}B overflowed_lines=${String(stats.overflowedLines)}`,
    );
    // 꼬리 줄까지 본 뒤에 붙인다. 끝난 기록이 없으면(스트림만 끝남) 빈 기록이다
    return { ...(exit ?? exitOf(null, null, this.deps.clock.now())), detail: firstLine.detail };
  }

  // -------------------------------------------------------------------------------------------
  // 종료, 대상 바꾸기, 복원

  /**
   * 대상이나 안전 모드가 바뀌었을 때 살아 있는 엔진을 정상 종료 순서로 끝낸다. 실행 루프가 새 세대로 다시 띄운다.
   * 상태는 이미 `mutate`로 바뀌어 기다리는 쪽이 깨어 있다.
   */
  private endForNewEpoch(live: Live | null): void {
    if (live !== null) this.detached(this.stopEngine(live, !live.remote), "engine stop");
  }

  /**
   * 엔진을 정상 종료 순서로 끈다. host.shutdown 한 줄, stdin 닫기, 시한까지 종료를 기다림, 그룹 종료다.
   * 시한 안에 끝났더라도 그룹에 남은 손자를 정리하려고 그룹 종료를 한 번 보낸다(E9).
   */
  private async stopEngine(live: Live, sendShutdown: boolean): Promise<void> {
    const scheduler = this.deps.clock.scheduler;
    const deadline = this.deps.clock.now() + this.deps.config.shutdownGraceMs;
    if (sendShutdown) {
      const wrote = await withTimeout(
        live.pipe.writeShellFrame(shutdownRequestFrame(live.generation)),
        this.remaining(deadline),
        scheduler,
      );
      if (wrote.timedOut) {
        this.deps.log.line("shutdown: stdin write is blocked, skipping to EOF wait");
      }
    }
    const closed = await withTimeout(live.pipe.closeWrite(), this.remaining(deadline), scheduler);
    if (closed.timedOut) this.deps.log.line("shutdown: could not queue stdin close");

    const finished = await this.waitFor(
      () => this.shared.exitedGeneration >= live.generation,
      deadline,
    );
    if (!finished) {
      this.deps.log.line("shutdown: grace period expired, killing the process group");
    }
    live.child.killGroup();
    if (!finished) {
      const ended = await this.waitFor(
        () => this.shared.exitedGeneration >= live.generation,
        this.deps.clock.now() + KILL_SETTLE_MS,
      );
      if (!ended) {
        this.deps.log.line("shutdown: engine termination was not observed after SIGKILL");
      }
    }
  }

  /** 데이터베이스 복원의 보류를 건다. 띄우는 사이가 끝난 뒤에 건다. 걸린 순간의 살아 있는 엔진을 돌려준다 */
  private async beginHold(): Promise<Result<Live | null, CommandError>> {
    const deadline = this.deps.clock.now() + this.deps.config.shutdownGraceMs + RESTORE_SLACK_MS;
    return repeatAsync<Result<Live | null, CommandError>>(async () => {
      const step = this.mutate((s): Result<Live | null, CommandError> | null => {
        if (s.stopRequested) return err("engine-stopping");
        if (s.target.kind === "remote") return err("remote-target");
        // 서비스에 붙은 로컬 엔진이 살아 있으면 저장소는 서비스가 쥐고 있다. 그 동안 복원을 돌리지 않는다
        if (s.live !== null && s.live.remote) return err("remote-target");
        if (s.hold) return err("busy");
        if (!s.launching) {
          s.hold = true;
          return ok(s.live);
        }
        return null;
      });
      if (step !== null) return { value: step };
      const settled = await this.waitFor(() => !this.shared.launching, deadline);
      if (!settled) return { value: err("engine-stopping") };
      return undefined;
    });
  }

  /** 보류를 건 뒤의 복원 본체. 엔진을 끄고, CLI를 한 번 돌리고, 결과를 돌려준다. 보류는 호출자가 푼다 */
  private async restoreHeld(
    live: Live | null,
    backupDir: string,
  ): Promise<Result<RestoreOutput, CommandError>> {
    // 사본이 쓸 수 없으면 엔진을 내리지 않고 그 거절을 그대로 돌려준다. 열린 대화가 끊기지 않고, 설정 화면이 다시 그려지지 않는다
    const checked = await this.deps.launcher.runOnce(restoreArgs(backupDir, true));
    if (!checked.ok) {
      this.deps.log.line(`db restore check could not run: ${checked.error.message}`);
      return err("storage-failed");
    }
    if (checked.value.exitCode !== 0) {
      this.deps.log.line(
        `db restore refused before touching the engine exit=${String(checked.value.exitCode)}`,
      );
      return ok({
        exitCode: checked.value.exitCode,
        stdout: checked.value.stdout,
        stderr: checked.value.stderr,
      });
    }
    if (live !== null) {
      this.deps.relay.setState({ kind: "stopping" });
      const deadline = this.deps.clock.now() + this.deps.config.shutdownGraceMs + RESTORE_SLACK_MS;
      await this.stopEngine(live, !live.remote);
      const exitedInTime = await this.waitFor(
        () => this.shared.exitedGeneration >= live.generation,
        deadline,
      );
      if (!exitedInTime) {
        this.deps.log.line("db restore: the engine did not exit in time");
        return err("engine-stopping");
      }
    }
    const ran = await this.deps.launcher.runOnce(restoreArgs(backupDir));
    if (!ran.ok) {
      this.deps.log.line(`db restore could not run: ${ran.error.message}`);
      return err("storage-failed");
    }
    this.deps.log.line(`db restore finished exit=${String(ran.value.exitCode)}`);
    return ok({
      exitCode: ran.value.exitCode,
      stdout: ran.value.stdout,
      stderr: ran.value.stderr,
    });
  }

  private releaseHold(): void {
    this.mutate((s) => {
      s.hold = false;
    });
  }

  // -------------------------------------------------------------------------------------------
  // 공용 도구

  /** 상태를 바꾸고 기다리는 쪽을 깨운다. 모든 상태 바꾸기는 이것을 거친다 */
  private mutate<T>(change: (state: Shared) => T): T {
    const result = change(this.shared);
    this.pulse.pulse();
    return result;
  }

  private waitFor(predicate: () => boolean, deadline: number | null): Promise<boolean> {
    return waitUntil(this.deps.clock, this.pulse, predicate, deadline);
  }

  private remaining(deadline: number): number {
    return Math.max(0, deadline - this.deps.clock.now());
  }

  /** 기다리지 않고 돌리는 일. 실패는 앱 로그에만 남긴다 */
  private detached(work: Promise<void>, label: string): void {
    detach(work, (cause) => {
      this.deps.log.line(`${label} failed: ${describeError(cause)}`);
    });
  }
}
