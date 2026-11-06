import { describe, expect, test } from "bun:test";
import { Bug, err, ok, parse } from "@fresnel/contracts";
import {
  CapabilityError,
  GoalIdSchema,
  PlanIdSchema,
  WorkTaskIdSchema,
  type CallOptions,
  type Goal,
  type GoalId,
  type PlanId,
  type PlanVersion,
  type SkillViewOutput,
  type WorkTaskId,
  type WorkTaskView,
} from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ReadFailure } from "@fresnel/contracts/records";
import type {
  RunRecord,
  ScheduleEntry,
  ScheduleService,
  StoreFailure,
  UpdateError,
  UpdateInput,
} from "@fresnel/cap-schedule";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import type { M4PortDeps } from "../../src/assembly/m4/deps.ts";
import {
  createDialogAreaHolder,
  type GoalsApi,
  type PlansApi,
  type SkillsApi,
  type TasksApi,
} from "../../src/assembly/m4/dialog-area-bridge.ts";
import {
  createDialogAreaPort,
  goalViewOf,
  runRecordOf,
  skillViewResultOf,
  taskViewsOf,
} from "../../src/assembly/m4/dialog-area-port.ts";
import type { DialogAreaPort } from "../../src/handlers/m4/dialog-area.ts";
import type { ThreadPort } from "../../src/types.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { partial } from "../fixtures/unsafe.ts";

// 대화 영역 포트(`dialog-area-port.ts`)의 순수 매퍼와 포트 자체를 가짜 기능으로 본다. 기능과 예약 서비스는 쓰는 멤버만 채운다(`partial`).
// 실제 기능과 엔진 위의 시험은 test/int/dialog-area.int.test.ts다.

const ids = fixedIdFactory();
const THREAD: ThreadId = ids.next("thr");
const signal = new AbortController().signal;

const CLAIMED_MS = 1_800_000_000_000;
const STARTED_MS = 1_800_000_060_000;
const ENDED_MS = 1_800_000_120_000;
const NEXT_MS = 1_800_000_300_000;
const CLAIMED_ISO = "2027-01-15T08:00:00.000Z";
const STARTED_ISO = "2027-01-15T08:01:00.000Z";
const ENDED_ISO = "2027-01-15T08:02:00.000Z";
const NEXT_ISO = "2027-01-15T08:05:00.000Z";

function taskIdOf(raw: string): WorkTaskId {
  const parsed = parse(WorkTaskIdSchema, raw);
  if (!parsed.ok) throw new Bug(`test input ${raw} is not a task id`);
  return parsed.value;
}

function goalIdOf(raw: string): GoalId {
  const parsed = parse(GoalIdSchema, raw);
  if (!parsed.ok) throw new Bug(`test input ${raw} is not a goal id`);
  return parsed.value;
}

function taskOf(raw: string, fields: Partial<WorkTaskView> = {}): WorkTaskView {
  return {
    id: taskIdOf(raw),
    content: `task ${raw}`,
    activeForm: null,
    status: "pending",
    owner: null,
    blockedBy: [],
    blocked: false,
    blocks: [],
    ...fields,
  };
}

function goalOf(fields: Partial<Goal> = {}): Goal {
  return {
    goalId: goalIdOf("g1"),
    condition: "the report section is written",
    judge: { kind: "model" },
    maxRuns: 3,
    continuation: "self",
    judgments: 0,
    status: "active",
    lastVerdict: null,
    ...fields,
  };
}

function runOf(fields: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run_1",
    scheduleId: "sch_1",
    firedBy: "interval",
    dueAt: CLAIMED_MS,
    claimedAt: CLAIMED_MS,
    missed: false,
    status: "claimed",
    threadId: null,
    startedAt: null,
    endedAt: null,
    outcome: null,
    reason: null,
    skippedCount: 0,
    ...fields,
  };
}

function entryOf(fields: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    id: "sch_1",
    trigger: { kind: "interval", everySeconds: 300 },
    prompt: "summarize the open items",
    workspace: null,
    title: null,
    sessionKind: "cron",
    enabled: true,
    createdAt: CLAIMED_MS,
    nextDueAt: NEXT_MS,
    lastStartedAt: null,
    iterations: 0,
    stoppedReason: null,
    ...fields,
  };
}

const OPEN_OK = () => Promise.resolve(ok(undefined));

interface PortParts {
  readonly exists?: ThreadPort["exists"];
  readonly schedule?: Partial<ScheduleService>;
  readonly goals?: Partial<GoalsApi>;
  readonly tasks?: Partial<TasksApi>;
  readonly skills?: Partial<SkillsApi>;
  readonly plans?: Partial<PlansApi>;
}

