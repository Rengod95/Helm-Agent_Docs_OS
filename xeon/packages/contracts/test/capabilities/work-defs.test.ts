import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import {
  GOAL_ID_PATTERN,
  GoalJudgeSpecSchema,
  GoalSchema,
  GoalSetInput,
  MAX_WORK_TASKS,
  OWNER_PATTERN,
  PLAN_ID_PATTERN,
  PlanApprovalAnswerSchema,
  PlanApprovalSubjectSchema,
  PlanIdSchema,
  PlanSubmitInput,
  PlanSubmitOutput,
  PlanVersionSchema,
  REPORT_ID_PATTERN,
  TaskOpSchema,
  TaskWriteInput,
  WORK_CAPABILITIES,
  WORK_TASK_ID_PATTERN,
  WorkGoals,
  WorkGoalsKey,
  WorkPlans,
  WorkPlansKey,
  WorkReportSchema,
  WorkReports,
  WorkReportsKey,
  WorkServiceName,
  WorkTaskIdSchema,
  WorkTasks,
  WorkTasksKey,
  orderTools,
  renderPlanSubmit,
  renderTaskList,
  validateCapability,
  validateCapabilitySet,
  type AnyCapabilityDef,
  type PlanSubmitResult,
  type TaskWriteOutputValue,
  type ToolContent,
  type WorkTaskView,
} from "../../src/capabilities/index.ts";
import { ApprovalIdSchema } from "../../src/conversation/index.ts";
import { must, rawId } from "../helpers/ids.ts";

const DEFS: readonly AnyCapabilityDef[] = [WorkTasks, WorkPlans, WorkGoals, WorkReports];

function firstText(result: ToolContent): string {
  const first = result.content[0];
  return first !== undefined && first.type === "text" ? first.text : "";
}

function task(
  id: string,
  patch: Partial<Omit<WorkTaskView, "id" | "blockedBy" | "blocks">> & {
    blockedBy?: readonly string[];
    blocks?: readonly string[];
  } = {},
): WorkTaskView {
  return {
    id: must(WorkTaskIdSchema, id),
    content: `content of ${id}`,
    activeForm: null,
    status: "pending",
    owner: null,
    blocked: false,
    ...patch,
    blockedBy: (patch.blockedBy ?? []).map((b) => must(WorkTaskIdSchema, b)),
    blocks: (patch.blocks ?? []).map((b) => must(WorkTaskIdSchema, b)),
  };
}

const APPROVAL_ID = rawId("evt", 7);
const TURN_ID = rawId("trn", 3);

describe("work definitions", () => {
  test("each of the four definitions has no validation issues and the set has no conflicts", () => {
    for (const def of DEFS) expect(validateCapability(def)).toEqual([]);
    expect(validateCapabilitySet(DEFS)).toEqual([]);
    expect(WORK_CAPABILITIES.map((d) => d.id)).toEqual([
      "work.tasks",
      "work.plans",
      "work.goals",
      "work.reports",
    ]);
  });

  test("four model tools; goals and reports have none", () => {
    expect(orderTools(DEFS).map((t) => t.name)).toEqual([
      "enter_plan_mode",
      "exit_plan_mode",
      "submit_plan",
      "task_write",
    ]);
    expect(WorkGoals.tools).toEqual([]);
    expect(WorkReports.tools).toEqual([]);
  });

  test("keys and the bundle name", () => {
    expect(WorkTasksKey.capability).toBe("work.tasks");
    expect(WorkPlansKey.capability).toBe("work.plans");
    expect(WorkGoalsKey.capability).toBe("work.goals");
    expect(WorkReportsKey.capability).toBe("work.reports");
    expect(WorkServiceName).toBe("xeon.work");
    expect(MAX_WORK_TASKS).toBe(500);
  });

  test("the plan mode switches and the plan decisions are replay unsafe (nothing keyed by requestId remembers them)", () => {
    const unsafe: string[] = [];
    for (const def of DEFS) {
      for (const [name, method] of Object.entries(def.service.methods)) {
        if (method.replay !== "safe") unsafe.push(`${def.id}.${name}`);
      }
    }
    expect(unsafe).toEqual([
      "work.plans.enterMode",
      "work.plans.exitMode",
      "work.plans.approve",
      "work.plans.reject",
      "work.plans.revise",
    ]);
  });

  test("submit_plan hides wait from the model and forces it off", () => {
    const tool = WorkPlans.tools[2];
    const params = { title: "Plan", body: "# steps" };
    const input = tool.toInput?.(params);
    expect(input).toEqual({ ...params, wait: false });
    expect(parse(PlanSubmitInput, input).ok).toBe(true);
    expect(tool.outputSchema).toBe(PlanSubmitOutput);
  });

  test("task_write is a single list-operation tool that returns the whole list", () => {
    const tool = WorkTasks.tools[0];
    expect(tool.name).toBe("task_write");
    expect(tool.parameters).toBe(TaskWriteInput);
    expect(tool.executionMode).toBe("sequential");
  });
});

