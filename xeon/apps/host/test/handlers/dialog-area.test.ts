import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import {
  WireError,
  wireError,
  type GoalView,
  type ScheduleRunRecord,
  type TaskView,
  type WireParams,
} from "@fresnel/contracts/wire";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// 대화 영역 처리기(W-05 `goal.status`, W-06 `work.tasks.list`, W-07 `schedule.update`·`schedule.runs`)를 가짜 포트 위에서 본다.
// 처리기는 포트가 돌려준 값을 옮기고 실패를 와이어 오류로 바꾼다. 포트 구현은 test/assembly/dialog-area-port.test.ts,
// 실제 엔진 위의 시험은 test/int/dialog-area.int.test.ts다. `review.get`은 다른 트랙이 채우므로 여기서 다루지 않는다.

const GOAL: GoalView = {
  condition: "the report section is written",
  status: "active",
  judged: 1,
  maxJudgments: 3,
  lastVerdict: { met: false, reason: "The section is still missing." },
};

const TASKS: TaskView[] = [
  { taskId: "t1", content: "write the code", status: "pending", blockedBy: null },
  { taskId: "t2", content: "test it", status: "done", blockedBy: "t1" },
];

const RUN: ScheduleRunRecord = {
  runId: "run_1",
  startedAt: "2027-01-15T08:01:00.000Z",
  endedAt: "2027-01-15T08:02:00.000Z",
  outcome: "ok",
  threadId: "thr_1",
  error: null,
};

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

async function open(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

test("goal.status hands the thread and the request's signal to the port and returns the goal it reports", async () => {
  const asked: { threadId: string; signal: AbortSignal }[] = [];
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        goalStatus: (threadId, signal) => {
          asked.push({ threadId, signal });
          return Promise.resolve(ok({ goal: GOAL }));
        },
      },
    },
  });
  const threadId = host.fake.ids.next("thr");
  const connection = await open(host);
  expect(await connection.request("goal.status", { threadId })).toEqual({ goal: GOAL });
  expect(asked.map((call) => call.threadId)).toEqual([threadId]);
  expect(asked[0]?.signal).toBeInstanceOf(AbortSignal);
  await connection.close();
});

test("goal.status returns goal null when the port reports no goal", async () => {
  const host = createFakeHost({
    overrides: { dialogArea: { goalStatus: () => Promise.resolve(ok({ goal: null })) } },
  });
  const connection = await open(host);
  expect(await connection.request("goal.status", { threadId: host.fake.ids.next("thr") })).toEqual({
    goal: null,
  });
  await connection.close();
});

test("work.tasks.list hands the thread and the request's signal to the port and returns the tasks it reports", async () => {
  const asked: { threadId: string; signal: AbortSignal }[] = [];
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        tasksList: (threadId, signal) => {
          asked.push({ threadId, signal });
          return Promise.resolve(ok({ tasks: TASKS }));
        },
      },
    },
  });
  const threadId = host.fake.ids.next("thr");
  const connection = await open(host);
  expect(await connection.request("work.tasks.list", { threadId })).toEqual({ tasks: TASKS });
  expect(asked.map((call) => call.threadId)).toEqual([threadId]);
  expect(asked[0]?.signal).toBeInstanceOf(AbortSignal);
  await connection.close();
});

test("schedule.update hands the given fields to the port and returns the result it reports", async () => {
  const received: WireParams<"schedule.update">[] = [];
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        scheduleUpdate: (params) => {
          received.push(params);
          return Promise.resolve(
            ok({
              scheduleId: params.scheduleId,
              enabled: true,
              nextRunAt: "2027-01-15T08:05:00.000Z",
            }),
          );
        },
      },
    },
  });
  const connection = await open(host);
  expect(
    await connection.request("schedule.update", {
      scheduleId: "sch_1",
      enabled: true,
      title: "weekly",
    }),
  ).toEqual({ scheduleId: "sch_1", enabled: true, nextRunAt: "2027-01-15T08:05:00.000Z" });
  expect(received).toStrictEqual([{ scheduleId: "sch_1", enabled: true, title: "weekly" }]);
  await connection.close();
});

