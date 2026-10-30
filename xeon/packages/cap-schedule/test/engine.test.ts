import { expect, test } from "bun:test";
import { CRON_SESSION_KIND, type ScheduleService, type StoreFailure } from "../src/index.ts";
import {
  createHarness,
  HOUR,
  MemoryStore,
  MINUTE,
  SECOND,
  type Harness,
} from "./support/harness.ts";

async function started(h: Harness): Promise<Harness> {
  const result = await h.service.start();
  expect(result.ok).toBe(true);
  return h;
}

async function created(service: ScheduleService, input: Parameters<ScheduleService["create"]>[0]) {
  const result = await service.create(input);
  if (!result.ok) throw new Error(`create failed: ${result.error.kind}`);
  return result.value;
}

test("an interval timer fires on its due time in a cron session and records started then finished", async () => {
  const h = await started(createHarness());
  const entry = await created(h.service, {
    trigger: { kind: "interval", everySeconds: 600 },
    prompt: "check mail",
  });
  expect(entry.sessionKind).toBe(CRON_SESSION_KIND);
  expect(entry.nextDueAt).toBe(h.clock.now + 600 * SECOND);

  h.clock.now += 599 * SECOND;
  await h.service.tick();
  expect(h.runner.started).toHaveLength(0);

  h.clock.now += 1 * SECOND;
  await h.service.tick();
  expect(h.runner.started).toHaveLength(1);
  const request = h.runner.started[0]?.request;
  expect(request).toMatchObject({
    scheduleId: entry.id,
    prompt: "check mail",
    sessionKind: "cron",
    firedBy: "interval",
  });
  expect(request?.requestId).toBe(`${entry.id}:${h.clock.now}`);
  expect(h.service.runs(entry.id)[0]).toMatchObject({
    status: "started",
    threadId: "thr_1",
    missed: false,
  });
  expect(h.service.list()[0]?.nextDueAt).toBe(h.clock.now + 600 * SECOND);

  h.runner.started[0]?.settle("completed");
  await settleAll(h);
  expect(h.service.runs(entry.id)[0]).toMatchObject({ status: "finished", outcome: "completed" });
});

test("intervals under 300 seconds are rejected at creation and a second fire inside the minimum interval is skipped", async () => {
  const h = await started(createHarness());
  const tooShort = await h.service.create({
    trigger: { kind: "interval", everySeconds: 299 },
    prompt: "x",
  });
  expect(tooShort).toEqual({ ok: false, error: { kind: "interval_too_short", minSeconds: 300 } });
  expect(
    (await h.service.create({ trigger: { kind: "interval", everySeconds: 300 }, prompt: "x" })).ok,
  ).toBe(true);

  // 원격 트리거는 최소 간격을 지켜야 한다
  const remote = await created(h.service, { trigger: { kind: "remote" }, prompt: "go" });
  const first = await h.service.fire(remote.id);
  expect(first.ok && first.value.status).toBe("started");
  h.runner.started[0]?.settle("completed");
  await settleAll(h);
  h.clock.now += 299 * SECOND;
  const second = await h.service.fire(remote.id);
  expect(second.ok && second.value).toMatchObject({ status: "skipped", reason: "min_interval" });
  h.clock.now += 1 * SECOND;
  const third = await h.service.fire(remote.id);
  expect(third.ok && third.value.status).toBe("started");
});

test("after downtime the schedule catches up exactly once and skips the rest as missed", async () => {
  const store = new MemoryStore();
  const first = await started(createHarness({ store }));
  const entry = await created(first.service, {
    trigger: { kind: "interval", everySeconds: 300 },
    prompt: "report",
  });
  const createdAt = first.clock.now;
  first.service.stop();

  // 호스트가 3시간 꺼져 있었다: 36번의 기한이 지나갔다
  const second = createHarness({ store, clock: { now: createdAt + 3 * HOUR + 200 * SECOND } });
  expect((await second.service.start()).ok).toBe(true);
  expect(second.runner.started).toHaveLength(1);
  const runs = second.service.runs(entry.id);
  const skipped = runs.find((run) => run.status === "skipped");
  const fired = runs.find((run) => run.status === "started");
  expect(fired).toMatchObject({ missed: true });
  expect(skipped).toMatchObject({ reason: "missed", skippedCount: 35 });
  expect(second.service.list()[0]?.nextDueAt).toBeGreaterThan(second.clock.now);

  // 같은 틱을 다시 돌려도 더 실행하지 않는다
  await second.service.tick();
  expect(second.runner.started).toHaveLength(1);
});