describe("work schemas", () => {
  test("sequence ids follow their patterns", () => {
    const cases: readonly [string, readonly string[], readonly string[]][] = [
      [WORK_TASK_ID_PATTERN, ["t1", "t999999"], ["t0", "t", "t1000000", "p1", "t01"]],
      [PLAN_ID_PATTERN, ["p1", "p12"], ["p0", "t1"]],
      [GOAL_ID_PATTERN, ["g1"], ["g0", "g"]],
      [REPORT_ID_PATTERN, ["r5"], ["r0", "x5"]],
      [OWNER_PATTERN, ["main", "reviewer-1", "grp.helm/queue", "a:b"], ["", "-x", ".x", "a b"]],
    ];
    for (const [pattern, good, bad] of cases) {
      const regex = new RegExp(pattern);
      for (const value of good) expect(regex.test(value)).toBe(true);
      for (const value of bad) expect(regex.test(value)).toBe(false);
    }
  });

  test("task write ops accept refs, links and reject unknown ops", () => {
    const ops = [
      { op: "create", ref: "@a", content: "write tests" },
      { op: "create", content: "ship", blockedBy: ["@a", "t1"] },
      { op: "update", id: "@a", status: "in_progress", activeForm: "writing tests" },
      { op: "link", id: "t2", blockedBy: ["@a"] },
      { op: "unlink", id: "t2", blockedBy: ["t1"] },
    ];
    for (const op of ops) expect(parse(TaskOpSchema, op).ok).toBe(true);
    expect(parse(TaskWriteInput, { ops }).ok).toBe(true);
    expect(parse(TaskOpSchema, { op: "delete", id: "t1" }).ok).toBe(false);
    expect(parse(TaskOpSchema, { op: "create", content: "x", extra: 1 }).ok).toBe(false);
    expect(parse(TaskOpSchema, { op: "link", id: "t1", blockedBy: [] }).ok).toBe(false);
    expect(parse(TaskWriteInput, { ops: [] }).ok).toBe(false);
  });

  test("plan versions carry an approval id of the evt_ kind", () => {
    const version = {
      planId: "p1",
      version: 1,
      title: "Plan",
      body: "body",
      status: "submitted",
      artifact: null,
      approvalId: APPROVAL_ID,
      feedback: null,
    };
    expect(parse(PlanVersionSchema, version).ok).toBe(true);
    expect(parse(PlanVersionSchema, { ...version, approvalId: rawId("trn", 1) }).ok).toBe(false);
    expect(parse(PlanVersionSchema, { ...version, status: "pending" }).ok).toBe(false);
    expect(parse(ApprovalIdSchema, APPROVAL_ID).ok).toBe(true);
  });

  test("approval subject and answer follow the plan approval record", () => {
    const subject = {
      planId: "p1",
      version: 2,
      title: "Plan",
      body: "body",
      artifact: { artifactId: "art_1", kind: "plan", title: null },
    };
    expect(parse(PlanApprovalSubjectSchema, subject).ok).toBe(true);
    expect(parse(PlanApprovalAnswerSchema, { action: "revise", feedback: "split step 2" }).ok).toBe(
      true,
    );
    expect(parse(PlanApprovalAnswerSchema, { action: "revise", feedback: "" }).ok).toBe(false);
    expect(parse(PlanApprovalAnswerSchema, { action: "approve", feedback: "x" }).ok).toBe(false);
  });

  test("submit output is input_required or decided", () => {
    const pending = { status: "input_required", planId: "p1", version: 1, approvalId: APPROVAL_ID };
    expect(parse(PlanSubmitOutput, pending).ok).toBe(true);
    const decided = {
      ...pending,
      status: "decided",
      decision: "revision_requested",
      feedback: "more detail",
    };
    expect(parse(PlanSubmitOutput, decided).ok).toBe(true);
    expect(parse(PlanSubmitOutput, { ...decided, decision: "maybe" }).ok).toBe(false);
    expect(parse(PlanSubmitOutput, { ...pending, feedback: null }).ok).toBe(false);
  });

  test("goal judges are model or delegated", () => {
    expect(parse(GoalJudgeSpecSchema, { kind: "model", rubric: ["tests pass"] }).ok).toBe(true);
    expect(
      parse(GoalJudgeSpecSchema, { kind: "delegated", owner: "helm", timeoutSec: 30 }).ok,
    ).toBe(true);
    expect(parse(GoalJudgeSpecSchema, { kind: "delegated" }).ok).toBe(false);
    expect(parse(GoalJudgeSpecSchema, { kind: "self" }).ok).toBe(false);
    expect(
      parse(GoalSetInput, { condition: "all green", continuation: "external", replace: true }).ok,
    ).toBe(true);
    const goal = {
      goalId: "g1",
      condition: "all green",
      judge: { kind: "model" },
      maxRuns: 5,
      continuation: "self",
      judgments: 1,
      status: "active",
      lastVerdict: { met: false, reason: "one failing", missing: ["fix test a"] },
    };
    expect(parse(GoalSchema, goal).ok).toBe(true);
    expect(parse(GoalSchema, { ...goal, status: "paused" }).ok).toBe(false);
  });

  test("a work report parses with a turn subject and a null plan", () => {
    const usage = {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: null,
    };
    const report = {
      reportId: "r1",
      subject: { kind: "turn", turnId: TURN_ID },
      outcome: "turn_completed",
      summary: "done",
      resources: { agent: usage, judge: usage, turns: 1, judgments: 0, durationMs: 1200 },
      remaining: { tasks: [{ id: "t2", content: "left over", status: "pending" }], missing: [] },
      artifacts: [],
      plan: null,
    };
    expect(parse(WorkReportSchema, report).ok).toBe(true);
    expect(parse(WorkReportSchema, { ...report, outcome: "paused" }).ok).toBe(false);
    expect(
      parse(WorkReportSchema, { ...report, subject: { kind: "turn", turnId: rawId("thr", 1) } }).ok,
    ).toBe(false);
  });
});

