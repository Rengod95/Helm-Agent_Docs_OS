import { expect, test } from "bun:test";
import { err, ok, parse } from "@fresnel/contracts";
import { PlanVersionsOutput, type PlanVersionsOutputValue } from "@fresnel/contracts/capabilities";
import {
  WireError,
  wireError,
  type GoalView,
  type ScheduleRunRecord,
  type SkillViewResult,
  type TaskView,
  type WireParams,
} from "@fresnel/contracts/wire";
import { threadLocked } from "../../src/handlers/owner.ts";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// 대화 영역 처리기(W-05 `goal.status`, W-06 `work.tasks.list`, W-07 `schedule.update`·`schedule.runs`, W-14 `knowledge.skills.view`,
// W-18 `work.plans.versions`)와 `host.clients`(W-12), `turn.withdraw`(W-17)를 가짜 포트 위에서 본다.
// 처리기는 포트가 돌려준 값을 옮기고 실패를 와이어 오류로 바꾼다. 포트 구현은 test/assembly/dialog-area-port.test.ts,
// 실제 엔진 위의 시험은 test/int/dialog-area.int.test.ts다. `review.get`은 다른 트랙이 채우므로 여기서 다루지 않는다.

const SKILL: SkillViewResult = {
  name: "deploy",
  scope: "project",
  description: "Ships the build.",
  body: "# Deploy\n",
  bodyTruncated: false,
  files: ["scripts/run.sh"],
  treeHash: "a".repeat(64),
};

/** 계획 판 목록. 계획 id는 브랜드 값이라 스키마로 만든다(`PlanVersionsOutput`이 받는 모양) */
const VERSIONS: PlanVersionsOutputValue = versionsFixture();

function versionsFixture(): PlanVersionsOutputValue {
  const parsed = parse(PlanVersionsOutput, {
    versions: [
      {
        planId: "p1",
        version: 1,
        title: "Migrate the store",
        body: "1. Back up",
        status: "approved",
        artifact: null,
        approvalId: null,
        feedback: null,
      },
    ],
  });
  if (!parsed.ok) throw new Error("the plan version fixture does not match its schema");
  return parsed.value;
}

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

test("host.hello lists the dialog-area methods the host now implements", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const names = hello.features.map((feature) => feature.name);
  expect(names).toContain("goal.status");
  expect(names).toContain("work.tasks.list");
  expect(names).toContain("schedule.update");
  expect(names).toContain("schedule.runs");
  expect(names).toContain("host.clients");
  expect(names).toContain("turn.withdraw");
  expect(names).toContain("knowledge.skills.view");
  expect(names).toContain("work.plans.versions");
  await connection.close();
});

test("knowledge.skills.view hands the name, the thread and the request's signal to the port and returns the skill it reports", async () => {
  const asked: { name: string; threadId: string | undefined; signal: AbortSignal }[] = [];
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        skillView: (name, threadId, signal) => {
          asked.push({ name, threadId, signal });
          return Promise.resolve(ok(SKILL));
        },
      },
    },
  });
  const threadId = host.fake.ids.next("thr");
  const connection = await open(host);
  expect(await connection.request("knowledge.skills.view", { name: "deploy", threadId })).toEqual(
    SKILL,
  );
  expect(asked.map((call) => ({ name: call.name, threadId: call.threadId }))).toEqual([
    { name: "deploy", threadId },
  ]);
  expect(asked[0]?.signal).toBeInstanceOf(AbortSignal);
  await connection.close();
});

test("knowledge.skills.view without a thread asks the port with no thread", async () => {
  const asked: (string | undefined)[] = [];
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        skillView: (_name, threadId) => {
          asked.push(threadId);
          return Promise.resolve(ok(SKILL));
        },
      },
    },
  });
  const connection = await open(host);
  expect(await connection.request("knowledge.skills.view", { name: "deploy" })).toEqual(SKILL);
  expect(asked).toEqual([undefined]);
  await connection.close();
});

test("knowledge.skills.view answers an unknown skill with invalid params on name", async () => {
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        skillView: () => Promise.resolve(err({ kind: "unknown", path: "name", id: "missing" })),
      },
    },
  });
  const connection = await open(host);
  const error = await wireErrorOf(connection.request("knowledge.skills.view", { name: "missing" }));
  expect(error.code).toBe(-32602);
  expect(error.data.details).toEqual({ issues: [{ path: "name", message: "unknown skill" }] });
  await connection.close();
});

test("knowledge.skills.view answers method not found when the knowledge capability is absent", async () => {
  const host = createFakeHost({
    overrides: {
      dialogArea: { skillView: () => Promise.resolve(err({ kind: "unavailable" })) },
    },
  });
  const connection = await open(host);
  const error = await wireErrorOf(connection.request("knowledge.skills.view", { name: "deploy" }));
  expect(error.code).toBe(wireError("jsonrpc.methodNotFound").code);
  expect(error.data.details).toEqual({ method: "knowledge.skills.view" });
  await connection.close();
});