/** 포트를 세운다. 기능이 없으면 그 자리는 비어 있다(조립과 같다) */
function portFor(parts: PortParts): DialogAreaPort {
  const holder = createDialogAreaHolder();
  holder.goals = parts.goals === undefined ? undefined : partial<GoalsApi>(parts.goals);
  holder.tasks = parts.tasks === undefined ? undefined : partial<TasksApi>(parts.tasks);
  holder.skills = parts.skills === undefined ? undefined : partial<SkillsApi>(parts.skills);
  holder.plans = parts.plans === undefined ? undefined : partial<PlansApi>(parts.plans);
  return createDialogAreaPort(
    partial<M4PortDeps>({
      schedule: partial<ScheduleService>(parts.schedule ?? {}),
      threads: partial<ThreadPort>({ exists: parts.exists ?? (() => ok(true)) }),
      dialogArea: holder,
    }),
  );
}

describe("goalViewOf", () => {
  test("active, met and cleared stay as they are, and both kinds of exhaustion become exhausted", () => {
    expect(goalViewOf(goalOf({ status: "active" })).status).toBe("active");
    expect(goalViewOf(goalOf({ status: "met" })).status).toBe("met");
    expect(goalViewOf(goalOf({ status: "cleared" })).status).toBe("cleared");
    expect(goalViewOf(goalOf({ status: "limit_reached" })).status).toBe("exhausted");
    expect(goalViewOf(goalOf({ status: "judge_failed" })).status).toBe("exhausted");
  });

  test("judged is the goal's judgment count and maxJudgments is the goal's maximum; the condition is carried over", () => {
    expect(
      goalViewOf(goalOf({ condition: "the report section is written", judgments: 2, maxRuns: 3 })),
    ).toEqual({
      condition: "the report section is written",
      status: "active",
      judged: 2,
      maxJudgments: 3,
      lastVerdict: null,
    });
  });

  test("the last verdict is null before any judgment, and otherwise keeps met and reason without the missing list", () => {
    expect(goalViewOf(goalOf({ lastVerdict: null })).lastVerdict).toBeNull();
    expect(
      goalViewOf(
        goalOf({
          lastVerdict: { met: false, reason: "The section is missing.", missing: ["the section"] },
        }),
      ).lastVerdict,
    ).toEqual({ met: false, reason: "The section is missing." });
  });
});

describe("taskViewsOf", () => {
  test("completed becomes done and failed becomes cancelled, and the other statuses stay as they are", () => {
    const views = taskViewsOf([
      taskOf("t1", { status: "pending" }),
      taskOf("t2", { status: "in_progress" }),
      taskOf("t3", { status: "completed" }),
      taskOf("t4", { status: "failed" }),
      taskOf("t5", { status: "cancelled" }),
    ]);
    expect(views.map((view) => view.status)).toEqual([
      "pending",
      "in_progress",
      "done",
      "cancelled",
      "cancelled",
    ]);
  });

  test("a task that is not blocked has no blockedBy, even when its only blocker is done", () => {
    const views = taskViewsOf([
      taskOf("t1", { status: "completed" }),
      taskOf("t2", { blockedBy: [taskIdOf("t1")], blocked: false }),
    ]);
    expect(views.map((view) => view.blockedBy)).toEqual([null, null]);
  });

  test("a blocked task names its unfinished blockers in order, joined by a comma and a space", () => {
    const views = taskViewsOf([
      taskOf("t1", { status: "pending" }),
      taskOf("t2", { status: "in_progress" }),
      taskOf("t3", { status: "completed" }),
      taskOf("t4", { status: "cancelled" }),
      taskOf("t5", {
        blocked: true,
        blockedBy: [taskIdOf("t1"), taskIdOf("t3"), taskIdOf("t2"), taskIdOf("t4")],
      }),
    ]);
    expect(views.map((view) => view.blockedBy)).toEqual([null, null, null, null, "t1, t2"]);
  });

  test("a failed blocker still blocks, so it is named", () => {
    const views = taskViewsOf([
      taskOf("t1", { status: "failed" }),
      taskOf("t2", { blocked: true, blockedBy: [taskIdOf("t1")] }),
    ]);
    expect(views.map((view) => view.status)).toEqual(["cancelled", "pending"]);
    expect(views.map((view) => view.blockedBy)).toEqual([null, "t1"]);
  });

  test("a blocked flag whose blockers are all done gives null, and a blocker missing from the list does not count", () => {
    const views = taskViewsOf([
      taskOf("t1", { status: "completed" }),
      taskOf("t2", { status: "cancelled" }),
      taskOf("t3", { blocked: true, blockedBy: [taskIdOf("t1"), taskIdOf("t2")] }),
      taskOf("t4", { blocked: true, blockedBy: [taskIdOf("t99")] }),
    ]);
    expect(views.map((view) => view.blockedBy)).toEqual([null, null, null, null]);
  });

  test("the list is capped at 500 tasks and keeps the order it was given", () => {
    const tasks = Array.from({ length: 600 }, (_, index) => taskOf(`t${String(index + 1)}`));
    const views = taskViewsOf(tasks);
    expect(views).toHaveLength(500);
    expect(views.at(0)?.taskId).toBe("t1");
    expect(views.at(-1)?.taskId).toBe("t500");
  });
});

