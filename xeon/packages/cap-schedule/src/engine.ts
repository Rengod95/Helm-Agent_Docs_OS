import { assertNever, attemptAsync, detach, err, ok, type Result } from "@xeon/contracts";
import type { Unsubscribe } from "@xeon/contracts/extensions";
import { everyMsOf, planDue } from "./due.ts";
import {
  CRON_SESSION_KIND,
  DEFAULT_POLICY,
  EMPTY_STATE,
  type CancelError,
  type CreateError,
  type CreateInput,
  type FireError,
  type RunOutcome,
  type RunRecord,
  type RunSkipReason,
  type ScheduleDeps,
  type ScheduleEntry,
  type ScheduleService,
  type ScheduleState,
  type StopReason,
  type StoreFailure,
  type TriggerKind,
} from "./types.ts";

// L2.schedule.spec 4.4. 예약 상태 기계: claim(저장) → 실행 시작 → 정착 → 결과 기록.
// 상태는 메모리에 두고 바뀔 때마다 저장소에 쓴다. 재시작하면 저장소에서 읽어 복구한다(진행 중이던 실행은 host_exit).

const HOUR_MS = 3_600_000;

function stopPatch(reason: StopReason): Partial<ScheduleEntry> {
  return { enabled: false, nextDueAt: null, stoppedReason: reason };
}

/** 항목을 앞에서부터 하나씩 처리한다(상태 저장이 순서대로 쌓여야 한다) */
async function eachSequential<T>(
  items: readonly T[],
  work: (item: T) => Promise<unknown>,
): Promise<void> {
  await items.reduce<Promise<unknown>>(
    (previous, item) => previous.then(() => work(item)),
    Promise.resolve(),
  );
}

function firstDueOf(input: CreateInput, now: number): number | null {
  switch (input.trigger.kind) {
    case "interval":
      return now + input.trigger.everySeconds * 1000;
    case "at":
      return input.trigger.atMs;
    case "loop":
      return now;
    case "file_watch":
    case "remote":
      return null;
    default:
      return assertNever(input.trigger, "firstDueOf");
  }
}

/**
 * 저장소 호출 하나를 `Result`로 받는다. 저장소가 Result 대신 던지면 저장소 실패 값으로 바꾼다(TY-25).
 * 던짐을 그대로 두면 저장 순서열이나 읽기 기억이 거부된 채 남아 이후 호출이 모두 실패한다.
 */
function storeCall<T>(
  call: () => PromiseLike<Result<T, StoreFailure>>,
): Promise<Result<T, StoreFailure>> {
  return attemptAsync(call).then((attempt): Result<T, StoreFailure> =>
    attempt.ok
      ? attempt.value
      : err({
          kind: "store_failed",
          message: attempt.error.cause instanceof Error ? attempt.error.cause.message : "unknown",
        }),
  );
}