test("work.plans.versions hands the thread and the plan to the port and returns the versions it reports", async () => {
  const asked: { threadId: string; planId: string; signal: AbortSignal }[] = [];
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        plansVersions: (threadId, planId, signal) => {
          asked.push({ threadId, planId, signal });
          return Promise.resolve(ok(VERSIONS));
        },
      },
    },
  });
  const threadId = host.fake.ids.next("thr");
  const connection = await open(host);
  expect(await connection.request("work.plans.versions", { threadId, planId: "p1" })).toEqual(
    VERSIONS,
  );
  expect(asked.map((call) => ({ threadId: call.threadId, planId: call.planId }))).toEqual([
    { threadId, planId: "p1" },
  ]);
  expect(asked[0]?.signal).toBeInstanceOf(AbortSignal);
  await connection.close();
});

test("work.plans.versions answers an unknown plan with invalid params on planId, and a missing thread with thread.notFound", async () => {
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        plansVersions: (threadId, planId) =>
          planId === "p9"
            ? Promise.resolve(err({ kind: "unknown", path: "planId", id: planId }))
            : Promise.resolve(err({ kind: "thread_not_found", threadId })),
      },
    },
  });
  const connection = await open(host);
  const threadId = host.fake.ids.next("thr");
  const unknown = await wireErrorOf(
    connection.request("work.plans.versions", { threadId, planId: "p9" }),
  );
  expect(unknown.code).toBe(-32602);
  expect(unknown.data.details).toEqual({ issues: [{ path: "planId", message: "unknown plan" }] });
  const missing = await wireErrorOf(
    connection.request("work.plans.versions", { threadId, planId: "p1" }),
  );
  expect(missing.code).toBe(wireError("thread.notFound").code);
  expect(missing.data.details).toEqual({ threadId });
  await connection.close();
});

test("knowledge.skills.view and work.plans.versions answer a threadId that is not a thread id with thread.notFound, without asking the port", async () => {
  const asked: string[] = [];
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        skillView: () => {
          asked.push("knowledge.skills.view");
          return Promise.resolve(ok(SKILL));
        },
        plansVersions: () => {
          asked.push("work.plans.versions");
          return Promise.resolve(ok(VERSIONS));
        },
      },
    },
  });
  const connection = await open(host);
  const skill = await wireErrorOf(
    connection.request("knowledge.skills.view", { name: "deploy", threadId: "not-a-thread" }),
  );
  const plans = await wireErrorOf(
    connection.request("work.plans.versions", { threadId: "not-a-thread", planId: "p1" }),
  );
  expect(skill.code).toBe(wireError("thread.notFound").code);
  expect(skill.data.details).toEqual({ threadId: "not-a-thread" });
  expect(plans.code).toBe(wireError("thread.notFound").code);
  expect(plans.data.details).toEqual({ threadId: "not-a-thread" });
  expect(asked).toEqual([]);
  await connection.close();
});

/** 이름과 버전을 가진 클라이언트로 hello를 마친다 */
async function openAs(host: FakeHost, name: string, version: string) {
  const { connection, served } = host.connect();
  await connection.request("host.hello", {
    ...HELLO_PARAMS,
    client: { name, version, kind: "desktop" },
  });
  return { connection, served };
}

test("host.clients lists each connection with its client name, version and thread counts, and the caller's own connection first", async () => {
  const host = createFakeHost();
  const writing = host.fake.seedThread();
  const observed = host.fake.seedThread();
  const alpha = await openAs(host, "alpha", "1.0.0");
  const beta = await openAs(host, "beta", "2.0.0");
  // alpha는 turn.start로 쓰기를 얻고, beta는 관찰로 연다
  await alpha.connection.request("turn.start", { threadId: writing, input: "hi" });
  await beta.connection.request("thread.open", { threadId: observed, mode: "observe" });
  expect(await alpha.connection.request("host.clients", {})).toStrictEqual({
    clients: [
      {
        connectionId: alpha.served.id,
        transport: "in-process",
        name: "alpha",
        version: "1.0.0",
        writeThreads: 1,
        observedThreads: 0,
        self: true,
      },
      {
        connectionId: beta.served.id,
        transport: "in-process",
        name: "beta",
        version: "2.0.0",
        writeThreads: 0,
        observedThreads: 1,
        self: false,
      },
    ],
  });
  await alpha.connection.close();
  await beta.connection.close();
});