describe("runRecordOf", () => {
  test("a claimed or started run is running and has no end time", () => {
    expect(runRecordOf(runOf({ status: "claimed" }))).toEqual({
      runId: "run_1",
      startedAt: CLAIMED_ISO,
      endedAt: null,
      outcome: "running",
      threadId: null,
      error: null,
    });
    expect(
      runRecordOf(runOf({ status: "started", threadId: "thr_1", startedAt: STARTED_MS })),
    ).toEqual({
      runId: "run_1",
      startedAt: STARTED_ISO,
      endedAt: null,
      outcome: "running",
      threadId: "thr_1",
      error: null,
    });
  });

  test("a finished run that completed is ok, with its end time and no error", () => {
    expect(
      runRecordOf(
        runOf({
          status: "finished",
          outcome: "completed",
          threadId: "thr_1",
          startedAt: STARTED_MS,
          endedAt: ENDED_MS,
        }),
      ),
    ).toEqual({
      runId: "run_1",
      startedAt: STARTED_ISO,
      endedAt: ENDED_ISO,
      outcome: "ok",
      threadId: "thr_1",
      error: null,
    });
  });

  test("a finished run that was aborted is failed with the error aborted", () => {
    expect(
      runRecordOf(
        runOf({
          status: "finished",
          outcome: "aborted",
          threadId: "thr_1",
          startedAt: STARTED_MS,
          endedAt: ENDED_MS,
        }),
      ),
    ).toEqual({
      runId: "run_1",
      startedAt: STARTED_ISO,
      endedAt: ENDED_ISO,
      outcome: "failed",
      threadId: "thr_1",
      error: "aborted",
    });
  });

  test("a failed run is failed with its reason as the error", () => {
    expect(
      runRecordOf(
        runOf({
          status: "failed",
          outcome: "failed",
          reason: "run_failed",
          threadId: "thr_1",
          startedAt: STARTED_MS,
          endedAt: ENDED_MS,
        }),
      ),
    ).toEqual({
      runId: "run_1",
      startedAt: STARTED_ISO,
      endedAt: ENDED_ISO,
      outcome: "failed",
      threadId: "thr_1",
      error: "run_failed",
    });
  });

  test("a run that never started takes its start time from the claim", () => {
    expect(
      runRecordOf(runOf({ status: "failed", reason: "start_failed", endedAt: ENDED_MS })),
    ).toEqual({
      runId: "run_1",
      startedAt: CLAIMED_ISO,
      endedAt: ENDED_ISO,
      outcome: "failed",
      threadId: null,
      error: "start_failed",
    });
  });

  test("a skipped run is skipped with its reason as the error and has no end time", () => {
    expect(runRecordOf(runOf({ status: "skipped", reason: "overlap", skippedCount: 1 }))).toEqual({
      runId: "run_1",
      startedAt: CLAIMED_ISO,
      endedAt: null,
      outcome: "skipped",
      threadId: null,
      error: "overlap",
    });
  });

  test("a finished run that waits for approval is still running, and its end time stays hidden", () => {
    expect(
      runRecordOf(
        runOf({
          status: "finished",
          outcome: "awaiting_approval",
          threadId: "thr_1",
          startedAt: STARTED_MS,
          endedAt: ENDED_MS,
        }),
      ),
    ).toEqual({
      runId: "run_1",
      startedAt: STARTED_ISO,
      endedAt: null,
      outcome: "running",
      threadId: "thr_1",
      error: null,
    });
  });
});

