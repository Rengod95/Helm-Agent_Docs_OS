import {
  err,
  ok,
  type Clock,
  type Logger,
  type Result,
  type Scheduler,
  type TimerHandle,
} from "@xeon/contracts";
import type { LocalIdFactory } from "@xeon/contracts/conversation";
import type {
  BackgroundError,
  BackgroundOwnerKind,
  BackgroundProcessId,
  BackgroundProcessInfo,
  BackgroundRegistry,
  BackgroundState,
  RegisterBackgroundInput,
} from "@xeon/contracts/services";

// L0.process.spec §4.3, L0.process.plan PR-06. 메모리 레지스트리다(DB 테이블 없음).
// 레지스트리는 kill 수단을 갖지 않는다. 등록자가 넘긴 BackgroundStopper를 순서와 시한에 맞춰 부른다.

/** stop의 graceful 대기. 기본값은 spec §4.3 [제안] */
export const DEFAULT_BACKGROUND_GRACE_MS = 2000;
/** 끝난 항목을 list에 남기는 시간. spec §4.3 [제안] 10분 */
export const DEFAULT_BACKGROUND_RETENTION_MS = 600_000;
/** force 뒤에도 끝나지 않을 때 lost로 표시하기 전 기다리는 시간. spec에 값이 없어 graceMs 기본값과 같게 둔다 */
export const DEFAULT_BACKGROUND_FORCE_WAIT_MS = 2000;

export interface BackgroundRegistryDeps {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  /** "bgp_<ULID>" 발급(F.conversation.spec §3.2.1) */
  readonly ids: LocalIdFactory;
  readonly logger: Logger;
  readonly defaultGraceMs?: number;
  readonly retentionMs?: number;
  readonly forceWaitMs?: number;
}

/** F `BackgroundRegistry`에 종료 협조용 `close`를 더한 소유자 쪽 모양 */
export interface BackgroundRegistryController extends BackgroundRegistry {
  /** 새 등록을 거부(registry_closed)하고 살아 있는 항목을 병렬로 모두 정지한다. 정지 요청한 항목 수를 돌려준다 */
  close(options?: { readonly graceMs?: number }): Promise<number>;
}

interface Entry {
  readonly id: BackgroundProcessId;
  readonly label: string;
  readonly owner: BackgroundProcessInfo["owner"];
  readonly pid: number;
  readonly startedAt: number;
  readonly stopper: RegisterBackgroundInput["stopper"];
  state: BackgroundState;
  exitCode: number | null;
  /** force를 보낸 적이 있으면 참. 종료 상태가 killed가 된다 */
  forced: boolean;
  /** stopper.exited가 이행하거나 거부됐으면 참 */
  settled: boolean;
  stopping: Promise<BackgroundState> | undefined;
  retentionTimer: TimerHandle | undefined;
  readonly exitWaiters: Set<() => void>;
}

function isTerminal(state: BackgroundState): boolean {
  return state === "exited" || state === "killed" || state === "lost";
}

function describeError(caught: unknown): string {
  return caught instanceof Error ? caught.message : "non_error_thrown";
}

function snapshot(entry: Entry): BackgroundProcessInfo {
  return {
    id: entry.id,
    label: entry.label,
    owner: { kind: entry.owner.kind, threadId: entry.owner.threadId, ref: entry.owner.ref },
    pid: entry.pid,
    startedAt: entry.startedAt,
    state: entry.state,
    exitCode: entry.exitCode,
  };
}

