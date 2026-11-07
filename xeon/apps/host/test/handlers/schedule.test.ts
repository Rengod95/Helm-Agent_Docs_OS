import { expect, test } from "bun:test";
import { err, ok, parse } from "@fresnel/contracts";
import type { ScheduleService } from "@fresnel/cap-schedule";
import type { RunView, ScheduleEntryView } from "@fresnel/contracts/capabilities";
import { WIRE_METHODS, type WireParams } from "@fresnel/contracts/wire";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M3b B1-SCH2. `schedule.*` 처리기는 엔진의 예약 서비스를 그대로 부르고, 기대한 실패를 `ok: false`의 `error` 값으로 옮긴다.
// 첫 호출이 `open()`으로 저장소를 읽고, 읽지 못하면 서비스의 다른 호출을 하지 않는다. 결과는 와이어 스키마에 맞아야 한다.

type ScheduleMethod = "schedule.create" | "schedule.list" | "schedule.cancel" | "schedule.fire";

const SCHEDULE_ID = "sch_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const OTHER_ID = "sch_01ARZ3NDEKTSV4RRFFQ69G5FAW";
const UNKNOWN_ID = "sch_01ARZ3NDEKTSV4RRFFQ69G5FAX";
const RUN_ID = "run_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const THREAD_ID = "thr_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const CREATED_AT = 1_767_571_200_000;
const TRIGGER = { kind: "interval", everySeconds: 300 } as const;

const INTERVAL_ENTRY: ScheduleEntryView = {
  id: SCHEDULE_ID,
  trigger: TRIGGER,
  prompt: "summarize the day",
  workspace: null,
  title: null,
  sessionKind: "cron",
  enabled: true,
  createdAt: CREATED_AT,
  nextDueAt: CREATED_AT + 300_000,
  lastStartedAt: null,
  iterations: 0,
  stoppedReason: null,
};

const RUN: RunView = {
  runId: RUN_ID,
  scheduleId: SCHEDULE_ID,
  firedBy: "interval",
  dueAt: CREATED_AT + 300_000,
  claimedAt: CREATED_AT + 300_000,
  missed: false,
  status: "started",
  threadId: THREAD_ID,
  startedAt: CREATED_AT + 300_000,
  endedAt: null,
  outcome: null,
  reason: null,
  skippedCount: 0,
};

/** 와이어 결과가 메서드의 결과 스키마에 맞는지 본다 */
function expectWireResult(method: ScheduleMethod, result: unknown): void {
  expect(parse(WIRE_METHODS[method].result, result).ok).toBe(true);
}

/** 엔진의 `outsideWatchPaths` 대역. 허용 범위 밖이라 감시되지 않는 경로를 고른다 */
type OutsideWatchPaths = (paths: readonly string[]) => readonly string[];

function serviceHost(
  schedule: Partial<ScheduleService>,
  mode: "service" | "in-process" | "stdio" = "service",
  outsideWatchPaths?: OutsideWatchPaths,
): FakeHost {
  return createFakeHost({
    mode,
    overrides: { schedule },
    ...(outsideWatchPaths === undefined ? {} : { outsideWatchPaths }),
  });
}