describe("scheduleUpdate", () => {
  test("an id the service does not hold is unknown on scheduleId, and nothing is changed", async () => {
    const updated: string[] = [];
    const port = portFor({
      schedule: {
        open: OPEN_OK,
        list: () => [entryOf({ id: "sch_1" })],
        update: (scheduleId) => {
          updated.push(scheduleId);
          return Promise.resolve(err<UpdateError>({ kind: "not_found" }));
        },
      },
    });
    expect(await port.scheduleUpdate({ scheduleId: "sch_9" })).toEqual({
      ok: false,
      error: { kind: "unknown", path: "scheduleId", id: "sch_9" },
    });
    expect(updated).toEqual([]);
  });

  test("an id the service stops knowing during the update is unknown on scheduleId too", async () => {
    const port = portFor({
      schedule: {
        open: OPEN_OK,
        list: () => [entryOf({ id: "sch_1" })],
        update: () => Promise.resolve(err<UpdateError>({ kind: "not_found" })),
      },
    });
    expect(await port.scheduleUpdate({ scheduleId: "sch_1", enabled: false })).toEqual({
      ok: false,
      error: { kind: "unknown", path: "scheduleId", id: "sch_1" },
    });
  });

  test("limit_reached carries the service's maximum", async () => {
    const port = portFor({
      schedule: {
        open: OPEN_OK,
        list: () => [entryOf()],
        update: () => Promise.resolve(err<UpdateError>({ kind: "limit_reached", max: 100 })),
      },
    });
    expect(await port.scheduleUpdate({ scheduleId: "sch_1", enabled: true })).toEqual({
      ok: false,
      error: { kind: "limit_reached", max: 100 },
    });
  });

  test("a store failure while updating is store_failed with the service's message", async () => {
    const port = portFor({
      schedule: {
        open: OPEN_OK,
        list: () => [entryOf()],
        update: () =>
          Promise.resolve(
            err<UpdateError>({ kind: "store_failed", message: "state file is locked" }),
          ),
      },
    });
    expect(await port.scheduleUpdate({ scheduleId: "sch_1", enabled: false })).toEqual({
      ok: false,
      error: { kind: "store_failed", message: "state file is locked" },
    });
  });

  test("a store failure while opening stops the call before the entry is looked at or changed", async () => {
    const calls: string[] = [];
    const port = portFor({
      schedule: {
        open: () => {
          calls.push("open");
          return Promise.resolve(
            err<StoreFailure>({ kind: "store_failed", message: "state file is corrupt" }),
          );
        },
        list: () => {
          calls.push("list");
          return [];
        },
        update: () => {
          calls.push("update");
          return Promise.resolve(ok(entryOf()));
        },
      },
    });
    expect(await port.scheduleUpdate({ scheduleId: "sch_1", enabled: false })).toEqual({
      ok: false,
      error: { kind: "store_failed", message: "state file is corrupt" },
    });
    expect(calls).toEqual(["open"]);
  });

  test("a changed entry is reported as its id, its enabled flag and its next due time as an ISO string, or null without one", async () => {
    const on = portFor({
      schedule: {
        open: OPEN_OK,
        list: () => [entryOf()],
        update: () => Promise.resolve(ok(entryOf({ enabled: true, nextDueAt: NEXT_MS }))),
      },
    });
    expect(await on.scheduleUpdate({ scheduleId: "sch_1", enabled: true })).toEqual({
      ok: true,
      value: { scheduleId: "sch_1", enabled: true, nextRunAt: NEXT_ISO },
    });
    const off = portFor({
      schedule: {
        open: OPEN_OK,
        list: () => [entryOf()],
        update: () => Promise.resolve(ok(entryOf({ enabled: false, nextDueAt: null }))),
      },
    });
    expect(await off.scheduleUpdate({ scheduleId: "sch_1", enabled: false })).toEqual({
      ok: true,
      value: { scheduleId: "sch_1", enabled: false, nextRunAt: null },
    });
  });

  test("only the fields the caller gave reach the service's update, and nothing else", async () => {
    const patches: UpdateInput[] = [];
    const port = portFor({
      schedule: {
        open: OPEN_OK,
        list: () => [entryOf()],
        update: (_scheduleId, patch) => {
          patches.push(patch);
          return Promise.resolve(ok(entryOf()));
        },
      },
    });
    await port.scheduleUpdate({ scheduleId: "sch_1", enabled: false });
    await port.scheduleUpdate({
      scheduleId: "sch_1",
      title: "weekly",
      prompt: "summarize the week",
    });
    await port.scheduleUpdate({ scheduleId: "sch_1" });
    expect(patches).toStrictEqual([
      { enabled: false },
      { title: "weekly", prompt: "summarize the week" },
      {},
    ]);
  });
});