export function createScheduleService(deps: ScheduleDeps): ScheduleService {
  const policy = { ...DEFAULT_POLICY, ...deps.policy };
  const listeners = new Set<() => void>();
  const watchers = new Map<string, Unsubscribe>();
  /** 파일 감시 항목별 첫 변경 시각. 틱이 디바운스 시간이 지났는지 보고 실행한다 */
  const signals = new Map<string, number>();
  let state: ScheduleState = EMPTY_STATE;
  let saving: Promise<unknown> = Promise.resolve();
  let stopTicker: Unsubscribe | null = null;
  let started = false;
  let ticking = false;
  /** 저장소를 한 번 읽어 `state`에 올렸는가. 읽기에 실패하면 거짓으로 남아 쓰기가 막힌다 */
  let loaded = false;
  let loading: Promise<Result<void, StoreFailure>> | null = null;

  /**
   * 저장소를 한 번 읽는다. 읽기에 실패한 상태(손상된 파일 포함)에서 쓰면 빈 상태로 파일을 덮어 쓰므로,
   * 성공하기 전에는 `create`·`cancel`·`fire`·`start`가 저장소 실패 값을 돌려주고 아무것도 쓰지 않는다.
   * 실패는 기억하지 않아 파일을 고친 뒤 다음 호출이 다시 읽는다.
   */
  function ensureLoaded(): Promise<Result<void, StoreFailure>> {
    if (loaded) return Promise.resolve(ok(undefined));
    if (loading !== null) return loading;
    const pending = storeCall(() => deps.store.load()).then(
      (result): Result<void, StoreFailure> => {
        loading = null;
        if (!result.ok) {
          deps.report?.("schedule.load_failed", { message: result.error.message });
          return result;
        }
        state = result.value;
        loaded = true;
        return ok(undefined);
      },
    );
    loading = pending;
    return pending;
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }

  /** 기다리지 않는 작업. 거부는 보고한다(종료가 정착을 기다리지 않으므로 별도 추적은 하지 않는다) */
  function track(work: Promise<unknown>, label: string): void {
    detach(work, (cause) => {
      deps.report?.("schedule.background_failed", { label, cause: String(cause) });
    });
  }

  /** 상태를 바꾸고 저장한다. 저장은 호출 순서대로 하나씩 돈다 */
  async function commit(next: ScheduleState): Promise<Result<void, StoreFailure>> {
    state = {
      ...next,
      runs:
        next.runs.length > policy.maxRunRecords
          ? next.runs.slice(next.runs.length - policy.maxRunRecords)
          : next.runs,
    };
    const snapshot = state;
    const saved = saving.then(() => storeCall(() => deps.store.save(snapshot)));
    saving = saved;
    const result = await saved;
    notify();
    if (!result.ok) deps.report?.("schedule.save_failed", { message: result.error.message });
    return result;
  }

  function withEntry(id: string, patch: Partial<ScheduleEntry>, base = state): ScheduleState {
    return {
      ...base,
      entries: base.entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    };
  }

  function withRun(run: RunRecord, base = state): ScheduleState {
    const exists = base.runs.some((candidate) => candidate.runId === run.runId);
    return {
      ...base,
      runs: exists
        ? base.runs.map((candidate) => (candidate.runId === run.runId ? run : candidate))
        : [...base.runs, run],
    };
  }

  function entryOf(id: string): ScheduleEntry | undefined {
    return state.entries.find((entry) => entry.id === id);
  }

  function runOf(id: string): RunRecord | undefined {
    return state.runs.find((run) => run.runId === id);
  }

  function skippedRun(
    entry: ScheduleEntry,
    firedBy: TriggerKind,
    dueAt: number,
    now: number,
    reason: RunSkipReason,
    count: number,
  ): RunRecord {
    return {
      runId: deps.ids.next("run"),
      scheduleId: entry.id,
      firedBy,
      dueAt,
      claimedAt: now,
      missed: reason === "missed" || reason === "too_old",
      status: "skipped",
      threadId: null,
      startedAt: null,
      endedAt: null,
      outcome: null,
      reason,
      skippedCount: count,
    };
  }

  /** 실행을 막는 사유. 없으면 null. 루프는 반복 사이에 최소 간격을 따로 갖는다 */
  function gateOf(entry: ScheduleEntry, now: number): RunSkipReason | null {
    const running = state.runs.some(
      (run) =>
        run.scheduleId === entry.id && (run.status === "claimed" || run.status === "started"),
    );
    if (running) return "overlap";
    if (
      entry.trigger.kind !== "loop" &&
      entry.lastStartedAt !== null &&
      now - entry.lastStartedAt < policy.minIntervalMs
    ) {
      return "min_interval";
    }
    const recent = state.runs.filter(
      (run) => run.status !== "skipped" && now - run.claimedAt < HOUR_MS,
    ).length;
    if (recent >= policy.maxRunsPerHour) return "rate_limited";
    return null;
  }

  function dropWatcher(id: string): void {
    watchers.get(id)?.();
    watchers.delete(id);
    signals.delete(id);
  }

  function installWatcher(entry: ScheduleEntry): void {
    if (entry.trigger.kind !== "file_watch" || !entry.enabled || watchers.has(entry.id)) return;
    const id = entry.id;
    watchers.set(
      id,
      deps.watcher.watch(entry.trigger.paths, () => {
        if (!signals.has(id)) signals.set(id, deps.clock.now());
      }),
    );
  }

  /** claim을 저장한 뒤 세션을 시작한다. `base`는 claim과 함께 쓸 항목 변경이 이미 반영된 상태다 */
  async function claimAndBegin(
    entry: ScheduleEntry,
    firedBy: TriggerKind,
    dueAt: number,
    missed: boolean,
    now: number,
    base: ScheduleState,
  ): Promise<RunRecord> {
    const claimed: RunRecord = {
      runId: deps.ids.next("run"),
      scheduleId: entry.id,
      firedBy,
      dueAt,
      claimedAt: now,
      missed,
      status: "claimed",
      threadId: null,
      startedAt: null,
      endedAt: null,
      outcome: null,
      reason: null,
      skippedCount: 0,
    };
    const patched = withEntry(
      entry.id,
      {
        lastStartedAt: now,
        iterations: entry.trigger.kind === "loop" ? entry.iterations + 1 : entry.iterations,
      },
      base,
    );
    const saved = await commit(withRun(claimed, patched));
    if (!saved.ok) {
      // 저장하지 못한 claim으로는 시작하지 않는다. 재시작 뒤 중복 실행을 막기 위해서다
      const failed: RunRecord = {
        ...claimed,
        status: "failed",
        endedAt: now,
        reason: "start_failed",
      };
      state = withRun(failed);
      return failed;
    }
    return await begin(claimed);
  }

  async function begin(run: RunRecord): Promise<RunRecord> {
    const entry = entryOf(run.scheduleId);
    if (entry === undefined) return run;
    const result = await deps.runner.start({
      scheduleId: entry.id,
      runId: run.runId,
      dueAt: run.dueAt,
      firedBy: run.firedBy,
      prompt: entry.prompt,
      workspace: entry.workspace,
      title: entry.title,
      sessionKind: CRON_SESSION_KIND,
      requestId: `${entry.id}:${run.dueAt}`,
    });
    const now = deps.clock.now();
    if (!result.ok) {
      const failed: RunRecord = { ...run, status: "failed", endedAt: now, reason: "start_failed" };
      const next = withRun(failed);
      await commit(
        entry.trigger.kind === "loop" ? withEntry(entry.id, stopPatch("run_failed"), next) : next,
      );
      return failed;
    }
    const startedRun: RunRecord = {
      ...run,
      status: "started",
      threadId: result.value.threadId,
      startedAt: now,
    };
    await commit(withRun(startedRun));
    track(
      result.value.settled.then((outcome) => finish(run.runId, outcome)),
      "finish",
    );
    return startedRun;
  }

  async function finish(runId: string, outcome: RunOutcome): Promise<void> {
    const run = runOf(runId);
    if (run === undefined || run.status !== "started") return;
    const now = deps.clock.now();
    const failed = outcome === "failed";
    const ended: RunRecord = {
      ...run,
      status: failed ? "failed" : "finished",
      endedAt: now,
      outcome,
      reason: failed ? "run_failed" : null,
    };
    let next = withRun(ended);
    const entry = entryOf(run.scheduleId);
    if (entry !== undefined && entry.trigger.kind === "loop" && entry.enabled) {
      const trigger = entry.trigger;
      if (outcome !== "completed") {
        next = withEntry(
          entry.id,
          stopPatch(outcome === "aborted" ? "cancelled" : "run_failed"),
          next,
        );
      } else if (entry.iterations >= trigger.maxIterations) {
        next = withEntry(entry.id, stopPatch("max_iterations"), next);
      } else if (now + trigger.intervalSeconds * 1000 >= trigger.expiresAtMs) {
        next = withEntry(entry.id, stopPatch("expired"), next);
      } else {
        next = withEntry(entry.id, { nextDueAt: now + trigger.intervalSeconds * 1000 }, next);
      }
    }
    await commit(next);
  }

  /** 기한이 된 타이머·루프 항목 하나를 처리한다 */
  async function dueStep(entry: ScheduleEntry, now: number): Promise<void> {
    if (entry.nextDueAt === null) return;
    const kind = entry.trigger.kind;
    const plan = planDue(entry.nextDueAt, everyMsOf(entry), now, policy);
    // at은 한 번으로 끝난다. 루프의 다음 기한은 실행이 정착한 뒤에 정한다
    const entryPatch: Partial<ScheduleEntry> =
      kind === "interval"
        ? { nextDueAt: plan.nextDueAt }
        : kind === "at"
          ? stopPatch("completed")
          : { nextDueAt: null };
    let base = withEntry(entry.id, entryPatch);
    if (plan.skipped !== null) {
      base = withRun(
        skippedRun(
          entry,
          kind,
          plan.skipped.firstDueAt,
          now,
          plan.skipped.reason,
          plan.skipped.count,
        ),
        base,
      );
    }
    if (plan.fire === null) {
      // 너무 오래된 루프 반복은 따라잡지 않고 멈춘다
      await commit(kind === "loop" ? withEntry(entry.id, stopPatch("expired"), base) : base);
      return;
    }
    const blocked = gateOf(entry, now);
    if (blocked !== null) {
      const withSkip = withRun(skippedRun(entry, kind, plan.fire.dueAt, now, blocked, 1), base);
      await commit(
        kind === "loop" ? withEntry(entry.id, stopPatch("run_failed"), withSkip) : withSkip,
      );
      return;
    }
    await claimAndBegin(entry, kind, plan.fire.dueAt, plan.fire.missed, now, base);
  }

  async function signalStep(id: string, firstAt: number, now: number): Promise<void> {
    const entry = entryOf(id);
    if (entry === undefined || !entry.enabled || entry.trigger.kind !== "file_watch") {
      dropWatcher(id);
      return;
    }
    if (now - firstAt < entry.trigger.debounceMs) return;
    signals.delete(id);
    const blocked = gateOf(entry, now);
    if (blocked !== null) {
      await commit(withRun(skippedRun(entry, "file_watch", now, now, blocked, 1)));
      return;
    }
    await claimAndBegin(entry, "file_watch", now, false, now, state);
  }

  async function tick(): Promise<void> {
    if (!started || ticking) return;
    ticking = true;
    try {
      const now = deps.clock.now();
      const due = state.entries.filter(
        (entry) => entry.enabled && entry.nextDueAt !== null && entry.nextDueAt <= now,
      );
      await eachSequential(due, async (entry) => {
        const current = entryOf(entry.id);
        if (current !== undefined && current.enabled) await dueStep(current, now);
      });
      await eachSequential(Array.from(signals.entries()), ([id, firstAt]) =>
        signalStep(id, firstAt, now),
      );
    } finally {
      ticking = false;
    }
  }

  function validate(input: CreateInput, now: number): CreateError | null {
    if (input.prompt.trim().length === 0)
      return { kind: "invalid_trigger", reason: "prompt_empty" };
    const trigger = input.trigger;
    switch (trigger.kind) {
      case "interval":
        if (!Number.isFinite(trigger.everySeconds)) {
          return { kind: "invalid_trigger", reason: "interval_not_finite" };
        }
        if (trigger.everySeconds * 1000 < policy.minIntervalMs) {
          return { kind: "interval_too_short", minSeconds: Math.ceil(policy.minIntervalMs / 1000) };
        }
        return null;
      case "at":
        if (!Number.isFinite(trigger.atMs))
          return { kind: "invalid_trigger", reason: "at_not_finite" };
        return trigger.atMs <= now ? { kind: "at_in_past" } : null;
      case "file_watch":
        if (trigger.paths.length === 0 || trigger.paths.some((path) => path.length === 0)) {
          return { kind: "invalid_trigger", reason: "paths_empty" };
        }
        return Number.isFinite(trigger.debounceMs) && trigger.debounceMs >= 0
          ? null
          : { kind: "invalid_trigger", reason: "debounce_invalid" };
      case "remote":
        return null;
      case "loop":
        if (!Number.isFinite(trigger.intervalSeconds) || trigger.intervalSeconds < 0) {
          return { kind: "invalid_trigger", reason: "loop_interval_invalid" };
        }
        if (!Number.isInteger(trigger.maxIterations) || trigger.maxIterations < 1) {
          return { kind: "invalid_trigger", reason: "loop_max_iterations_invalid" };
        }
        return trigger.expiresAtMs > now
          ? null
          : { kind: "invalid_trigger", reason: "loop_expiry_in_past" };
      default:
        return assertNever(trigger, "validate");
    }
  }

  function stop(): void {
    stopTicker?.();
    stopTicker = null;
    for (const id of Array.from(watchers.keys())) dropWatcher(id);
    started = false;
  }

  return {
    open: ensureLoaded,

    async create(input) {
      const opened = await ensureLoaded();
      if (!opened.ok) return opened;
      const now = deps.clock.now();
      const invalid = validate(input, now);
      if (invalid !== null) return err(invalid);
      const enabled = input.enabled ?? true;
      if (enabled && state.entries.filter((entry) => entry.enabled).length >= policy.maxActive) {
        return err({ kind: "limit_reached", max: policy.maxActive });
      }
      const entry: ScheduleEntry = {
        id: deps.ids.next("sch"),
        trigger: input.trigger,
        prompt: input.prompt,
        workspace: input.workspace ?? null,
        title: input.title ?? null,
        sessionKind: CRON_SESSION_KIND,
        enabled,
        createdAt: now,
        nextDueAt: enabled ? firstDueOf(input, now) : null,
        lastStartedAt: null,
        iterations: 0,
        stoppedReason: null,
      };
      const saved = await commit({ ...state, entries: [...state.entries, entry] });
      if (!saved.ok) return saved;
      if (started) installWatcher(entry);
      return ok(entry);
    },

    list: () => state.entries,

    async cancel(scheduleId) {
      const opened = await ensureLoaded();
      if (!opened.ok) return opened;
      const entry = entryOf(scheduleId);
      if (entry === undefined) return err<CancelError>({ kind: "not_found" });
      if (!entry.enabled) return ok(entry);
      dropWatcher(scheduleId);
      const saved = await commit(withEntry(scheduleId, stopPatch("cancelled")));
      if (!saved.ok) return saved;
      const after = entryOf(scheduleId);
      return after === undefined ? err({ kind: "not_found" }) : ok(after);
    },

    runs(scheduleId, limit = 20) {
      return state.runs
        .filter((run) => run.scheduleId === scheduleId)
        .slice(-limit)
        .toReversed();
    },

    async fire(scheduleId) {
      const opened = await ensureLoaded();
      if (!opened.ok) return opened;
      const entry = entryOf(scheduleId);
      if (entry === undefined) return err<FireError>({ kind: "not_found" });
      if (entry.trigger.kind !== "remote") return err({ kind: "not_remote" });
      if (!entry.enabled) return err({ kind: "disabled" });
      const now = deps.clock.now();
      const blocked = gateOf(entry, now);
      if (blocked !== null) {
        const skipped = skippedRun(entry, "remote", now, now, blocked, 1);
        const saved = await commit(withRun(skipped));
        return saved.ok ? ok(skipped) : saved;
      }
      return ok(await claimAndBegin(entry, "remote", now, false, now, state));
    },

    async start() {
      if (started) return ok(undefined);
      const opened = await ensureLoaded();
      if (!opened.ok) return opened;
      const now = deps.clock.now();
      // 재시작 복구(spec 4.4.5): claim만 된 실행은 같은 키로 다시 시작하고, 시작한 실행은 host_exit로 닫는다.
      // 루프는 자동으로 다시 시작하지 않는다(spec 4.1.5)
      let recovered = state;
      const resume: RunRecord[] = [];
      for (const run of state.runs) {
        if (run.status === "claimed") {
          resume.push(run);
        } else if (run.status === "started") {
          recovered = withRun(
            { ...run, status: "failed", endedAt: now, reason: "host_exit" },
            recovered,
          );
          const entry = recovered.entries.find((candidate) => candidate.id === run.scheduleId);
          if (entry !== undefined && entry.trigger.kind === "loop" && entry.enabled) {
            recovered = withEntry(entry.id, stopPatch("host_exit"), recovered);
          }
        }
      }
      if (recovered !== state) {
        const saved = await commit(recovered);
        if (!saved.ok) return saved;
      }
      started = true;
      for (const entry of state.entries) installWatcher(entry);
      stopTicker = deps.ticker.every(policy.tickMs, () => {
        track(tick(), "tick");
      });
      await eachSequential(resume, begin);
      await tick();
      return ok(undefined);
    },

    stop,

    tick,

    pendingSchedules() {
      const waiting = state.entries.filter(
        (entry) =>
          entry.enabled &&
          ((entry.nextDueAt !== null && entry.trigger.kind !== "loop") ||
            entry.trigger.kind === "file_watch"),
      ).length;
      const active = state.runs.filter(
        (run) => run.status === "claimed" || run.status === "started",
      ).length;
      return waiting + active;
    },

    liveSchedulerTasks: () =>
      state.entries.filter((entry) => entry.enabled && entry.trigger.kind === "loop").length,

    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async close() {
      stop();
      await saving;
    },
  };
}