test("a one-shot at timer runs once, then disables itself; a past at time is rejected", async () => {
  const h = await started(createHarness());
  expect(
    await h.service.create({ trigger: { kind: "at", atMs: h.clock.now - 1 }, prompt: "x" }),
  ).toEqual({
    ok: false,
    error: { kind: "at_in_past" },
  });
  const entry = await created(h.service, {
    trigger: { kind: "at", atMs: h.clock.now + 10 * MINUTE },
    prompt: "once",
  });
  h.clock.now += 10 * MINUTE;
  await h.service.tick();
  expect(h.runner.started).toHaveLength(1);
  expect(h.service.list()[0]).toMatchObject({
    id: entry.id,
    enabled: false,
    nextDueAt: null,
    stoppedReason: "completed",
  });
  h.clock.now += HOUR;
  await h.service.tick();
  expect(h.runner.started).toHaveLength(1);
});

test("a file watch fires after the debounce and coalesces changes made while its run is active", async () => {
  const h = await started(createHarness());
  const entry = await created(h.service, {
    trigger: { kind: "file_watch", paths: ["/work/notes"], debounceMs: 5000 },
    prompt: "summarize changes",
  });
  expect(h.watches).toHaveLength(1);
  expect(h.watches[0]?.paths).toEqual(["/work/notes"]);
  h.watches[0]?.fire();
  h.watches[0]?.fire();
  h.clock.now += 4 * SECOND;
  await h.service.tick();
  expect(h.runner.started).toHaveLength(0);
  h.clock.now += 1 * SECOND;
  await h.service.tick();
  expect(h.runner.started).toHaveLength(1);
  expect(h.runner.started[0]?.request.firedBy).toBe("file_watch");

  // 실행 중에 또 바뀌면 겹치지 않고 건너뛴다
  h.watches[0]?.fire();
  h.clock.now += 10 * SECOND;
  await h.service.tick();
  expect(h.runner.started).toHaveLength(1);
  expect(h.service.runs(entry.id)[0]).toMatchObject({ status: "skipped", reason: "overlap" });
});

test("a loop reruns after each settle until max iterations, counts as a live task, and stops on expiry", async () => {
  const h = await started(createHarness());
  const entry = await created(h.service, {
    trigger: {
      kind: "loop",
      intervalSeconds: 60,
      maxIterations: 2,
      expiresAtMs: h.clock.now + HOUR,
    },
    prompt: "poll",
  });
  expect(h.service.liveSchedulerTasks()).toBe(1);
  await h.service.tick();
  expect(h.runner.started).toHaveLength(1);
  // 실행 중에는 다음 기한이 없다
  expect(h.service.list()[0]?.nextDueAt).toBeNull();
  h.runner.started[0]?.settle("completed");
  await settleAll(h);
  expect(h.service.list()[0]?.nextDueAt).toBe(h.clock.now + 60 * SECOND);
  expect(h.service.liveSchedulerTasks()).toBe(1);
  expect(entry.trigger.kind).toBe("loop");
});

test("a loop stops with max_iterations after its last iteration and with expired when the next one would pass the expiry", async () => {
  const h = await started(createHarness());
  await created(h.service, {
    trigger: {
      kind: "loop",
      intervalSeconds: 60,
      maxIterations: 2,
      expiresAtMs: h.clock.now + HOUR,
    },
    prompt: "poll",
  });
  await h.service.tick();
  h.runner.started[0]?.settle("completed");
  await settleAll(h);
  h.clock.now += 60 * SECOND;
  await h.service.tick();
  expect(h.runner.started).toHaveLength(2);
  h.runner.started[1]?.settle("completed");
  await settleAll(h);
  expect(h.service.list()[0]).toMatchObject({
    enabled: false,
    stoppedReason: "max_iterations",
    iterations: 2,
  });
  expect(h.service.liveSchedulerTasks()).toBe(0);

  const e = await started(createHarness());
  await created(e.service, {
    trigger: {
      kind: "loop",
      intervalSeconds: 600,
      maxIterations: 10,
      expiresAtMs: e.clock.now + 5 * MINUTE,
    },
    prompt: "poll",
  });
  await e.service.tick();
  e.runner.started[0]?.settle("completed");
  await settleAll(e);
  expect(e.service.list()[0]).toMatchObject({ enabled: false, stoppedReason: "expired" });
});

test("a loop stops when its run is aborted or fails to start", async () => {
  const h = await started(createHarness());
  await created(h.service, {
    trigger: {
      kind: "loop",
      intervalSeconds: 0,
      maxIterations: 5,
      expiresAtMs: h.clock.now + HOUR,
    },
    prompt: "poll",
  });
  h.runner.failNext = true;
  await h.service.tick();
  expect(h.service.list()[0]).toMatchObject({ enabled: false, stoppedReason: "run_failed" });
  expect(h.service.runs(h.service.list()[0]?.id ?? "")[0]).toMatchObject({
    status: "failed",
    reason: "start_failed",
  });
});