test("host.clients lists a connection that has not said hello without a name or version", async () => {
  const host = createFakeHost();
  const alpha = await openAs(host, "alpha", "1.0.0");
  const silent = host.connect();
  expect(await alpha.connection.request("host.clients", {})).toStrictEqual({
    clients: [
      {
        connectionId: alpha.served.id,
        transport: "in-process",
        name: "alpha",
        version: "1.0.0",
        writeThreads: 0,
        observedThreads: 0,
        self: true,
      },
      {
        connectionId: silent.served.id,
        transport: "in-process",
        writeThreads: 0,
        observedThreads: 0,
        self: false,
      },
    ],
  });
  await alpha.connection.close();
  await silent.connection.close();
});

test("turn.withdraw hands the thread and the request key to the port and answers what the port withdrew", async () => {
  const asked: { threadId: string; requestId: string }[] = [];
  const answers = [ok(true), ok(false)];
  const host = createFakeHost({
    overrides: {
      turns: {
        withdraw: (threadId, requestId) => {
          asked.push({ threadId, requestId });
          return Promise.resolve(answers.shift() ?? ok(false));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  // 쓰기 소유는 turn.start로 얻는다(turn.interrupt와 같은 규칙)
  await connection.request("turn.start", { threadId, input: "hi" });
  expect(await connection.request("turn.withdraw", { threadId, requestId: "req-1" })).toEqual({
    withdrawn: true,
  });
  expect(await connection.request("turn.withdraw", { threadId, requestId: "req-1" })).toEqual({
    withdrawn: false,
  });
  expect(asked).toEqual([
    { threadId, requestId: "req-1" },
    { threadId, requestId: "req-1" },
  ]);
  await connection.close();
});

test("turn.withdraw needs the thread's write ownership, as turn.interrupt does", async () => {
  const host = createFakeHost({
    overrides: { turns: { withdraw: () => Promise.resolve(ok(true)) } },
  });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  const error = await wireErrorOf(
    connection.request("turn.withdraw", { threadId, requestId: "r" }),
  );
  expect(error.code).toBe(threadLocked(null).code);
  await connection.close();
});

test("turn.withdraw answers an unknown thread with thread.notFound, and a non-thread id without asking the port", async () => {
  const asked: string[] = [];
  const host = createFakeHost({
    overrides: {
      turns: {
        withdraw: () => {
          asked.push("withdraw");
          return Promise.resolve(ok(true));
        },
      },
    },
  });
  const connection = await open(host);
  const unknown = host.fake.ids.next("thr");
  const missing = await wireErrorOf(
    connection.request("turn.withdraw", { threadId: unknown, requestId: "r" }),
  );
  const malformed = await wireErrorOf(
    connection.request("turn.withdraw", { threadId: "not-a-thread", requestId: "r" }),
  );
  expect(missing.code).toBe(wireError("thread.notFound").code);
  expect(missing.data.details).toEqual({ threadId: unknown });
  expect(malformed.code).toBe(wireError("thread.notFound").code);
  expect(malformed.data.details).toEqual({ threadId: "not-a-thread" });
  expect(asked).toEqual([]);
  await connection.close();
});

test("turn.withdraw keeps the store kind of a queue failure", async () => {
  const host = createFakeHost({
    overrides: { turns: { withdraw: () => Promise.resolve(err({ kind: "busy" })) } },
  });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  await connection.request("turn.start", { threadId, input: "hi" });
  const error = await wireErrorOf(
    connection.request("turn.withdraw", { threadId, requestId: "r" }),
  );
  expect(error.code).toBe(wireError("store.busy").code);
  await connection.close();
});

test("knowledge.memory.replace hands the entry, the text and the base hash to the port, and a stale base becomes invalidParams on baseHash", async () => {
  const asked: { store: string; entryId: string; text: string; baseHash: string }[] = [];
  const host = createFakeHost({
    overrides: {
      dialogArea: {
        memoryReplace: (params) => {
          asked.push({
            store: params.store,
            entryId: params.entryId,
            text: params.text,
            baseHash: params.baseHash,
          });
          return Promise.resolve(err({ kind: "unknown", path: "baseHash", id: "" }));
        },
      },
    },
  });
  const connection = await open(host);
  const params = {
    store: "user",
    entryId: "0123456789ab",
    text: "답은 짧게",
    baseHash: "b".repeat(64),
  } as const;
  const failed = await wireErrorOf(connection.request("knowledge.memory.replace", params));
  expect(failed.code).toBe(wireError("jsonrpc.invalidParams").code);
  expect(asked).toEqual([params]);
  await connection.close();
});

test("knowledge.memory.read without the memory feature answers methodNotFound", async () => {
  const host = createFakeHost({
    overrides: {
      dialogArea: { memoryRead: () => Promise.resolve(err({ kind: "unavailable" })) },
    },
  });
  const connection = await open(host);
  const failed = await wireErrorOf(connection.request("knowledge.memory.read", {}));
  expect(failed.code).toBe(wireError("jsonrpc.methodNotFound").code);
  await connection.close();
});
