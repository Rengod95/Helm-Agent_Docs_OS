import { Type, type TUnsafe } from "typebox";
import type { Brand, SchemaProof, SchemaSound } from "../../base/index.ts";
import { TurnIdSchema, type TurnId } from "../../conversation/index.ts";
import type { CatalogEntry } from "./entry.ts";

// L2.work.spec §3.7. 소유 생산자 cap.work는 owners.ts가 정한다. 모두 내구, 버전 1이다.
//
// records는 capabilities와 같은 순서라 capabilities/defs/work.ts를 import하지 않는다(F.readme §3). 하위 값의 모양은
// JSON 수준으로 같게 다시 적고, 두 쪽의 일치는 test/records/work-catalog.test.ts가 JSON Schema 비교로 확인한다.
// 브랜드는 base의 같은 Brand 타입이라 defs/work.ts의 WorkTaskId 등과 서로 대입된다.

type WorkTaskId = Brand<string, "WorkTaskId">;
type PlanId = Brand<string, "PlanId">;
type GoalId = Brand<string, "GoalId">;
type ReportId = Brand<string, "ReportId">;

const WorkTaskIdRecord = Type.Unsafe<WorkTaskId>(Type.String({ pattern: "^t[1-9][0-9]{0,5}$" }));
const PlanIdRecord = Type.Unsafe<PlanId>(Type.String({ pattern: "^p[1-9][0-9]{0,5}$" }));
const GoalIdRecord = Type.Unsafe<GoalId>(Type.String({ pattern: "^g[1-9][0-9]{0,5}$" }));
const ReportIdRecord = Type.Unsafe<ReportId>(Type.String({ pattern: "^r[1-9][0-9]{0,5}$" }));
const OwnerRecord = Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9_./:-]{0,63}$" });
const TaskRefRecord = Type.String({ pattern: "^@[a-z0-9_-]{1,16}$" });

const TaskStatusRecord = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);
type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";

const PlanStatusRecord = Type.Union([
  Type.Literal("submitted"),
  Type.Literal("approved"),
  Type.Literal("rejected"),
  Type.Literal("revision_requested"),
  Type.Literal("superseded"),
  Type.Literal("withdrawn"),
]);
type PlanStatus =
  | "submitted"
  | "approved"
  | "rejected"
  | "revision_requested"
  | "superseded"
  | "withdrawn";

// ── 값 모양(defs/work.ts와 일치를 시험한다) ─────────────────────────────

export type ArtifactRefRecord = { artifactId: string; kind: string; title: string | null };
const artifactRefShape = Type.Object(
  {
    artifactId: Type.String({ minLength: 1, maxLength: 64 }),
    kind: Type.String({ maxLength: 32 }),
    title: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export const ArtifactRefRecordSchema: TUnsafe<ArtifactRefRecord> = Type.Unsafe<ArtifactRefRecord>(
  artifactRefShape satisfies SchemaProof<ArtifactRefRecord, typeof artifactRefShape>,
);

export type WorkTaskRecord = {
  id: WorkTaskId;
  content: string;
  activeForm: string | null;
  status: TaskStatus;
  owner: string | null;
  blockedBy: WorkTaskId[];
};
const workTaskShape = Type.Object(
  {
    id: WorkTaskIdRecord,
    content: Type.String({ minLength: 1, maxLength: 500 }),
    activeForm: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
    status: TaskStatusRecord,
    owner: Type.Union([OwnerRecord, Type.Null()]),
    blockedBy: Type.Array(WorkTaskIdRecord, { maxItems: 32, uniqueItems: true }),
  },
  { additionalProperties: false },
);
export const WorkTaskRecordSchema: TUnsafe<WorkTaskRecord> = Type.Unsafe<WorkTaskRecord>(
  workTaskShape satisfies SchemaProof<WorkTaskRecord, typeof workTaskShape>,
);

export type GoalVerdictRecord = { met: boolean; reason: string; missing: string[] };
const goalVerdictShape = Type.Object(
  {
    met: Type.Boolean(),
    reason: Type.String({ minLength: 1, maxLength: 2000 }),
    missing: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 }),
  },
  { additionalProperties: false },
);
export const GoalVerdictRecordSchema: TUnsafe<GoalVerdictRecord> = Type.Unsafe<GoalVerdictRecord>(
  goalVerdictShape satisfies SchemaProof<GoalVerdictRecord, typeof goalVerdictShape>,
);

type GoalJudgeSpecRecord =
  | { kind: "model"; rubric?: string[] }
  | { kind: "delegated"; owner: string; timeoutSec?: number };