describe("scheduleRuns", () => {
  test("the limit is passed on, and each run is mapped in the order the service gives them", async () => {
    const asked: { scheduleId: string; limit: number | undefined }[] = [];
    const port = portFor({
      schedule: {
        open: OPEN_OK,
        list: () => [entryOf()],
        runs: (scheduleId, limit) => {
          asked.push({ scheduleId, limit });
          return [
            runOf({ runId: "run_2", status: "claimed", claimedAt: CLAIMED_MS }),
            runOf({
              runId: "run_1",
              status: "finished",
              outcome: "completed",
              threadId: "thr_1",
              startedAt: STARTED_MS,
              endedAt: ENDED_MS,
            }),
          ];
        },
      },
    });
    expect(await port.scheduleRuns({ scheduleId: "sch_1", limit: 2 })).toEqual({
      ok: true,
      value: {
        runs: [
          {
            runId: "run_2",
            startedAt: CLAIMED_ISO,
            endedAt: null,
            outcome: "running",
            threadId: null,
            error: null,
          },
          {
            runId: "run_1",
            startedAt: STARTED_ISO,
            endedAt: ENDED_ISO,
            outcome: "ok",
            threadId: "thr_1",
            error: null,
          },
        ],
      },
    });
    expect(asked).toStrictEqual([{ scheduleId: "sch_1", limit: 2 }]);
  });

  test("without a limit the service gets no limit, so its own default applies", async () => {
    const asked: { scheduleId: string; limit: number | undefined }[] = [];
    const port = portFor({
      schedule: {
        open: OPEN_OK,
        list: () => [entryOf()],
        runs: (scheduleId, limit) => {
          asked.push({ scheduleId, limit });
          return [];
        },
      },
    });
    expect(await port.scheduleRuns({ scheduleId: "sch_1" })).toEqual({
      ok: true,
      value: { runs: [] },
    });
    expect(asked).toStrictEqual([{ scheduleId: "sch_1", limit: undefined }]);
  });

  test("an unknown schedule is unknown on scheduleId and no runs are read", async () => {
    const asked: string[] = [];
    const port = portFor({
      schedule: {
        open: OPEN_OK,
        list: () => [entryOf({ id: "sch_1" })],
        runs: (scheduleId) => {
          asked.push(scheduleId);
          return [];
        },
      },
    });
    expect(await port.scheduleRuns({ scheduleId: "sch_9" })).toEqual({
      ok: false,
      error: { kind: "unknown", path: "scheduleId", id: "sch_9" },
    });
    expect(asked).toEqual([]);
  });
});