describe("work renderers", () => {
  test("renderTaskList marks statuses, shows the active form, blockers and owners", () => {
    const out: TaskWriteOutputValue = {
      tasks: [
        task("t1", { status: "completed" }),
        task("t2", { status: "in_progress", activeForm: "writing tests", owner: "main" }),
        task("t3", { blocked: true, blockedBy: ["t2"] }),
        task("t4", { status: "failed" }),
        task("t5", { status: "cancelled" }),
      ],
      created: [
        { ref: "@a", id: must(WorkTaskIdSchema, "t3") },
        { ref: null, id: must(WorkTaskIdSchema, "t4") },
      ],
    };
    expect(firstText(renderTaskList(out))).toBe(
      [
        "생성: @a=t3",
        "[x] t1 content of t1",
        "[>] t2 writing tests @main",
        "[ ] t3 content of t3 (막힘: t2)",
        "[!] t4 content of t4",
        "[-] t5 content of t5",
      ].join("\n"),
    );
    expect(firstText(renderTaskList({ tasks: [], created: [] }))).toBe("(작업 없음)");
  });
});

describe("renderPlanSubmit outcomes", () => {
  const id = must(ApprovalIdSchema, APPROVAL_ID);
  const planId = must(PlanIdSchema, "p3");
  function result(
    patch: Partial<Extract<PlanSubmitResult, { status: "decided" }>>,
  ): PlanSubmitResult {
    return {
      status: "decided",
      planId,
      version: 2,
      approvalId: id,
      decision: "approved",
      feedback: null,
      ...patch,
    };
  }

  test("pending, approved, rejected with and without a reason, revision requested", () => {
    expect(
      firstText(renderPlanSubmit({ status: "input_required", planId, version: 2, approvalId: id })),
    ).toBe("계획 p3 v2: 사용자 승인 대기 중.");
    expect(firstText(renderPlanSubmit(result({})))).toBe("계획 p3 v2: 승인됨. 계획대로 실행한다.");
    expect(firstText(renderPlanSubmit(result({ decision: "rejected" })))).toBe(
      "계획 p3 v2: 반려됨.",
    );
    expect(
      firstText(renderPlanSubmit(result({ decision: "rejected", feedback: "too risky" }))),
    ).toBe("계획 p3 v2: 반려됨. 사유: too risky");
    expect(
      firstText(
        renderPlanSubmit(result({ decision: "revision_requested", feedback: "add rollback" })),
      ),
    ).toBe("계획 p3 v2: 수정 요청. add rollback");
  });
});