test("pendingSchedules counts waiting timers, file watches and active runs, but not remote entries or loops between runs", async () => {
  const h = await started(createHarness());
  expect(h.service.pendingSchedules()).toBe(0);
  const timer = await created(h.service, {
    trigger: { kind: "interval", everySeconds: 300 },
    prompt: "a",
  });
  await created(h.service, {
    trigger: { kind: "file_watch", paths: ["/x"], debounceMs: 0 },
    prompt: "b",
  });
  await created(h.service, { trigger: { kind: "remote" }, prompt: "c" });
  expect(h.service.pendingSchedules()).toBe(2);
  let changes = 0;
  h.service.onChange(() => {
    changes += 1;
  });
  const cancelled = await h.service.cancel(timer.id);
  expect(cancelled.ok && cancelled.value).toMatchObject({
    enabled: false,
    stoppedReason: "cancelled",
  });
  expect(changes).toBeGreaterThan(0);
  expect(h.service.pendingSchedules()).toBe(1);
  expect(await h.service.cancel("nope")).toEqual({ ok: false, error: { kind: "not_found" } });
});

test("persistence: entries and runs survive a restart; claimed runs restart with the same request id, started runs close as host_exit", async () => {
  const store = new MemoryStore();
  const first = await started(createHarness({ store }));
  const entry = await created(first.service, {
    trigger: { kind: "interval", everySeconds: 300 },
    prompt: "p",
  });
  first.clock.now += 300 * SECOND;
  await first.service.tick();
  const requestId = first.runner.started[0]?.request.requestId;
  first.service.stop();

  // 재시작: 첫 실행은 started 상태로 저장돼 있었다
  const second = createHarness({ store, clock: { now: first.clock.now + 10 * SECOND } });
  await second.service.start();
  expect(second.service.list().map((e) => e.id)).toEqual([entry.id]);
  const runs = second.service.runs(entry.id);
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ status: "failed", reason: "host_exit" });
  expect(second.runner.started).toHaveLength(0);

  // claim만 저장되고 죽은 경우
  const claimedStore = new MemoryStore({
    version: 1,
    entries: store.saved.entries,
    runs: [
      {
        ...(runs[0] ?? failNow()),
        status: "claimed",
        reason: null,
        endedAt: null,
        startedAt: null,
        threadId: null,
      },
    ],
  });
  const third = createHarness({ store: claimedStore, clock: { now: second.clock.now } });
  await third.service.start();
  expect(third.runner.started).toHaveLength(1);
  expect(third.runner.started[0]?.request.requestId).toBe(requestId);
});

test("a loop that was running at restart is stopped with host_exit and not restarted", async () => {
  const store = new MemoryStore();
  const first = await started(createHarness({ store }));
  await created(first.service, {
    trigger: {
      kind: "loop",
      intervalSeconds: 60,
      maxIterations: 5,
      expiresAtMs: first.clock.now + HOUR,
    },
    prompt: "poll",
  });
  await first.service.tick();
  first.service.stop();
  const second = createHarness({ store, clock: { now: first.clock.now + SECOND } });
  await second.service.start();
  expect(second.service.list()[0]).toMatchObject({ enabled: false, stoppedReason: "host_exit" });
  expect(second.runner.started).toHaveLength(0);
});

test("a failed save of the claim means the run is not started", async () => {
  const h = await started(createHarness());
  const entry = await created(h.service, {
    trigger: { kind: "interval", everySeconds: 300 },
    prompt: "p",
  });
  h.store.failSaves = true;
  h.clock.now += 300 * SECOND;
  await h.service.tick();
  expect(h.runner.started).toHaveLength(0);
  expect(h.service.runs(entry.id)[0]).toMatchObject({ status: "failed", reason: "start_failed" });
});

test("the hourly run cap skips further runs as rate_limited", async () => {
  const h = await started(createHarness({ policy: { maxRunsPerHour: 2 } }));
  const remote = await created(h.service, { trigger: { kind: "remote" }, prompt: "go" });
  const fireAndSettle = async (index: number): Promise<void> => {
    const fired = await h.service.fire(remote.id);
    expect(fired.ok && fired.value.status).toBe("started");
    h.runner.started[index]?.settle("completed");
    await settleAll(h);
    h.clock.now += 5 * MINUTE;
  };
  await fireAndSettle(0);
  await fireAndSettle(1);
  const limited = await h.service.fire(remote.id);
  expect(limited.ok && limited.value).toMatchObject({ status: "skipped", reason: "rate_limited" });
});

test("start registers one tick period and stop releases the ticker and watchers", async () => {
  const h = await started(createHarness());
  expect(h.ticks.periods).toEqual([15_000]);
  await created(h.service, {
    trigger: { kind: "file_watch", paths: ["/x"], debounceMs: 0 },
    prompt: "b",
  });
  h.service.stop();
  expect(h.ticks.stopped).toBe(1);
  expect(h.watches[0]?.closed).toBe(true);
});