const goalJudgeSpecShape = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("model"),
      rubric: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 20 }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("delegated"),
      owner: Type.String({ minLength: 1, maxLength: 64 }),
      timeoutSec: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600 })),
    },
    { additionalProperties: false },
  ),
]);
const GoalJudgeSpecRecordSchema: TUnsafe<GoalJudgeSpecRecord> = Type.Unsafe<GoalJudgeSpecRecord>(
  goalJudgeSpecShape satisfies SchemaSound<GoalJudgeSpecRecord, typeof goalJudgeSpecShape>,
);

const GoalStatusRecord = Type.Union([
  Type.Literal("active"),
  Type.Literal("met"),
  Type.Literal("limit_reached"),
  Type.Literal("cleared"),
  Type.Literal("judge_failed"),
]);
type GoalStatus = "active" | "met" | "limit_reached" | "cleared" | "judge_failed";

export type GoalRecord = {
  goalId: GoalId;
  condition: string;
  judge: GoalJudgeSpecRecord;
  maxRuns: number;
  continuation: "self" | "external";
  judgments: number;
  status: GoalStatus;
  lastVerdict: GoalVerdictRecord | null;
};
const goalShape = Type.Object(
  {
    goalId: GoalIdRecord,
    condition: Type.String({ minLength: 1, maxLength: 2000 }),
    judge: GoalJudgeSpecRecordSchema,
    maxRuns: Type.Integer({ minimum: 1 }),
    continuation: Type.Union([Type.Literal("self"), Type.Literal("external")]),
    judgments: Type.Integer({ minimum: 0 }),
    status: GoalStatusRecord,
    lastVerdict: Type.Union([GoalVerdictRecordSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export const GoalRecordSchema: TUnsafe<GoalRecord> = Type.Unsafe<GoalRecord>(
  goalShape satisfies SchemaProof<GoalRecord, typeof goalShape>,
);

export type GoalJudgmentRecord = {
  goalId: GoalId;
  n: number;
  turnId: TurnId;
  verdict: GoalVerdictRecord | null;
  judgeKind: "model" | "delegated";
  failure: { code: string; message: string } | null;
};
const goalJudgmentFields = {
  goalId: GoalIdRecord,
  n: Type.Integer({ minimum: 1 }),
  turnId: TurnIdSchema,
  verdict: Type.Union([GoalVerdictRecordSchema, Type.Null()]),
  judgeKind: Type.Union([Type.Literal("model"), Type.Literal("delegated")]),
  failure: Type.Union([
    Type.Object(
      { code: Type.String(), message: Type.String({ maxLength: 1000 }) },
      { additionalProperties: false },
    ),
    Type.Null(),
  ]),
};
const goalJudgmentShape = Type.Object(goalJudgmentFields, { additionalProperties: false });
export const GoalJudgmentRecordSchema: TUnsafe<GoalJudgmentRecord> =
  Type.Unsafe<GoalJudgmentRecord>(
    goalJudgmentShape satisfies SchemaProof<GoalJudgmentRecord, typeof goalJudgmentShape>,
  );

export type ReportUsageRecord = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
};
const reportUsageShape = Type.Object(
  {
    inputTokens: Type.Integer({ minimum: 0 }),
    outputTokens: Type.Integer({ minimum: 0 }),
    cacheReadTokens: Type.Integer({ minimum: 0 }),
    cacheWriteTokens: Type.Integer({ minimum: 0 }),
    costUsd: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export const ReportUsageRecordSchema: TUnsafe<ReportUsageRecord> = Type.Unsafe<ReportUsageRecord>(
  reportUsageShape satisfies SchemaProof<ReportUsageRecord, typeof reportUsageShape>,
);

export type WorkReportRecord = {
  reportId: ReportId;
  subject: { kind: "goal"; goalId: GoalId } | { kind: "turn"; turnId: TurnId };
  outcome: "met" | "limit_reached" | "cleared" | "judge_failed" | "turn_completed" | "turn_failed";
  summary: string;
  resources: {
    agent: ReportUsageRecord;
    judge: ReportUsageRecord;
    turns: number;
    judgments: number;
    durationMs: number;
  };
  remaining: {
    tasks: { id: WorkTaskId; content: string; status: TaskStatus }[];
    missing: string[];
  };
  artifacts: ArtifactRefRecord[];
  plan: { planId: PlanId; version: number; status: PlanStatus } | null;
};
const workReportShape = Type.Object(
  {
    reportId: ReportIdRecord,
    subject: Type.Union([
      Type.Object(
        { kind: Type.Literal("goal"), goalId: GoalIdRecord },
        { additionalProperties: false },
      ),
      Type.Object(
        { kind: Type.Literal("turn"), turnId: TurnIdSchema },
        { additionalProperties: false },
      ),
    ]),
    outcome: Type.Union([
      Type.Literal("met"),
      Type.Literal("limit_reached"),
      Type.Literal("cleared"),
      Type.Literal("judge_failed"),
      Type.Literal("turn_completed"),
      Type.Literal("turn_failed"),
    ]),
    summary: Type.String({ maxLength: 4000 }),
    resources: Type.Object(
      {
        agent: ReportUsageRecordSchema,
        judge: ReportUsageRecordSchema,
        turns: Type.Integer({ minimum: 0 }),
        judgments: Type.Integer({ minimum: 0 }),
        durationMs: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    remaining: Type.Object(
      {
        tasks: Type.Array(
          Type.Object(
            { id: WorkTaskIdRecord, content: Type.String(), status: TaskStatusRecord },
            { additionalProperties: false },
          ),
          { maxItems: 100 },
        ),
        missing: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 }),
      },
      { additionalProperties: false },
    ),
    artifacts: Type.Array(ArtifactRefRecordSchema, { maxItems: 100 }),
    plan: Type.Union([
      Type.Object(
        { planId: PlanIdRecord, version: Type.Integer({ minimum: 1 }), status: PlanStatusRecord },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export const WorkReportRecordSchema: TUnsafe<WorkReportRecord> = Type.Unsafe<WorkReportRecord>(
  workReportShape satisfies SchemaProof<WorkReportRecord, typeof workReportShape>,
);

// ── 이벤트 payload (§3.7) ───────────────────────────────────────────────

export type WorkTaskCreatedPayload = { task: WorkTaskRecord; ref: string | null };
const workTaskCreatedShape = Type.Object(
  { task: WorkTaskRecordSchema, ref: Type.Union([TaskRefRecord, Type.Null()]) },
  { additionalProperties: false },
);
export const WorkTaskCreatedSchema: TUnsafe<WorkTaskCreatedPayload> =
  Type.Unsafe<WorkTaskCreatedPayload>(
    workTaskCreatedShape satisfies SchemaProof<WorkTaskCreatedPayload, typeof workTaskCreatedShape>,
  );

export type WorkTaskChangedPayload = {
  taskId: WorkTaskId;
  from: TaskStatus;
  set: {
    content?: string;
    activeForm?: string | null;
    status?: TaskStatus;
    owner?: string | null;
  };
  /** "call"(서비스 호출) 또는 "auto_start"(§4.1.4) */
  cause: "call" | "auto_start";
};
const workTaskChangedShape = Type.Object(
  {
    taskId: WorkTaskIdRecord,
    from: TaskStatusRecord,
    set: Type.Object(
      {
        content: Type.Optional(Type.String()),
        activeForm: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        status: Type.Optional(TaskStatusRecord),
        owner: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      },
      { additionalProperties: false, minProperties: 1 },
    ),
    cause: Type.Union([Type.Literal("call"), Type.Literal("auto_start")]),
  },
  { additionalProperties: false },
);
export const WorkTaskChangedSchema: TUnsafe<WorkTaskChangedPayload> =
  Type.Unsafe<WorkTaskChangedPayload>(
    workTaskChangedShape satisfies SchemaProof<WorkTaskChangedPayload, typeof workTaskChangedShape>,
  );

export type WorkTaskLinkPayload = { taskId: WorkTaskId; blockedBy: WorkTaskId[] };
const workTaskLinkShape = Type.Object(
  { taskId: WorkTaskIdRecord, blockedBy: Type.Array(WorkTaskIdRecord, { minItems: 1 }) },
  { additionalProperties: false },
);
export const WorkTaskLinkSchema: TUnsafe<WorkTaskLinkPayload> = Type.Unsafe<WorkTaskLinkPayload>(
  workTaskLinkShape satisfies SchemaProof<WorkTaskLinkPayload, typeof workTaskLinkShape>,
);

export type WorkPlanSubmittedPayload = {
  planId: PlanId;
  version: number;
  title: string;
  body: string;
  artifact: ArtifactRefRecord | null;
  supersedes: number | null;
};
const workPlanSubmittedShape = Type.Object(
  {
    planId: PlanIdRecord,
    version: Type.Integer({ minimum: 1 }),
    title: Type.String(),
    body: Type.String({ maxLength: 65536 }),
    artifact: Type.Union([ArtifactRefRecordSchema, Type.Null()]),
    supersedes: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export const WorkPlanSubmittedSchema: TUnsafe<WorkPlanSubmittedPayload> =
  Type.Unsafe<WorkPlanSubmittedPayload>(
    workPlanSubmittedShape satisfies SchemaProof<
      WorkPlanSubmittedPayload,
      typeof workPlanSubmittedShape
    >,
  );

export type WorkPlanWithdrawnPayload = {
  planId: PlanId;
  version: number;
  reason: "exit_mode" | "goal_cleared" | "call";
};
const workPlanWithdrawnShape = Type.Object(
  {
    planId: PlanIdRecord,
    version: Type.Integer({ minimum: 1 }),
    reason: Type.Union([
      Type.Literal("exit_mode"),
      Type.Literal("goal_cleared"),
      Type.Literal("call"),
    ]),
  },
  { additionalProperties: false },
);
export const WorkPlanWithdrawnSchema: TUnsafe<WorkPlanWithdrawnPayload> =
  Type.Unsafe<WorkPlanWithdrawnPayload>(
    workPlanWithdrawnShape satisfies SchemaProof<
      WorkPlanWithdrawnPayload,
      typeof workPlanWithdrawnShape
    >,
  );

/** judgments: 0, status: "active"인 새 목표 */
export type WorkGoalSetPayload = { goal: GoalRecord };
const workGoalSetShape = Type.Object({ goal: GoalRecordSchema }, { additionalProperties: false });
export const WorkGoalSetSchema: TUnsafe<WorkGoalSetPayload> = Type.Unsafe<WorkGoalSetPayload>(
  workGoalSetShape satisfies SchemaProof<WorkGoalSetPayload, typeof workGoalSetShape>,
);

export type WorkGoalJudgedPayload = GoalJudgmentRecord & { usage: ReportUsageRecord | null };
const workGoalJudgedShape = Type.Object(
  { ...goalJudgmentFields, usage: Type.Union([ReportUsageRecordSchema, Type.Null()]) },
  { additionalProperties: false },
);
export const WorkGoalJudgedSchema: TUnsafe<WorkGoalJudgedPayload> =
  Type.Unsafe<WorkGoalJudgedPayload>(
    workGoalJudgedShape satisfies SchemaProof<WorkGoalJudgedPayload, typeof workGoalJudgedShape>,
  );

/** status에는 "active"가 오지 않는다. 스키마는 막지 않고 투영 시험이 확인한다 */
export type WorkGoalSettledPayload = { goalId: GoalId; status: GoalStatus; judgments: number };
const workGoalSettledShape = Type.Object(
  {
    goalId: GoalIdRecord,
    status: GoalStatusRecord,
    judgments: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export const WorkGoalSettledSchema: TUnsafe<WorkGoalSettledPayload> =
  Type.Unsafe<WorkGoalSettledPayload>(
    workGoalSettledShape satisfies SchemaProof<WorkGoalSettledPayload, typeof workGoalSettledShape>,
  );

export type WorkReportBuiltPayload = { report: WorkReportRecord };
const workReportBuiltShape = Type.Object(
  { report: WorkReportRecordSchema },
  { additionalProperties: false },
);
export const WorkReportBuiltSchema: TUnsafe<WorkReportBuiltPayload> =
  Type.Unsafe<WorkReportBuiltPayload>(
    workReportBuiltShape satisfies SchemaProof<WorkReportBuiltPayload, typeof workReportBuiltShape>,
  );

/** 도메인 소유 카탈로그(F.records.spec §3.3.2). 모두 내구, 생산자 cap.work는 owners.ts가 정한다 */
export const WORK_EVENT_CATALOG: readonly CatalogEntry[] = [
  { kind: "work.task_created", version: 1, durable: true, payload: WorkTaskCreatedSchema },
  { kind: "work.task_changed", version: 1, durable: true, payload: WorkTaskChangedSchema },
  { kind: "work.task_linked", version: 1, durable: true, payload: WorkTaskLinkSchema },
  { kind: "work.task_unlinked", version: 1, durable: true, payload: WorkTaskLinkSchema },
  { kind: "work.plan_submitted", version: 1, durable: true, payload: WorkPlanSubmittedSchema },
  { kind: "work.plan_withdrawn", version: 1, durable: true, payload: WorkPlanWithdrawnSchema },
  { kind: "work.goal_set", version: 1, durable: true, payload: WorkGoalSetSchema },
  { kind: "work.goal_judged", version: 1, durable: true, payload: WorkGoalJudgedSchema },
  { kind: "work.goal_settled", version: 1, durable: true, payload: WorkGoalSettledSchema },
  { kind: "work.report_built", version: 1, durable: true, payload: WorkReportBuiltSchema },
];