export function createBackgroundRegistry(
  deps: BackgroundRegistryDeps,
): BackgroundRegistryController {
  const { clock, scheduler, ids, logger } = deps;
  const defaultGraceMs = deps.defaultGraceMs ?? DEFAULT_BACKGROUND_GRACE_MS;
  const retentionMs = deps.retentionMs ?? DEFAULT_BACKGROUND_RETENTION_MS;
  const forceWaitMs = deps.forceWaitMs ?? DEFAULT_BACKGROUND_FORCE_WAIT_MS;
  const entries = new Map<BackgroundProcessId, Entry>();
  const listeners = new Set<(info: BackgroundProcessInfo) => void>();
  let closed = false;

  function emit(entry: Entry): void {
    const info = snapshot(entry);
    for (const listener of listeners) {
      try {
        listener(info);
      } catch (caught) {
        logger.error("background.listener_failed", { id: entry.id, error: describeError(caught) });
      }
    }
  }

  function scheduleRetention(entry: Entry): void {
    if (closed) return;
    entry.retentionTimer = scheduler.setTimeout(() => {
      entry.retentionTimer = undefined;
      entries.delete(entry.id);
    }, retentionMs);
  }

  function wakeWaiters(entry: Entry): void {
    for (const wake of entry.exitWaiters) wake();
    entry.exitWaiters.clear();
  }

  function onExited(
    entry: Entry,
    result: { readonly code: number | null; readonly signal: string | null } | undefined,
  ): void {
    if (entry.settled) return;
    entry.settled = true;
    if (result === undefined) {
      entry.state = "lost";
    } else {
      entry.state = entry.forced ? "killed" : "exited";
      entry.exitCode = result.code;
    }
    logger.info("background.exited", {
      id: entry.id,
      pid: entry.pid,
      state: entry.state,
      exitCode: entry.exitCode,
      signal: result?.signal ?? null,
    });
    scheduleRetention(entry);
    wakeWaiters(entry);
    emit(entry);
  }

  function onExitFailed(entry: Entry, caught: unknown): void {
    logger.error("background.exited_rejected", { id: entry.id, error: describeError(caught) });
    onExited(entry, undefined);
  }

  /** exited가 이행하면 참, ms 안에 이행하지 않으면 거짓 */
  function waitExited(entry: Entry, ms: number): Promise<boolean> {
    if (entry.settled) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const handle = scheduler.setTimeout(() => {
        entry.exitWaiters.delete(onExit);
        resolve(false);
      }, ms);
      const onExit = (): void => {
        scheduler.clearTimeout(handle);
        resolve(true);
      };
      entry.exitWaiters.add(onExit);
    });
  }

  async function callStopper(entry: Entry, mode: "graceful" | "force"): Promise<void> {
    try {
      await entry.stopper.stop(mode);
    } catch (caught) {
      logger.warn("background.stop_failed", { id: entry.id, mode, error: describeError(caught) });
    }
  }

  async function runStop(entry: Entry, graceMs: number): Promise<BackgroundState> {
    entry.state = "stopping";
    emit(entry);
    await callStopper(entry, "graceful");
    if (await waitExited(entry, graceMs)) return entry.state;
    entry.forced = true;
    await callStopper(entry, "force");
    if (await waitExited(entry, forceWaitMs)) return entry.state;
    entry.state = "lost";
    logger.error("background.lost", { id: entry.id, pid: entry.pid });
    emit(entry);
    return entry.state;
  }

  /** 같은 항목에 대한 동시 stop은 한 실행을 나눠 쓴다 */
  function stopEntry(entry: Entry, graceMs: number): Promise<BackgroundState> {
    if (isTerminal(entry.state)) return Promise.resolve(entry.state);
    const inFlight = entry.stopping;
    if (inFlight !== undefined) return inFlight;
    // runStop은 첫 await 전에 돌려주지 않으므로 finally는 아래 대입 뒤에 실행된다
    const running = (async (): Promise<BackgroundState> => {
      try {
        return await runStop(entry, graceMs);
      } finally {
        entry.stopping = undefined;
      }
    })();
    entry.stopping = running;
    return running;
  }

  async function stopMany(targets: readonly Entry[], graceMs: number): Promise<number> {
    await Promise.all(targets.map((entry) => stopEntry(entry, graceMs)));
    return targets.length;
  }

  function active(): Entry[] {
    return [...entries.values()].filter((entry) => !isTerminal(entry.state));
  }

  return {
    register(input): Result<BackgroundProcessId, BackgroundError> {
      if (closed) return err({ kind: "registry_closed" });
      const entry: Entry = {
        id: ids.next("bgp"),
        label: input.label,
        owner: { kind: input.owner.kind, threadId: input.owner.threadId, ref: input.owner.ref },
        pid: input.pid,
        startedAt: clock.now(),
        stopper: input.stopper,
        state: "running",
        exitCode: null,
        forced: false,
        settled: false,
        stopping: undefined,
        retentionTimer: undefined,
        exitWaiters: new Set(),
      };
      entries.set(entry.id, entry);
      logger.info("background.registered", {
        id: entry.id,
        pid: entry.pid,
        kind: entry.owner.kind,
        label: entry.label,
      });
      emit(entry);
      input.stopper.exited.then(
        (result) => onExited(entry, result),
        (caught: unknown) => onExitFailed(entry, caught),
      );
      return ok(entry.id);
    },
    list(filter) {
      const kind: BackgroundOwnerKind | undefined = filter?.kind;
      const threadId = filter?.threadId;
      return [...entries.values()]
        .filter((entry) => kind === undefined || entry.owner.kind === kind)
        .filter((entry) => threadId === undefined || entry.owner.threadId === threadId)
        .map(snapshot);
    },
    get(id) {
      const entry = entries.get(id);
      return entry === undefined ? undefined : snapshot(entry);
    },
    async stop(id, options) {
      const entry = entries.get(id);
      if (entry === undefined) return err({ kind: "not_found", id });
      return ok(await stopEntry(entry, options?.graceMs ?? defaultGraceMs));
    },
    stopOwnedBy(threadId, options) {
      const targets = active().filter((entry) => entry.owner.threadId === threadId);
      return stopMany(targets, options?.graceMs ?? defaultGraceMs);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close(options) {
      closed = true;
      const count = await stopMany(active(), options?.graceMs ?? defaultGraceMs);
      for (const entry of entries.values()) {
        if (entry.retentionTimer !== undefined) {
          scheduler.clearTimeout(entry.retentionTimer);
          entry.retentionTimer = undefined;
        }
      }
      return count;
    },
  };
}