/** 항목 `sch_1`(원격)이 저장된 저장소. 새 서비스는 아직 읽지 않은 상태로 이 저장소를 받는다 */
async function storeWithRemoteEntry(): Promise<MemoryStore> {
  const seed = createHarness();
  await created(seed.service, { trigger: { kind: "remote" }, prompt: "go" });
  return new MemoryStore(seed.store.saved);
}

const CORRUPT: StoreFailure = { kind: "store_failed", message: "state file is not valid JSON" };

test("a state file that cannot be read blocks create, cancel, fire and start with store_failed and writes nothing until it is repaired", async () => {
  const store = await storeWithRemoteEntry();
  store.loadFailure = CORRUPT;
  const h = createHarness({ store, idStart: 100 });

  expect(
    await h.service.create({ trigger: { kind: "interval", everySeconds: 600 }, prompt: "x" }),
  ).toEqual({ ok: false, error: CORRUPT });
  expect(await h.service.cancel("sch_1")).toEqual({ ok: false, error: CORRUPT });
  expect(await h.service.fire("sch_1")).toEqual({ ok: false, error: CORRUPT });
  expect(await h.service.start()).toEqual({ ok: false, error: CORRUPT });
  expect(store.saves).toBe(0);
  expect(h.ticks.periods).toEqual([]);
  expect(h.watches).toEqual([]);
  expect(h.runner.started).toHaveLength(0);
  expect(store.saved.entries.map((entry) => entry.id)).toEqual(["sch_1"]);
  expect(store.saved.entries[0]?.enabled).toBe(true);

  // 파일을 고치면 다음 호출이 다시 읽고, 저장된 기존 항목은 덮어쓰이지 않는다
  store.loadFailure = null;
  const fixed = await h.service.create({
    trigger: { kind: "interval", everySeconds: 600 },
    prompt: "x",
  });
  expect(fixed.ok).toBe(true);
  expect(store.saves).toBe(1);
  expect(store.saved.entries.map((entry) => entry.id)).toEqual(["sch_1", "sch_101"]);
  expect(store.saved.entries[0]).toMatchObject({ prompt: "go", trigger: { kind: "remote" } });
});

test("a store whose load throws is reported as store_failed, and the next call reads the store again", async () => {
  const store = await storeWithRemoteEntry();
  store.loadThrows = true;
  const h = createHarness({ store, idStart: 100 });

  expect(await h.service.create({ trigger: { kind: "remote" }, prompt: "go" })).toEqual({
    ok: false,
    error: { kind: "store_failed", message: "load exploded" },
  });
  expect(store.saves).toBe(0);

  store.loadThrows = false;
  const fixed = await h.service.create({ trigger: { kind: "remote" }, prompt: "go" });
  expect(fixed.ok).toBe(true);
  expect(store.loads).toBe(2);
  expect(store.saved.entries.map((entry) => entry.id)).toEqual(["sch_1", "sch_101"]);
});

test("a save that throws is reported as store_failed, and the saves after it still go through", async () => {
  const store = new MemoryStore();
  const h = createHarness({ store });
  store.saveThrows = true;
  expect(await h.service.create({ trigger: { kind: "remote" }, prompt: "first" })).toEqual({
    ok: false,
    error: { kind: "store_failed", message: "save exploded" },
  });

  store.saveThrows = false;
  const second = await h.service.create({ trigger: { kind: "remote" }, prompt: "second" });
  expect(second.ok).toBe(true);
  expect(store.saved.entries.at(-1)).toMatchObject({ prompt: "second" });
});

test("the store is read once, lazily: create before start keeps the stored entries, and open() does not reload", async () => {
  const store = await storeWithRemoteEntry();
  const h = createHarness({ store, idStart: 100 });
  expect(store.loads).toBe(0);

  expect(await h.service.open()).toEqual({ ok: true, value: undefined });
  expect(await h.service.open()).toEqual({ ok: true, value: undefined });
  expect(store.loads).toBe(1);
  expect(h.service.list().map((entry) => entry.id)).toEqual(["sch_1"]);

  const made = await h.service.create({ trigger: { kind: "remote" }, prompt: "go" });
  expect(made.ok).toBe(true);
  expect(h.service.list().map((entry) => entry.id)).toEqual(["sch_1", "sch_101"]);
  expect((await h.service.start()).ok).toBe(true);
  expect(store.loads).toBe(1);
  expect(store.saved.entries.map((entry) => entry.id)).toEqual(["sch_1", "sch_101"]);
  await h.service.close();
});

async function settleAll(h: Harness): Promise<void> {
  // settled 약속에 걸린 finish가 끝나도록 마이크로태스크를 비운다
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(h.store.saves).toBeGreaterThan(0);
}

function failNow(): never {
  throw new Error("missing run");
}