async function connected(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

const OPENED: Partial<ScheduleService> = { open: () => Promise.resolve(ok(undefined)) };

test("create passes the trigger, prompt, workspace, title and enabled through and returns the entry", async () => {
  const order: string[] = [];
  const seen: unknown[] = [];
  const host = serviceHost({
    open: () => {
      order.push("open");
      return Promise.resolve(ok(undefined));
    },
    create: (input) => {
      order.push("create");
      seen.push(input);
      return Promise.resolve(ok({ ...INTERVAL_ENTRY, enabled: false, nextDueAt: null }));
    },
  });
  const connection = await connected(host);
  const params: WireParams<"schedule.create"> = {
    trigger: TRIGGER,
    prompt: "summarize the day",
    workspace: "/work/notes",
    title: "Daily",
    enabled: false,
  };
  const result = await connection.request("schedule.create", params);

  expect(order).toEqual(["open", "create"]);
  expect(seen).toEqual([
    {
      trigger: TRIGGER,
      prompt: "summarize the day",
      workspace: "/work/notes",
      title: "Daily",
      enabled: false,
      // 와이어 호출은 호스트가 직접 낸 호출로 남는다
      createdBy: "host",
    },
  ]);
  expect(result).toEqual({
    ok: true,
    entry: { ...INTERVAL_ENTRY, enabled: false, nextDueAt: null },
    warnings: [],
  });
  expectWireResult("schedule.create", result);
  await connection.close();
});

test("create leaves out the optional fields the caller did not send", async () => {
  const seen: unknown[] = [];
  const host = serviceHost({
    ...OPENED,
    create: (input) => {
      seen.push(input);
      return Promise.resolve(ok(INTERVAL_ENTRY));
    },
  });
  const connection = await connected(host);
  await connection.request("schedule.create", { trigger: TRIGGER, prompt: "summarize the day" });
  expect(seen).toEqual([{ trigger: TRIGGER, prompt: "summarize the day", createdBy: "host" }]);
  await connection.close();
});

test("a file_watch trigger keeps its paths and debounce in the result", async () => {
  const fileWatch: ScheduleEntryView = {
    ...INTERVAL_ENTRY,
    trigger: {
      kind: "file_watch",
      paths: ["/work/notes/a.md", "/work/notes/b.md"],
      debounceMs: 2000,
    },
    nextDueAt: null,
  };
  const host = serviceHost({ ...OPENED, create: () => Promise.resolve(ok(fileWatch)) });
  const connection = await connected(host);
  const result = await connection.request("schedule.create", {
    trigger: fileWatch.trigger,
    prompt: "review the notes",
  });
  expect(result).toEqual({ ok: true, entry: fileWatch, warnings: [] });
  expectWireResult("schedule.create", result);
  await connection.close();
});

/** 호스트 하나에 연결해 요청 하나를 보내고 연결을 닫는다. 여러 호스트를 동시에 돌릴 때 쓴다 */
async function createOnce(host: FakeHost): Promise<unknown> {
  const connection = await connected(host);
  const result = await connection.request("schedule.create", {
    trigger: TRIGGER,
    prompt: "summarize the day",
  });
  await connection.close();
  return result;
}

test("outside service mode the entry is saved and the answer carries service_mode_off", async () => {
  const modes = ["in-process", "stdio"] as const;
  const results = await Promise.all(
    modes.map((mode) =>
      createOnce(
        serviceHost({ ...OPENED, create: () => Promise.resolve(ok(INTERVAL_ENTRY)) }, mode),
      ),
    ),
  );
  for (const result of results) {
    expect(result).toEqual({ ok: true, entry: INTERVAL_ENTRY, warnings: ["service_mode_off"] });
    expectWireResult("schedule.create", result);
  }
});

test("each create error kind comes back as the same error value", async () => {
  const failures = [
    { kind: "interval_too_short", minSeconds: 300 },
    { kind: "at_in_past" },
    { kind: "invalid_trigger", reason: "at_not_finite" },
    { kind: "limit_reached", max: 100 },
    { kind: "store_failed", message: "state file is not JSON" },
  ] as const;
  const results = await Promise.all(
    failures.map((failure) =>
      createOnce(serviceHost({ ...OPENED, create: () => Promise.resolve(err({ ...failure })) })),
    ),
  );
  expect(results).toEqual(failures.map((failure) => ({ ok: false, error: failure })));
  for (const result of results) expectWireResult("schedule.create", result);
});

test("a long store failure message and a long trigger reason are cut to the wire limits", async () => {
  const stored = serviceHost({
    open: () => Promise.resolve(err({ kind: "store_failed", message: "x".repeat(600) })),
  });
  const storedConnection = await connected(stored);
  const listed = await storedConnection.request("schedule.list", {});
  expect(listed).toEqual({ ok: false, error: { kind: "store_failed", message: "x".repeat(512) } });
  expectWireResult("schedule.list", listed);
  await storedConnection.close();

  const reasoned = serviceHost({
    ...OPENED,
    create: () => Promise.resolve(err({ kind: "invalid_trigger", reason: "y".repeat(300) })),
  });
  const reasonedConnection = await connected(reasoned);
  const rejected = await reasonedConnection.request("schedule.create", {
    trigger: { kind: "interval", everySeconds: 60 },
    prompt: "summarize the day",
  });
  expect(rejected).toEqual({
    ok: false,
    error: { kind: "invalid_trigger", reason: "y".repeat(200) },
  });
  expectWireResult("schedule.create", rejected);
  await reasonedConnection.close();
});

test("list pages back from the newest entry with limit and before, and a full walk reaches all 250 entries once", async () => {
  const entries: ScheduleEntryView[] = Array.from({ length: 250 }, (_unused, index) => ({
    ...INTERVAL_ENTRY,
    id: `sch_${String(index + 1).padStart(4, "0")}`,
  }));
  const host = serviceHost({ ...OPENED, list: () => entries, runs: () => [] });
  const connection = await connected(host);

  const first = await connection.request("schedule.list", {});
  if (!first.ok) throw new Error("the first page failed");
  expect(first.items).toHaveLength(200);
  expect(first.items[0]?.entry.id).toBe("sch_0051");
  expect(first.items.at(-1)?.entry.id).toBe("sch_0250");
  expect(first.nextBefore).toBe("sch_0051");
  expectWireResult("schedule.list", first);

  if (first.nextBefore === undefined) throw new Error("the first page has no cursor");
  const second = await connection.request("schedule.list", { before: first.nextBefore });
  if (!second.ok) throw new Error("the second page failed");
  expect(second.items).toHaveLength(50);
  expect(second.items[0]?.entry.id).toBe("sch_0001");
  expect(second.items.at(-1)?.entry.id).toBe("sch_0050");
  expect(second).not.toHaveProperty("nextBefore");

  const small = await connection.request("schedule.list", { limit: 3 });
  if (!small.ok) throw new Error("the small page failed");
  expect(small.items.map((item) => item.entry.id)).toEqual(["sch_0248", "sch_0249", "sch_0250"]);
  expect(small.nextBefore).toBe("sch_0248");
  await connection.close();
});

test("list filters by enabled and attaches the newest run of each entry", async () => {
  const off: ScheduleEntryView = {
    ...INTERVAL_ENTRY,
    id: OTHER_ID,
    enabled: false,
    nextDueAt: null,
    stoppedReason: "cancelled",
  };
  const asked: (readonly [string, number | undefined])[] = [];
  const host = serviceHost({
    ...OPENED,
    list: () => [INTERVAL_ENTRY, off],
    runs: (scheduleId, limit) => {
      asked.push([scheduleId, limit]);
      return scheduleId === SCHEDULE_ID ? [RUN] : [];
    },
  });
  const connection = await connected(host);

  const all = await connection.request("schedule.list", {});
  expect(all).toEqual({
    ok: true,
    items: [
      { entry: INTERVAL_ENTRY, lastRun: RUN, missedRuns: 0 },
      { entry: off, lastRun: null, missedRuns: 0 },
    ],
  });
  expectWireResult("schedule.list", all);
  // 한 줄마다 최근 기록 하나(limit 1)와 놓친 기한을 세려는 보관 기록 전부를 읽는다
  expect(asked).toEqual([
    [SCHEDULE_ID, 1],
    [SCHEDULE_ID, Number.MAX_SAFE_INTEGER],
    [OTHER_ID, 1],
    [OTHER_ID, Number.MAX_SAFE_INTEGER],
  ]);

  const enabled = await connection.request("schedule.list", { enabled: true });
  expect(enabled).toEqual({
    ok: true,
    items: [{ entry: INTERVAL_ENTRY, lastRun: RUN, missedRuns: 0 }],
  });
  expectWireResult("schedule.list", enabled);
  await connection.close();
});

test("list counts the missed deadlines in the retained runs: a skipped missed batch counts its skipped number and a caught-up missed run counts one", async () => {
  // 최신이 앞이다. 따라잡은 실행 하나(1), 건너뛴 묶음 하나(35), 평범한 실행(0)이라 합은 36이다
  const caughtUp: RunView = {
    ...RUN,
    runId: "run_caughtup",
    missed: true,
    status: "finished",
    outcome: "completed",
  };
  const skipped: RunView = {
    ...RUN,
    runId: "run_skipped",
    missed: true,
    status: "skipped",
    threadId: null,
    startedAt: null,
    outcome: null,
    reason: "missed",
    skippedCount: 35,
  };
  const plain: RunView = { ...RUN, runId: "run_plain", status: "finished", outcome: "completed" };
  const retained: RunView[] = [caughtUp, skipped, plain];
  const host = serviceHost({
    ...OPENED,
    list: () => [INTERVAL_ENTRY],
    runs: (scheduleId, limit) => (scheduleId === SCHEDULE_ID ? retained.slice(0, limit) : []),
  });
  const connection = await connected(host);
  const listed = await connection.request("schedule.list", {});
  expect(listed).toEqual({
    ok: true,
    items: [{ entry: INTERVAL_ENTRY, lastRun: caughtUp, missedRuns: 36 }],
  });
  expectWireResult("schedule.list", listed);
  await connection.close();
});

test("list names the file-watch paths outside the app's folders, only for file-watch entries, and leaves the key out otherwise", async () => {
  const outside = "/outside/secret";
  const fileWatch: ScheduleEntryView = {
    ...INTERVAL_ENTRY,
    id: OTHER_ID,
    trigger: { kind: "file_watch", paths: ["/work/notes", outside], debounceMs: 2000 },
    nextDueAt: null,
  };
  const inside: ScheduleEntryView = {
    ...INTERVAL_ENTRY,
    id: "sch_01ARZ3NDEKTSV4RRFFQ69G5FAY",
    trigger: { kind: "file_watch", paths: ["/work/inbox"], debounceMs: 2000 },
    nextDueAt: null,
  };
  const asked: (readonly string[])[] = [];
  const host = serviceHost(
    { ...OPENED, list: () => [INTERVAL_ENTRY, fileWatch, inside], runs: () => [] },
    "service",
    (paths) => {
      asked.push(paths);
      return paths.filter((path) => path === outside);
    },
  );
  const connection = await connected(host);
  const listed = await connection.request("schedule.list", {});
  expect(listed).toEqual({
    ok: true,
    items: [
      { entry: INTERVAL_ENTRY, lastRun: null, missedRuns: 0 },
      { entry: fileWatch, lastRun: null, missedRuns: 0, outsideWatchPaths: [outside] },
      { entry: inside, lastRun: null, missedRuns: 0 },
    ],
  });
  if (!listed.ok) throw new Error("the list failed");
  expect(listed.items[0]).not.toHaveProperty("outsideWatchPaths");
  expect(listed.items[2]).not.toHaveProperty("outsideWatchPaths");
  // 감시 경로가 없는 항목은 대역을 부르지 않고, 감시 항목은 자기 경로 전체를 받는다
  expect(asked).toEqual([["/work/notes", outside], ["/work/inbox"]]);
  expectWireResult("schedule.list", listed);
  await connection.close();
});

test("a failed open answers store_failed for all four methods and no other service operation runs", async () => {
  const failure = { kind: "store_failed", message: "state file is not JSON" } as const;
  const order: string[] = [];
  const host = serviceHost({
    open: () => {
      order.push("open");
      return Promise.resolve(err({ ...failure }));
    },
    create: () => {
      order.push("create");
      return Promise.resolve(ok(INTERVAL_ENTRY));
    },
    list: () => {
      order.push("list");
      return [];
    },
    runs: () => {
      order.push("runs");
      return [];
    },
    cancel: () => {
      order.push("cancel");
      return Promise.resolve(ok(INTERVAL_ENTRY));
    },
    fire: () => {
      order.push("fire");
      return Promise.resolve(ok(RUN));
    },
  });
  const connection = await connected(host);
  const create = await connection.request("schedule.create", {
    trigger: TRIGGER,
    prompt: "summarize the day",
  });
  const list = await connection.request("schedule.list", {});
  const cancel = await connection.request("schedule.cancel", { scheduleId: SCHEDULE_ID });
  const fire = await connection.request("schedule.fire", { scheduleId: SCHEDULE_ID });

  for (const [method, result] of [
    ["schedule.create", create],
    ["schedule.list", list],
    ["schedule.cancel", cancel],
    ["schedule.fire", fire],
  ] as const) {
    expect(result).toEqual({ ok: false, error: failure });
    expectWireResult(method, result);
  }
  expect(order).toEqual(["open", "open", "open", "open"]);
  await connection.close();
});

test("cancel answers not_found for an unknown id and the stopped entry for a known one", async () => {
  const stopped: ScheduleEntryView = {
    ...INTERVAL_ENTRY,
    enabled: false,
    nextDueAt: null,
    stoppedReason: "cancelled",
  };
  const host = serviceHost({
    ...OPENED,
    cancel: (scheduleId) =>
      Promise.resolve(scheduleId === SCHEDULE_ID ? ok(stopped) : err({ kind: "not_found" })),
  });
  const connection = await connected(host);

  const known = await connection.request("schedule.cancel", { scheduleId: SCHEDULE_ID });
  expect(known).toEqual({ ok: true, entry: stopped });
  expectWireResult("schedule.cancel", known);

  const unknown = await connection.request("schedule.cancel", { scheduleId: UNKNOWN_ID });
  expect(unknown).toEqual({ ok: false, error: { kind: "not_found" } });
  expectWireResult("schedule.cancel", unknown);
  await connection.close();
});

test("fire answers the run record for a remote trigger, not_remote for other triggers and not_found for an unknown id", async () => {
  const remoteRun: RunView = { ...RUN, scheduleId: OTHER_ID, firedBy: "remote" };
  const host = serviceHost({
    ...OPENED,
    fire: (scheduleId) => {
      if (scheduleId === OTHER_ID) return Promise.resolve(ok(remoteRun));
      if (scheduleId === SCHEDULE_ID) return Promise.resolve(err({ kind: "not_remote" }));
      return Promise.resolve(err({ kind: "not_found" }));
    },
  });
  const connection = await connected(host);

  const fired = await connection.request("schedule.fire", { scheduleId: OTHER_ID });
  expect(fired).toEqual({ ok: true, run: remoteRun });
  expectWireResult("schedule.fire", fired);

  const notRemote = await connection.request("schedule.fire", { scheduleId: SCHEDULE_ID });
  expect(notRemote).toEqual({ ok: false, error: { kind: "not_remote" } });
  expectWireResult("schedule.fire", notRemote);

  const missing = await connection.request("schedule.fire", { scheduleId: UNKNOWN_ID });
  expect(missing).toEqual({ ok: false, error: { kind: "not_found" } });
  expectWireResult("schedule.fire", missing);
  await connection.close();
});

test("fire answers disabled for a switched-off remote trigger", async () => {
  const host = serviceHost({ ...OPENED, fire: () => Promise.resolve(err({ kind: "disabled" })) });
  const connection = await connected(host);
  const result = await connection.request("schedule.fire", { scheduleId: OTHER_ID });
  expect(result).toEqual({ ok: false, error: { kind: "disabled" } });
  expectWireResult("schedule.fire", result);
  await connection.close();
});

// l2/F-01: 앞 200건만 보여 새 예약이 목록에서 사라졌다
test("list keeps the newest 200 entries when the store holds more", async () => {
  const entries = Array.from({ length: 201 }, (_unused, index) => ({
    ...INTERVAL_ENTRY,
    id: `sch_${String(index)}`,
  }));
  const host = serviceHost({ ...OPENED, list: () => entries, runs: () => [] });
  const connection = await connected(host);
  const listed = await connection.request("schedule.list", {});
  expect(listed.ok).toBe(true);
  if (!listed.ok) throw new Error("list failed");
  expect(listed.items).toHaveLength(200);
  expect(listed.items[0]?.entry.id).toBe("sch_1");
  expect(listed.items.at(-1)?.entry.id).toBe("sch_200");
  await connection.close();
});