test("schedule.runs hands the schedule and the limit to the port, and sends no limit when the caller gave none", async () => {
  const received: WireParams<"schedule.runs">[] = [];
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        scheduleRuns: (params) => {
          received.push(params);
          return Promise.resolve(ok({ runs: [RUN] }));
        },
      },
    },
  });
  const connection = await open(host);
  expect(await connection.request("schedule.runs", { scheduleId: "sch_1", limit: 5 })).toEqual({
    runs: [RUN],
  });
  expect(await connection.request("schedule.runs", { scheduleId: "sch_1" })).toEqual({
    runs: [RUN],
  });
  expect(received).toStrictEqual([{ scheduleId: "sch_1", limit: 5 }, { scheduleId: "sch_1" }]);
  await connection.close();
});

test("goal.status and work.tasks.list answer a thread the port cannot find with thread.notFound carrying the thread id", async () => {
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        goalStatus: (threadId) => Promise.resolve(err({ kind: "thread_not_found", threadId })),
        tasksList: (threadId) => Promise.resolve(err({ kind: "thread_not_found", threadId })),
      },
    },
  });
  const threadId = host.fake.ids.next("thr");
  const connection = await open(host);
  const goal = await wireErrorOf(connection.request("goal.status", { threadId }));
  const tasks = await wireErrorOf(connection.request("work.tasks.list", { threadId }));
  expect(goal.code).toBe(wireError("thread.notFound").code);
  expect(goal.data.kind).toBe("thread.notFound");
  expect(goal.data.details).toEqual({ threadId });
  expect(tasks.code).toBe(wireError("thread.notFound").code);
  expect(tasks.data.details).toEqual({ threadId });
  await connection.close();
});

test("goal.status and work.tasks.list answer a threadId that is not a thread id with thread.notFound, without asking the port", async () => {
  const asked: string[] = [];
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        goalStatus: () => {
          asked.push("goal.status");
          return Promise.resolve(ok({ goal: null }));
        },
        tasksList: () => {
          asked.push("work.tasks.list");
          return Promise.resolve(ok({ tasks: [] }));
        },
      },
    },
  });
  const connection = await open(host);
  const goal = await wireErrorOf(connection.request("goal.status", { threadId: "not-a-thread" }));
  const tasks = await wireErrorOf(
    connection.request("work.tasks.list", { threadId: "not-a-thread" }),
  );
  expect(goal.code).toBe(wireError("thread.notFound").code);
  expect(goal.data.details).toEqual({ threadId: "not-a-thread" });
  expect(tasks.code).toBe(wireError("thread.notFound").code);
  expect(tasks.data.details).toEqual({ threadId: "not-a-thread" });
  expect(asked).toEqual([]);
  await connection.close();
});

test("an unknown schedule is invalid params on scheduleId, for schedule.update and schedule.runs", async () => {
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        scheduleUpdate: () =>
          Promise.resolve(err({ kind: "unknown", path: "scheduleId", id: "sch_9" })),
        scheduleRuns: () =>
          Promise.resolve(err({ kind: "unknown", path: "scheduleId", id: "sch_9" })),
      },
    },
  });
  const connection = await open(host);
  const updated = await wireErrorOf(
    connection.request("schedule.update", { scheduleId: "sch_9", enabled: false }),
  );
  const listed = await wireErrorOf(connection.request("schedule.runs", { scheduleId: "sch_9" }));
  expect(updated.code).toBe(-32602);
  expect(updated.data.details).toEqual({
    issues: [{ path: "scheduleId", message: "unknown schedule" }],
  });
  expect(listed.code).toBe(-32602);
  expect(listed.data.details).toEqual({
    issues: [{ path: "scheduleId", message: "unknown schedule" }],
  });
  await connection.close();
});

