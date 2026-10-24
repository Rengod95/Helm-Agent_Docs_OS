import { describe, expect, test } from "bun:test";
import { canonicalJson, parse } from "../../src/base/index.ts";
import {
  ArtifactRefSchema,
  GoalJudgmentSchema,
  GoalSchema,
  ReportUsageSchema,
  WorkReportSchema,
  WorkTaskSchema,
  toJsonSchema,
  type GoalJudgment,
  type Goal,
  type WorkReport,
  type WorkTask,
} from "../../src/capabilities/index.ts";
import {
  ArtifactRefRecordSchema,
  EVENT_CATALOG,
  GoalJudgmentRecordSchema,
  GoalRecordSchema,
  ReportUsageRecordSchema,
  WORK_EVENT_CATALOG,
  WorkReportRecordSchema,
  WorkTaskRecordSchema,
  ownerOfKind,
  parseEventKind,
  type GoalJudgmentRecord,
  type GoalRecord,
  type WorkReportRecord,
  type WorkTaskRecord,
} from "../../src/records/index.ts";
import type { Assignable, Expect } from "../types/expect.ts";
import { rawId } from "../helpers/ids.ts";

// records와 capabilities는 같은 순서라 서로 import하지 않는다. 같은 값 모양을 두 곳에 적었으므로 여기서 JSON Schema로 맞춘다.
export type TaskBothWays = Expect<
  Assignable<WorkTaskRecord, WorkTask> extends true ? Assignable<WorkTask, WorkTaskRecord> : false
>;
export type GoalBothWays = Expect<
  Assignable<GoalRecord, Goal> extends true ? Assignable<Goal, GoalRecord> : false
>;
export type JudgmentBothWays = Expect<
  Assignable<GoalJudgmentRecord, GoalJudgment> extends true
    ? Assignable<GoalJudgment, GoalJudgmentRecord>
    : false
>;
export type ReportBothWays = Expect<
  Assignable<WorkReportRecord, WorkReport> extends true
    ? Assignable<WorkReport, WorkReportRecord>
    : false
>;

/** description은 사람용 설명이라 모양 비교에서 뺀다 */
function withoutDescriptions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutDescriptions);
  if (typeof node !== "object" || node === null) return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== "description")
      .map(([key, value]) => [key, withoutDescriptions(value)]),
  );
}

function sameSchema(
  a: Parameters<typeof toJsonSchema>[0],
  b: Parameters<typeof toJsonSchema>[0],
): boolean {
  return (
    canonicalJson(withoutDescriptions(toJsonSchema(a))) ===
    canonicalJson(withoutDescriptions(toJsonSchema(b)))
  );
}

const TURN = rawId("trn", 3);
const USAGE = {
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: null,
};
const VERDICT = { met: false, reason: "one failing", missing: ["fix test a"] };
const TASK = {
  id: "t1",
  content: "write tests",
  activeForm: null,
  status: "pending",
  owner: null,
  blockedBy: [],
};
const GOAL = {
  goalId: "g1",
  condition: "all green",
  judge: { kind: "model" },
  maxRuns: 5,
  continuation: "self",
  judgments: 0,
  status: "active",
  lastVerdict: null,
};
const REPORT = {
  reportId: "r1",
  subject: { kind: "goal", goalId: "g1" },
  outcome: "met",
  summary: "done",
  resources: { agent: USAGE, judge: USAGE, turns: 3, judgments: 2, durationMs: 1000 },
  remaining: { tasks: [], missing: [] },
  artifacts: [{ artifactId: "art_1", kind: "plan", title: null }],
  plan: { planId: "p1", version: 1, status: "approved" },
};

const PLAN_SUBMITTED: Readonly<Record<string, unknown>> = {
  planId: "p1",
  version: 2,
  title: "Plan",
  body: "# steps",
  artifact: null,
  supersedes: 1,
};
const GOAL_JUDGED: Readonly<Record<string, unknown>> = {
  goalId: "g1",
  n: 1,
  turnId: TURN,
  verdict: VERDICT,
  judgeKind: "model",
  failure: null,
  usage: USAGE,
};

const FIXTURES: Readonly<Record<string, unknown>> = {
  "work.task_created": { task: TASK, ref: "@a" },
  "work.task_changed": {
    taskId: "t1",
    from: "pending",
    set: { status: "in_progress" },
    cause: "auto_start",
  },
  "work.task_linked": { taskId: "t2", blockedBy: ["t1"] },
  "work.task_unlinked": { taskId: "t2", blockedBy: ["t1"] },
  "work.plan_submitted": PLAN_SUBMITTED,
  "work.plan_withdrawn": { planId: "p1", version: 2, reason: "exit_mode" },
  "work.goal_set": { goal: GOAL },
  "work.goal_judged": GOAL_JUDGED,
  "work.goal_settled": { goalId: "g1", status: "met", judgments: 2 },
  "work.report_built": { report: REPORT },
};

function entryOf(kind: string): (typeof WORK_EVENT_CATALOG)[number] {
  const entry = WORK_EVENT_CATALOG.find((e) => e.kind === kind);
  if (entry === undefined) throw new Error(`no catalog entry ${kind}`);
  return entry;
}