describe("goalStatus", () => {
  test("a thread the store does not know is thread_not_found, and no goal is read", async () => {
    const asked: string[] = [];
    const port = portFor({
      exists: () => ok(false),
      goals: {
        status: () => {
          asked.push("status");
          return Promise.resolve({ goal: null, recent: [] });
        },
      },
    });
    expect(await port.goalStatus(THREAD, signal)).toEqual({
      ok: false,
      error: { kind: "thread_not_found", threadId: THREAD },
    });
    expect(asked).toEqual([]);
  });

  test("a read failure of the thread store is read_failed, not an empty answer", async () => {
    const port = portFor({
      exists: () => err<ReadFailure>({ kind: "busy" }),
      goals: { status: () => Promise.resolve({ goal: null, recent: [] }) },
    });
    expect(await port.goalStatus(THREAD, signal)).toEqual({
      ok: false,
      error: { kind: "read_failed", error: { kind: "busy" } },
    });
  });

  test("without a goals service the answer is no goal", async () => {
    expect(await portFor({}).goalStatus(THREAD, signal)).toEqual({
      ok: true,
      value: { goal: null },
    });
  });

  test("the status call carries the thread's host context and the request's signal, and the goal is mapped", async () => {
    const seen: { options: CallOptions | undefined }[] = [];
    const port = portFor({
      goals: {
        status: (_input, options) => {
          seen.push({ options });
          return Promise.resolve({
            goal: goalOf({
              status: "limit_reached",
              judgments: 3,
              maxRuns: 3,
              lastVerdict: { met: false, reason: "still missing", missing: ["the section"] },
            }),
            recent: [],
          });
        },
      },
    });
    expect(await port.goalStatus(THREAD, signal)).toEqual({
      ok: true,
      value: {
        goal: {
          condition: "the report section is written",
          status: "exhausted",
          judged: 3,
          maxJudgments: 3,
          lastVerdict: { met: false, reason: "still missing" },
        },
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.options?.signal).toBe(signal);
    expect(seen[0]?.options?.context).toEqual({ threadId: THREAD, caller: { kind: "host" } });
  });

  test("a capability rejection is a rejected failure with the capability's code and message", async () => {
    const port = portFor({
      goals: {
        status: () =>
          Promise.reject(
            new CapabilityError({
              capability: "work.goals",
              method: "status",
              code: "unavailable",
              message: "The session store is busy.",
              retryable: true,
            }),
          ),
      },
    });
    expect(await port.goalStatus(THREAD, signal)).toEqual({
      ok: false,
      error: { kind: "rejected", code: "unavailable", message: "The session store is busy." },
    });
  });

  test("a defect in the capability is thrown on, not made into a failure", async () => {
    const defect = new Error("the goal projection is broken");
    const port = portFor({ goals: { status: () => Promise.reject(defect) } });
    expect(await rejectionOf(port.goalStatus(THREAD, signal))).toBe(defect);
  });
});

describe("tasksList", () => {
  test("a thread the store does not know is thread_not_found, and no task list is read", async () => {
    const asked: string[] = [];
    const port = portFor({
      exists: () => ok(false),
      tasks: {
        list: () => {
          asked.push("list");
          return Promise.resolve({ tasks: [] });
        },
      },
    });
    expect(await port.tasksList(THREAD, signal)).toEqual({
      ok: false,
      error: { kind: "thread_not_found", threadId: THREAD },
    });
    expect(asked).toEqual([]);
  });

  test("without a tasks service the answer is an empty list", async () => {
    expect(await portFor({}).tasksList(THREAD, signal)).toEqual({
      ok: true,
      value: { tasks: [] },
    });
  });

  test("the tasks are mapped with taskViewsOf, and the call carries the thread's host context", async () => {
    const seen: { options: CallOptions | undefined }[] = [];
    const port = portFor({
      tasks: {
        list: (_input, options) => {
          seen.push({ options });
          return Promise.resolve({
            tasks: [
              taskOf("t1", { status: "completed" }),
              taskOf("t2", {
                status: "in_progress",
                blocked: true,
                blockedBy: [taskIdOf("t1"), taskIdOf("t3")],
              }),
              taskOf("t3", { status: "pending" }),
            ],
          });
        },
      },
    });
    expect(await port.tasksList(THREAD, signal)).toEqual({
      ok: true,
      value: {
        tasks: [
          { taskId: "t1", content: "task t1", status: "done", blockedBy: null },
          { taskId: "t2", content: "task t2", status: "in_progress", blockedBy: "t3" },
          { taskId: "t3", content: "task t3", status: "pending", blockedBy: null },
        ],
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.options?.signal).toBe(signal);
    expect(seen[0]?.options?.context).toEqual({ threadId: THREAD, caller: { kind: "host" } });
  });

  test("a capability rejection is a rejected failure with the capability's code and message", async () => {
    const port = portFor({
      tasks: {
        list: () =>
          Promise.reject(
            new CapabilityError({
              capability: "work.tasks",
              method: "list",
              code: "unavailable",
              message: "The session store is busy.",
              retryable: true,
            }),
          ),
      },
    });
    expect(await port.tasksList(THREAD, signal)).toEqual({
      ok: false,
      error: { kind: "rejected", code: "unavailable", message: "The session store is busy." },
    });
  });
});

const SKILL_VIEW: SkillViewOutput = {
  name: "deploy",
  scope: "project",
  description: "Ships the build.",
  content: "# Deploy\n",
  files: ["scripts/run.sh"],
  treeHash: "a".repeat(64),
  createdBy: "user",
};

describe("skillViewResultOf", () => {
  test("a body within the limit is kept whole, and the flag stays false", () => {
    expect(skillViewResultOf(SKILL_VIEW)).toEqual({
      name: "deploy",
      scope: "project",
      description: "Ships the build.",
      body: "# Deploy\n",
      bodyTruncated: false,
      files: ["scripts/run.sh"],
      treeHash: "a".repeat(64),
    });
  });

  test("a body over 20000 characters is cut there and the flag says so", () => {
    const view = skillViewResultOf({ ...SKILL_VIEW, content: "x".repeat(20_001) });
    expect(view.body).toHaveLength(20_000);
    expect(view.bodyTruncated).toBe(true);
  });

  test("a cut never leaves half a surrogate pair at the end of the body", () => {
    const view = skillViewResultOf({ ...SKILL_VIEW, content: `${"a".repeat(19_999)}😀` });
    expect(view.body).toHaveLength(19_999);
    expect(view.bodyTruncated).toBe(true);
  });

  test("the file list is capped at 500 entries and keeps its order", () => {
    const files = Array.from({ length: 600 }, (_, index) => `scripts/f${String(index)}.sh`);
    const view = skillViewResultOf({ ...SKILL_VIEW, files });
    expect(view.files).toHaveLength(500);
    expect(view.files.at(0)).toBe("scripts/f0.sh");
  });
});

describe("skillList", () => {
  test("the index and its diagnostics are mapped, hidden skills included, with the thread's host context", async () => {
    const seen: { input: unknown; options: CallOptions | undefined }[] = [];
    const port = portFor({
      skills: {
        list: (input, options) => {
          seen.push({ input, options });
          return Promise.resolve({
            skills: [
              {
                name: "scigreet-hello",
                description: "Greets.",
                scope: "project",
                createdBy: "unknown",
                treeHash: "b".repeat(64),
                modelInvocable: true,
              },
            ],
            budget: { limitChars: 8000, usedChars: 10, omitted: 0 },
            indexVersion: 3,
            diagnostics: [
              {
                severity: "warning",
                message: "project skills are not loaded",
                path: "/w/.fresnel/skills",
              },
            ],
          });
        },
      },
    });
    expect(await port.skillList(THREAD, signal)).toEqual({
      ok: true,
      value: {
        skills: [
          {
            name: "scigreet-hello",
            description: "Greets.",
            scope: "project",
            modelInvocable: true,
          },
        ],
        diagnostics: [
          {
            severity: "warning",
            message: "project skills are not loaded",
            path: "/w/.fresnel/skills",
          },
        ],
      },
    });
    expect(seen[0]?.input).toEqual({ includeHidden: true });
    expect(seen[0]?.options?.context).toEqual({ threadId: THREAD, caller: { kind: "host" } });
  });

  test("a missing skills service and an unknown thread are reported as failures without a read", async () => {
    expect(await portFor({}).skillList(THREAD, signal)).toEqual({
      ok: false,
      error: { kind: "unavailable" },
    });
    expect(
      await portFor({ exists: () => ok(false), skills: {} }).skillList(THREAD, signal),
    ).toEqual({
      ok: false,
      error: { kind: "thread_not_found", threadId: THREAD },
    });
  });
});

describe("skillView", () => {
  test("a thread the store does not know is thread_not_found, and no skill is read", async () => {
    const asked: string[] = [];
    const port = portFor({
      exists: () => ok(false),
      skills: {
        view: () => {
          asked.push("view");
          return Promise.resolve(SKILL_VIEW);
        },
      },
    });
    expect(await port.skillView("deploy", THREAD, signal)).toEqual({
      ok: false,
      error: { kind: "thread_not_found", threadId: THREAD },
    });
    expect(asked).toEqual([]);
  });

  test("without a skills service the answer is unavailable, which the handler reports as method not found", async () => {
    expect(await portFor({}).skillView("deploy", THREAD, signal)).toEqual({
      ok: false,
      error: { kind: "unavailable" },
    });
  });

  test("the skill is mapped with the thread's host context and the request's signal", async () => {
    const seen: { input: unknown; options: CallOptions | undefined }[] = [];
    const port = portFor({
      skills: {
        view: (input, options) => {
          seen.push({ input, options });
          return Promise.resolve(SKILL_VIEW);
        },
      },
    });
    expect(await port.skillView("deploy", THREAD, signal)).toEqual({
      ok: true,
      value: skillViewResultOf(SKILL_VIEW),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.input).toEqual({ name: "deploy" });
    expect(seen[0]?.options?.signal).toBe(signal);
    expect(seen[0]?.options?.context).toEqual({ threadId: THREAD, caller: { kind: "host" } });
  });

  test("without a thread the call carries only the host caller, so no project skill is looked for", async () => {
    const seen: (CallOptions | undefined)[] = [];
    const port = portFor({
      skills: {
        view: (_input, options) => {
          seen.push(options);
          return Promise.resolve(SKILL_VIEW);
        },
      },
    });
    await port.skillView("deploy", undefined, signal);
    expect(seen[0]?.context).toEqual({ caller: { kind: "host" } });
  });

  test("a skill the capability does not have is unknown on name", async () => {
    const port = portFor({
      skills: {
        view: () =>
          Promise.reject(
            new CapabilityError({
              capability: "knowledge.skills",
              method: "view",
              code: "not_found",
              message: "missing is not in the index",
              retryable: false,
            }),
          ),
      },
    });
    expect(await port.skillView("missing", THREAD, signal)).toEqual({
      ok: false,
      error: { kind: "unknown", path: "name", id: "missing" },
    });
  });

  test("a skills setting that is turned off answers unavailable, the same as a missing capability", async () => {
    const port = portFor({
      skills: {
        view: () =>
          Promise.reject(
            new CapabilityError({
              capability: "knowledge.skills",
              method: "view",
              code: "unavailable",
              message: "skills are turned off",
              retryable: false,
            }),
          ),
      },
    });
    expect(await port.skillView("deploy", THREAD, signal)).toEqual({
      ok: false,
      error: { kind: "unavailable" },
    });
  });

  test("any other capability rejection is a rejected failure with the capability's code and message", async () => {
    const port = portFor({
      skills: {
        view: () =>
          Promise.reject(
            new CapabilityError({
              capability: "knowledge.skills",
              method: "view",
              code: "timeout",
              message: "view timed out",
              retryable: true,
            }),
          ),
      },
    });
    expect(await port.skillView("deploy", THREAD, signal)).toEqual({
      ok: false,
      error: { kind: "rejected", code: "timeout", message: "view timed out" },
    });
  });
});

const PLAN_VERSION: PlanVersion = {
  planId: plan("p1"),
  version: 1,
  title: "Migrate the store",
  body: "1. Back up",
  status: "approved",
  artifact: null,
  approvalId: null,
  feedback: null,
};

describe("plansVersions", () => {
  test("a thread the store does not know is thread_not_found, and no version list is read", async () => {
    const asked: string[] = [];
    const port = portFor({
      exists: () => ok(false),
      plans: {
        versions: () => {
          asked.push("versions");
          return Promise.resolve({ versions: [PLAN_VERSION] });
        },
      },
    });
    expect(await port.plansVersions(THREAD, "p1", signal)).toEqual({
      ok: false,
      error: { kind: "thread_not_found", threadId: THREAD },
    });
    expect(asked).toEqual([]);
  });

  test("without a plans service the answer is an empty version list", async () => {
    expect(await portFor({}).plansVersions(THREAD, "p1", signal)).toEqual({
      ok: true,
      value: { versions: [] },
    });
  });

  test("a plan id of the wrong shape is unknown on planId, and the service is not asked", async () => {
    const asked: string[] = [];
    const port = portFor({
      plans: {
        versions: () => {
          asked.push("versions");
          return Promise.resolve({ versions: [PLAN_VERSION] });
        },
      },
    });
    expect(await port.plansVersions(THREAD, "plan-one", signal)).toEqual({
      ok: false,
      error: { kind: "unknown", path: "planId", id: "plan-one" },
    });
    expect(asked).toEqual([]);
  });

  test("the versions are returned as the service gives them, with the thread's host context and the signal", async () => {
    const seen: { input: unknown; options: CallOptions | undefined }[] = [];
    const port = portFor({
      plans: {
        versions: (input, options) => {
          seen.push({ input, options });
          return Promise.resolve({ versions: [PLAN_VERSION] });
        },
      },
    });
    expect(await port.plansVersions(THREAD, "p1", signal)).toEqual({
      ok: true,
      value: { versions: [PLAN_VERSION] },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.input).toEqual({ planId: "p1" });
    expect(seen[0]?.options?.signal).toBe(signal);
    expect(seen[0]?.options?.context).toEqual({ threadId: THREAD, caller: { kind: "host" } });
  });

  test("a plan the service does not have is unknown on planId", async () => {
    const port = portFor({
      plans: {
        versions: () =>
          Promise.reject(
            new CapabilityError({
              capability: "work.plans",
              method: "versions",
              code: "not_found",
              message: "p9 does not exist.",
              retryable: false,
            }),
          ),
      },
    });
    expect(await port.plansVersions(THREAD, "p9", signal)).toEqual({
      ok: false,
      error: { kind: "unknown", path: "planId", id: "p9" },
    });
  });

  test("a capability rejection is a rejected failure with the capability's code and message", async () => {
    const port = portFor({
      plans: {
        versions: () =>
          Promise.reject(
            new CapabilityError({
              capability: "work.plans",
              method: "versions",
              code: "unavailable",
              message: "The session store is busy.",
              retryable: true,
            }),
          ),
      },
    });
    expect(await port.plansVersions(THREAD, "p1", signal)).toEqual({
      ok: false,
      error: { kind: "rejected", code: "unavailable", message: "The session store is busy." },
    });
  });
});

function plan(raw: string): PlanId {
  const parsed = parse(PlanIdSchema, raw);
  if (!parsed.ok) throw new Bug(`test input ${raw} is not a plan id`);
  return parsed.value;
}