test("a full set of active schedules is invalid params on enabled, naming the maximum", async () => {
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        scheduleUpdate: () => Promise.resolve(err({ kind: "limit_reached", max: 100 })),
      },
    },
  });
  const connection = await open(host);
  const error = await wireErrorOf(
    connection.request("schedule.update", { scheduleId: "sch_1", enabled: true }),
  );
  expect(error.code).toBe(-32602);
  expect(error.data.details).toEqual({
    issues: [{ path: "enabled", message: "active schedule limit reached (max 100)" }],
  });
  await connection.close();
});

// 예약 저장소의 실패를 `schedule_store_failed` 표지의 store.io로 옮긴다
test("a schedule store failure is store.io, naming the method and carrying the schedule store code", async () => {
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        scheduleUpdate: () =>
          Promise.resolve(err({ kind: "store_failed", message: "state file is locked" })),
        scheduleRuns: () =>
          Promise.resolve(err({ kind: "store_failed", message: "state file is corrupt" })),
      },
    },
  });
  const connection = await open(host);
  const updated = await wireErrorOf(
    connection.request("schedule.update", { scheduleId: "sch_1", enabled: false }),
  );
  const listed = await wireErrorOf(connection.request("schedule.runs", { scheduleId: "sch_1" }));
  expect(updated.code).toBe(wireError("store.io").code);
  expect(updated.message).toBe("schedule.update: state file is locked");
  expect(updated.data.details).toEqual({ code: "schedule_store_failed" });
  expect(listed.code).toBe(wireError("store.io").code);
  expect(listed.message).toBe("schedule.runs: state file is corrupt");
  await connection.close();
});

// 세션 저장소 읽기 실패는 `store.*` 오류로, 기능의 거절은 internal로 옮긴다(예약 저장소 표지는 붙지 않는다)
test("a thread store read failure keeps its store.* kind and a capability rejection is internal", async () => {
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        goalStatus: () => Promise.resolve(err({ kind: "read_failed", error: { kind: "busy" } })),
        tasksList: () =>
          Promise.resolve(
            err({ kind: "rejected", code: "unavailable", message: "The session store is busy." }),
          ),
      },
    },
  });
  const connection = await open(host);
  const threadId = host.fake.ids.next("thr");
  const goal = await wireErrorOf(connection.request("goal.status", { threadId }));
  const tasks = await wireErrorOf(connection.request("work.tasks.list", { threadId }));
  expect(goal.code).toBe(wireError("store.busy").code);
  expect(tasks.code).toBe(wireError("internal").code);
  expect(tasks.message).toBe("work.tasks.list: unavailable: The session store is busy.");
  await connection.close();
});

test("a port that reports its method unavailable answers method not found, naming that method", async () => {
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        goalStatus: () => Promise.resolve(err({ kind: "unavailable" })),
        tasksList: () => Promise.resolve(err({ kind: "unavailable" })),
      },
    },
  });
  const connection = await open(host);
  const goal = await wireErrorOf(
    connection.request("goal.status", { threadId: host.fake.ids.next("thr") }),
  );
  const tasks = await wireErrorOf(
    connection.request("work.tasks.list", { threadId: host.fake.ids.next("thr") }),
  );
  expect(goal.code).toBe(wireError("jsonrpc.methodNotFound").code);
  expect(goal.data.details).toEqual({ method: "goal.status" });
  expect(tasks.code).toBe(wireError("jsonrpc.methodNotFound").code);
  expect(tasks.data.details).toEqual({ method: "work.tasks.list" });
  await connection.close();
});

test("host.hello lists the four dialog-area methods the host now implements", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const names = hello.features.map((feature) => feature.name);
  expect(names).toContain("goal.status");
  expect(names).toContain("work.tasks.list");
  expect(names).toContain("schedule.update");
  expect(names).toContain("schedule.runs");
  await connection.close();
});