describe("work event catalog", () => {
  test("has the ten kinds of L2.work.spec §3.7, all durable at version 1", () => {
    expect(WORK_EVENT_CATALOG.map((e) => e.kind)).toEqual([
      "work.task_created",
      "work.task_changed",
      "work.task_linked",
      "work.task_unlinked",
      "work.plan_submitted",
      "work.plan_withdrawn",
      "work.goal_set",
      "work.goal_judged",
      "work.goal_settled",
      "work.report_built",
    ]);
    for (const entry of WORK_EVENT_CATALOG) {
      expect(entry.durable).toBe(true);
      expect(entry.version).toBe(1);
      expect(entry.retired).toBeUndefined();
    }
  });

  test("names are past-tense snake_case under the work. prefix owned by cap.work", () => {
    for (const entry of WORK_EVENT_CATALOG) {
      expect(entry.kind).toMatch(/^work\.[a-z]+(_[a-z]+)*$/);
      expect(ownerOfKind(entry.kind)).toBe("cap.work");
      expect(EVENT_CATALOG.some((e) => e.kind === entry.kind)).toBe(true);
      expect(parseEventKind(entry.kind).ok).toBe(true);
    }
  });

  test("every kind has a fixture and every fixture a kind", () => {
    expect(Object.keys(FIXTURES).toSorted()).toEqual(
      WORK_EVENT_CATALOG.map((e) => e.kind).toSorted(),
    );
  });

  for (const [kind, fixture] of Object.entries(FIXTURES)) {
    test(`payload round trip: ${kind}`, () => {
      const result = parse(entryOf(kind).payload, JSON.parse(JSON.stringify(fixture)));
      if (!result.ok) throw new Error(JSON.stringify(result.error.issues));
      expect(result.ok).toBe(true);
    });
  }
});

describe("work payload rejections", () => {
  test("task_changed needs at least one changed field and a known cause", () => {
    const entry = entryOf("work.task_changed");
    expect(parse(entry.payload, { taskId: "t1", from: "pending", set: {}, cause: "call" }).ok).toBe(
      false,
    );
    expect(
      parse(entry.payload, {
        taskId: "t1",
        from: "pending",
        set: { status: "failed" },
        cause: "timer",
      }).ok,
    ).toBe(false);
    expect(
      parse(entry.payload, { taskId: "t1", from: "pending", set: { owner: null }, cause: "call" })
        .ok,
    ).toBe(true);
  });

  test("link payloads need one blocker; ids follow the sequence patterns", () => {
    const entry = entryOf("work.task_linked");
    expect(parse(entry.payload, { taskId: "t2", blockedBy: [] }).ok).toBe(false);
    expect(parse(entry.payload, { taskId: "x2", blockedBy: ["t1"] }).ok).toBe(false);
  });

  test("plan payloads: version >= 1, body up to 64 KiB, known withdrawal reason", () => {
    const submitted = entryOf("work.plan_submitted");
    expect(parse(submitted.payload, { ...PLAN_SUBMITTED, version: 0 }).ok).toBe(false);
    expect(parse(submitted.payload, { ...PLAN_SUBMITTED, body: "x".repeat(65537) }).ok).toBe(false);
    const withdrawn = entryOf("work.plan_withdrawn");
    expect(parse(withdrawn.payload, { planId: "p1", version: 1, reason: "timeout" }).ok).toBe(
      false,
    );
  });

  test("judged payload carries the turn id of the trn_ kind and nullable usage", () => {
    const entry = entryOf("work.goal_judged");
    expect(parse(entry.payload, { ...GOAL_JUDGED, turnId: rawId("thr", 1) }).ok).toBe(false);
    expect(parse(entry.payload, { ...GOAL_JUDGED, usage: null }).ok).toBe(true);
    expect(parse(entry.payload, { ...GOAL_JUDGED, n: 0 }).ok).toBe(false);
  });

  test("settled status is any goal status here; the projection test enforces non-active", () => {
    const entry = entryOf("work.goal_settled");
    expect(parse(entry.payload, { goalId: "g1", status: "paused", judgments: 1 }).ok).toBe(false);
    expect(parse(entry.payload, { goalId: "g1", status: "cleared", judgments: 0 }).ok).toBe(true);
  });
});

describe("agreement with capabilities/defs/work.ts", () => {
  test("shared value schemas are the same JSON Schema on both sides", () => {
    expect(sameSchema(WorkTaskRecordSchema, WorkTaskSchema)).toBe(true);
    expect(sameSchema(GoalRecordSchema, GoalSchema)).toBe(true);
    expect(sameSchema(GoalJudgmentRecordSchema, GoalJudgmentSchema)).toBe(true);
    expect(sameSchema(ReportUsageRecordSchema, ReportUsageSchema)).toBe(true);
    expect(sameSchema(WorkReportRecordSchema, WorkReportSchema)).toBe(true);
    expect(sameSchema(ArtifactRefRecordSchema, ArtifactRefSchema)).toBe(true);
  });
});
