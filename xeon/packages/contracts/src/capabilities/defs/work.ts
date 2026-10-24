import {
  Type,
  type Static,
  type TLiteral,
  type TObject,
  type TString,
  type TUnion,
  type TUnsafe,
} from "typebox";
import type { Brand, SchemaProof, SchemaSound } from "../../base/index.ts";
import {
  ApprovalIdSchema,
  TurnIdSchema,
  type ApprovalId,
  type TurnId,
} from "../../conversation/index.ts";
import type { CapabilityApi, CapabilityDef } from "../capability.ts";
import type { MethodDef } from "../method.ts";
import { defineCapability } from "../capability.ts";
import { serviceKey, type ServiceKey } from "../service-key.ts";
import type { ToolContent, ToolSpec } from "../tool-spec.ts";

// L2.work.spec §3. 정의 파일은 이 파일 하나다. 순수 함수(renderTaskList, renderPlanSubmit)는 모델에 가는 텍스트를 고정한다.

// ── 공통: ID와 호출 문맥 (§3.1) ─────────────────────────────────────────

/** 스레드 안 순번 ID. 모델이 읽고 쓰기 쉬운 짧은 문자열이다. 발급 규칙은 §4.1 */
export type WorkTaskId = Brand<string, "WorkTaskId">; // "t1", "t2", ...
export type PlanId = Brand<string, "PlanId">; // "p1", ...
export type GoalId = Brand<string, "GoalId">; // "g1", ...
export type ReportId = Brand<string, "ReportId">; // "r1", ...

export const WORK_TASK_ID_PATTERN: string = "^t[1-9][0-9]{0,5}$";
export const PLAN_ID_PATTERN: string = "^p[1-9][0-9]{0,5}$";
export const GOAL_ID_PATTERN: string = "^g[1-9][0-9]{0,5}$";
export const REPORT_ID_PATTERN: string = "^r[1-9][0-9]{0,5}$";

export const WorkTaskIdSchema: TUnsafe<WorkTaskId> = Type.Unsafe<WorkTaskId>(
  Type.String({ pattern: WORK_TASK_ID_PATTERN }),
);
export const PlanIdSchema: TUnsafe<PlanId> = Type.Unsafe<PlanId>(
  Type.String({ pattern: PLAN_ID_PATTERN }),
);
export const GoalIdSchema: TUnsafe<GoalId> = Type.Unsafe<GoalId>(
  Type.String({ pattern: GOAL_ID_PATTERN }),
);
export const ReportIdSchema: TUnsafe<ReportId> = Type.Unsafe<ReportId>(
  Type.String({ pattern: REPORT_ID_PATTERN }),
);

/** owner 문자열: "main", 서브에이전트 이름, 그룹 scope id 등. 해석은 하지 않는다 */
export const OWNER_PATTERN: string = "^[A-Za-z0-9][A-Za-z0-9_./:-]{0,63}$";
export const OwnerSchema: TString = Type.String({ pattern: OWNER_PATTERN });

/** 산출물 참조. 모양의 정본은 L2.artifacts.spec이다 [가정] */
export type ArtifactRef = { artifactId: string; kind: string; title: string | null };
const artifactRefShape = Type.Object(
  {
    artifactId: Type.String({ minLength: 1, maxLength: 64 }),
    kind: Type.String({ maxLength: 32 }),
    title: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export const ArtifactRefSchema: TUnsafe<ArtifactRef> = Type.Unsafe<ArtifactRef>(
  artifactRefShape satisfies SchemaProof<ArtifactRef, typeof artifactRefShape>,
);

// ── work.tasks (§3.2) ──────────────────────────────────────────────────

export const WorkTaskStatusSchema: TUnion<
  [
    TLiteral<"pending">,
    TLiteral<"in_progress">,
    TLiteral<"completed">,
    TLiteral<"failed">,
    TLiteral<"cancelled">,
  ]
> = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);
export type WorkTaskStatus = Static<typeof WorkTaskStatusSchema>;

const Content = Type.String({ minLength: 1, maxLength: 500 });
const ActiveForm = Type.String({
  minLength: 1,
  maxLength: 200,
  description: "진행 중일 때 표시할 문장. 예: '테스트를 고치는 중'",
});

export type WorkTask = {
  id: WorkTaskId;
  content: string;
  activeForm: string | null;
  status: WorkTaskStatus;
  owner: string | null;
  blockedBy: WorkTaskId[];
};
const workTaskFields = {
  id: WorkTaskIdSchema,
  content: Content,
  activeForm: Type.Union([ActiveForm, Type.Null()]),
  status: WorkTaskStatusSchema,
  owner: Type.Union([OwnerSchema, Type.Null()]),
  blockedBy: Type.Array(WorkTaskIdSchema, { maxItems: 32, uniqueItems: true }),
};
const workTaskShape = Type.Object(workTaskFields, { additionalProperties: false });
export const WorkTaskSchema: TUnsafe<WorkTask> = Type.Unsafe<WorkTask>(
  workTaskShape satisfies SchemaProof<WorkTask, typeof workTaskShape>,
);

/** 조회용. 투영에서 계산한 값을 더한다 */
export type WorkTaskView = WorkTask & {
  blocked: boolean;
  /** 이 작업을 선행 작업으로 둔 작업들 */
  blocks: WorkTaskId[];
};
const workTaskViewShape = Type.Object(
  {
    ...workTaskFields,
    blocked: Type.Boolean(),
    blocks: Type.Array(WorkTaskIdSchema),
  },
  { additionalProperties: false },
);
export const WorkTaskViewSchema: TUnsafe<WorkTaskView> = Type.Unsafe<WorkTaskView>(
  workTaskViewShape satisfies SchemaProof<WorkTaskView, typeof workTaskViewShape>,
);

/** 같은 write 호출 안에서 새 작업을 가리키는 임시 참조. "@" + 1~16자 */
export const TaskRefSchema: TString = Type.String({ pattern: "^@[a-z0-9_-]{1,16}$" });
const TaskTarget = Type.Union([WorkTaskIdSchema, TaskRefSchema]);

export type TaskCreateInputValue = {
  content: string;
  activeForm?: string;
  status?: WorkTaskStatus;
  owner?: string;
  blockedBy?: WorkTaskId[];
};
const taskCreateInputShape = Type.Object(
  {
    content: Content,
    activeForm: Type.Optional(ActiveForm),
    status: Type.Optional(WorkTaskStatusSchema),
    owner: Type.Optional(OwnerSchema),
    blockedBy: Type.Optional(Type.Array(WorkTaskIdSchema, { maxItems: 32, uniqueItems: true })),
  },
  { additionalProperties: false },
);
export const TaskCreateInput: TUnsafe<TaskCreateInputValue> = Type.Unsafe<TaskCreateInputValue>(
  taskCreateInputShape satisfies SchemaProof<TaskCreateInputValue, typeof taskCreateInputShape>,
);

export type TaskUpdateInputValue = {
  id: WorkTaskId;
  content?: string;
  activeForm?: string | null;
  status?: WorkTaskStatus;
  owner?: string | null;
  /** 막힌 작업을 in_progress로 바꿀 때만 쓴다(§4.1.3) */
  force?: boolean;
};
const taskUpdateInputShape = Type.Object(
  {
    id: WorkTaskIdSchema,
    content: Type.Optional(Content),
    activeForm: Type.Optional(Type.Union([ActiveForm, Type.Null()])),
    status: Type.Optional(WorkTaskStatusSchema),
    owner: Type.Optional(Type.Union([OwnerSchema, Type.Null()])),
    force: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const TaskUpdateInput: TUnsafe<TaskUpdateInputValue> = Type.Unsafe<TaskUpdateInputValue>(
  taskUpdateInputShape satisfies SchemaProof<TaskUpdateInputValue, typeof taskUpdateInputShape>,
);

export type TaskLinkInputValue = { id: WorkTaskId; blockedBy: WorkTaskId[]; op: "add" | "remove" };
const taskLinkInputShape = Type.Object(
  {
    id: WorkTaskIdSchema,
    blockedBy: Type.Array(WorkTaskIdSchema, { minItems: 1, maxItems: 32, uniqueItems: true }),
    op: Type.Union([Type.Literal("add"), Type.Literal("remove")]),
  },
  { additionalProperties: false },
);
export const TaskLinkInput: TUnsafe<TaskLinkInputValue> = Type.Unsafe<TaskLinkInputValue>(
  taskLinkInputShape satisfies SchemaProof<TaskLinkInputValue, typeof taskLinkInputShape>,
);

export type TaskListInputValue = { status?: WorkTaskStatus[]; owner?: string };
const taskListInputShape = Type.Object(
  {
    status: Type.Optional(
      Type.Array(WorkTaskStatusSchema, { minItems: 1, maxItems: 5, uniqueItems: true }),
    ),
    owner: Type.Optional(OwnerSchema),
  },
  { additionalProperties: false },
);
export const TaskListInput: TUnsafe<TaskListInputValue> = Type.Unsafe<TaskListInputValue>(
  taskListInputShape satisfies SchemaProof<TaskListInputValue, typeof taskListInputShape>,
);

export type TaskOp =
  | {
      op: "create";
      ref?: string;
      content: string;
      activeForm?: string;
      status?: WorkTaskStatus;
      owner?: string;
      blockedBy?: (WorkTaskId | string)[];
    }
  | {
      op: "update";
      id: WorkTaskId | string;
      content?: string;
      activeForm?: string | null;
      status?: WorkTaskStatus;
      owner?: string | null;
      force?: boolean;
    }
  | { op: "link" | "unlink"; id: WorkTaskId | string; blockedBy: (WorkTaskId | string)[] };
const taskOpShape = Type.Union([
  Type.Object(
    {
      op: Type.Literal("create"),
      ref: Type.Optional(TaskRefSchema),
      content: Content,
      activeForm: Type.Optional(ActiveForm),
      status: Type.Optional(WorkTaskStatusSchema),
      owner: Type.Optional(OwnerSchema),
      blockedBy: Type.Optional(Type.Array(TaskTarget, { maxItems: 32, uniqueItems: true })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      op: Type.Literal("update"),
      id: TaskTarget,
      content: Type.Optional(Content),
      activeForm: Type.Optional(Type.Union([ActiveForm, Type.Null()])),
      status: Type.Optional(WorkTaskStatusSchema),
      owner: Type.Optional(Type.Union([OwnerSchema, Type.Null()])),
      force: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      op: Type.Union([Type.Literal("link"), Type.Literal("unlink")]),
      id: TaskTarget,
      blockedBy: Type.Array(TaskTarget, { minItems: 1, maxItems: 32, uniqueItems: true }),
    },
    { additionalProperties: false },
  ),
]);
export const TaskOpSchema: TUnsafe<TaskOp> = Type.Unsafe<TaskOp>(
  taskOpShape satisfies SchemaSound<TaskOp, typeof taskOpShape>,
);

export type TaskWriteInputValue = { ops: TaskOp[] };
const taskWriteInputShape = Type.Object(
  { ops: Type.Array(TaskOpSchema, { minItems: 1, maxItems: 50 }) },
  { additionalProperties: false },
);
export const TaskWriteInput: TUnsafe<TaskWriteInputValue> = Type.Unsafe<TaskWriteInputValue>(
  taskWriteInputShape satisfies SchemaProof<TaskWriteInputValue, typeof taskWriteInputShape>,
);

export type TaskWriteOutputValue = {
  tasks: WorkTaskView[];
  created: { ref: string | null; id: WorkTaskId }[];
};
const taskWriteOutputShape = Type.Object(
  {
    tasks: Type.Array(WorkTaskViewSchema),
    created: Type.Array(
      Type.Object(
        { ref: Type.Union([TaskRefSchema, Type.Null()]), id: WorkTaskIdSchema },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export const TaskWriteOutput: TUnsafe<TaskWriteOutputValue> = Type.Unsafe<TaskWriteOutputValue>(
  taskWriteOutputShape satisfies SchemaProof<TaskWriteOutputValue, typeof taskWriteOutputShape>,
);

export type TaskOutputValue = { task: WorkTaskView };
const taskOutputShape = Type.Object({ task: WorkTaskViewSchema }, { additionalProperties: false });
export const TaskOutput: TUnsafe<TaskOutputValue> = Type.Unsafe<TaskOutputValue>(
  taskOutputShape satisfies SchemaProof<TaskOutputValue, typeof taskOutputShape>,
);

export type TaskListOutputValue = { tasks: WorkTaskView[] };
const taskListOutputShape = Type.Object(
  { tasks: Type.Array(WorkTaskViewSchema) },
  { additionalProperties: false },
);
export const TaskListOutput: TUnsafe<TaskListOutputValue> = Type.Unsafe<TaskListOutputValue>(
  taskListOutputShape satisfies SchemaProof<TaskListOutputValue, typeof taskListOutputShape>,
);

const TASK_ERRORS = {
  task_cycle: {
    description: "선행 간선을 더하면 순환이 생긴다. detail.path는 순환 경로",
    retryable: false,
    detail: Type.Object({ path: Type.Array(WorkTaskIdSchema) }),
  },
  task_blocked: {
    description: "끝나지 않은 선행 작업이 있어 시작할 수 없다",
    retryable: false,
    detail: Type.Object({ blockers: Type.Array(WorkTaskIdSchema) }),
  },
  task_transition_invalid: {
    description: "허용하지 않는 상태 전이(§4.1.2)",
    retryable: false,
    detail: Type.Object({ from: WorkTaskStatusSchema, to: WorkTaskStatusSchema }),
  },
  task_ref_unknown: { description: "write 안의 임시 참조가 앞선 create에 없다", retryable: false },
  task_limit: { description: "스레드의 작업 수 상한(MAX_WORK_TASKS) 초과", retryable: false },
} as const;

const TASK_MARK: Readonly<Record<WorkTaskStatus, string>> = {
  pending: "[ ]",
  in_progress: "[>]",
  completed: "[x]",
  failed: "[!]",
  cancelled: "[-]",
};

/** task_write 결과를 모델용 체크리스트로 그린다. 순수 함수 */
export function renderTaskList(out: TaskWriteOutputValue): ToolContent {
  const lines = out.tasks.map((t) => {
    const label = t.status === "in_progress" && t.activeForm !== null ? t.activeForm : t.content;
    const blocked = t.blocked ? ` (막힘: ${t.blockedBy.join(", ")})` : "";
    const owner = t.owner === null ? "" : ` @${t.owner}`;
    return `${TASK_MARK[t.status]} ${t.id} ${label}${blocked}${owner}`;
  });
  const created = out.created
    .filter((c) => c.ref !== null)
    .map((c) => `${c.ref}=${c.id}`)
    .join(", ");
  const head = created === "" ? "" : `생성: ${created}\n`;
  return {
    content: [{ type: "text", text: head + (lines.length > 0 ? lines.join("\n") : "(작업 없음)") }],
    structuredContent: out,
  };
}

export const MAX_WORK_TASKS: number = 500;

type TasksMethods = {
  readonly create: MethodDef<typeof TaskCreateInput, typeof TaskOutput>;
  readonly update: MethodDef<typeof TaskUpdateInput, typeof TaskOutput>;
  readonly link: MethodDef<typeof TaskLinkInput, typeof TaskOutput>;
  readonly list: MethodDef<typeof TaskListInput, typeof TaskListOutput>;
  readonly write: MethodDef<typeof TaskWriteInput, typeof TaskWriteOutput>;
};

export const WorkTasks: CapabilityDef<
  TasksMethods,
  readonly [ToolSpec<"write", typeof TaskWriteInput, TasksMethods["write"]>]
> = defineCapability({
  id: "work.tasks",
  version: "1.0.0",
  description: "턴 사이에 유지되는 작업 목록과 선행 간선.",
  service: {
    methods: {
      create: {
        description: "작업 하나를 만든다.",
        input: TaskCreateInput,
        output: TaskOutput,
        replay: "safe",
        errors: TASK_ERRORS,
      },
      update: {
        description: "작업의 내용, 상태, owner를 바꾼다.",
        input: TaskUpdateInput,
        output: TaskOutput,
        replay: "safe",
        errors: TASK_ERRORS,
      },
      link: {
        description: "선행 간선을 더하거나 뺀다. 순환이 생기면 거부한다.",
        input: TaskLinkInput,
        output: TaskOutput,
        replay: "safe",
        errors: TASK_ERRORS,
      },
      list: {
        description: "작업 목록을 조회한다.",
        input: TaskListInput,
        output: TaskListOutput,
        replay: "safe",
      },
      write: {
        description: "여러 연산을 한 번에 적용한다. 전부 적용되거나 하나도 적용되지 않는다.",
        input: TaskWriteInput,
        output: TaskWriteOutput,
        replay: "safe",
        errors: TASK_ERRORS,
      },
    },
  },
  tools: [
    {
      name: "task_write",
      label: "작업 목록",
      description:
        "작업 목록을 만들고 갱신한다. ops에 create, update, link, unlink 연산을 순서대로 적는다. " +
        "같은 호출에서 만든 작업은 ref(@a 같은 이름)로 가리킬 수 있다. 한 번에 in_progress는 하나만 두기를 권한다. " +
        "결과로 전체 목록을 돌려준다.",
      method: "write",
      parameters: TaskWriteInput,
      toContent: renderTaskList,
      outputSchema: TaskWriteOutput,
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    },
  ],
});
export const WorkTasksKey: ServiceKey<CapabilityApi<typeof WorkTasks>> = serviceKey(WorkTasks);

// ── work.plans (§3.3) ──────────────────────────────────────────────────

export const PlanStatusSchema: TUnion<
  [
    // 승인 대기
    TLiteral<"submitted">,
    TLiteral<"approved">,
    TLiteral<"rejected">,
    // 사용자가 수정 요청
    TLiteral<"revision_requested">,
    // 새 버전이 제출됨
    TLiteral<"superseded">,
    // 승인 없이 계획 모드를 나감
    TLiteral<"withdrawn">,
  ]
> = Type.Union([
  Type.Literal("submitted"),
  Type.Literal("approved"),
  Type.Literal("rejected"),
  Type.Literal("revision_requested"),
  Type.Literal("superseded"),
  Type.Literal("withdrawn"),
]);
export type PlanStatus = Static<typeof PlanStatusSchema>;

export const PlanDecisionSchema: TUnion<
  [TLiteral<"approved">, TLiteral<"rejected">, TLiteral<"revision_requested">]
> = Type.Union([
  Type.Literal("approved"),
  Type.Literal("rejected"),
  Type.Literal("revision_requested"),
]);
export type PlanDecision = Static<typeof PlanDecisionSchema>;

const PlanTitle = Type.String({ minLength: 1, maxLength: 200 });
const PlanBody = Type.String({ minLength: 1, maxLength: 65536, description: "Markdown 계획 본문" });

export type PlanVersion = {
  planId: PlanId;
  version: number;
  title: string;
  body: string;
  status: PlanStatus;
  artifact: ArtifactRef | null;
  approvalId: ApprovalId | null;
  /** 반려 사유 또는 수정 요청 내용 */
  feedback: string | null;
};
const planVersionShape = Type.Object(
  {
    planId: PlanIdSchema,
    version: Type.Integer({ minimum: 1, maximum: 999 }),
    title: PlanTitle,
    body: PlanBody,
    status: PlanStatusSchema,
    artifact: Type.Union([ArtifactRefSchema, Type.Null()]),
    approvalId: Type.Union([ApprovalIdSchema, Type.Null()]),
    feedback: Type.Union([Type.String({ maxLength: 8192 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export const PlanVersionSchema: TUnsafe<PlanVersion> = Type.Unsafe<PlanVersion>(
  planVersionShape satisfies SchemaProof<PlanVersion, typeof planVersionShape>,
);

export type PlanEnterModeInputValue = { reason?: string };
const planEnterModeInputShape = Type.Object(
  { reason: Type.Optional(Type.String({ maxLength: 500 })) },
  { additionalProperties: false },
);
export const PlanEnterModeInput: TUnsafe<PlanEnterModeInputValue> =
  Type.Unsafe<PlanEnterModeInputValue>(
    planEnterModeInputShape satisfies SchemaProof<
      PlanEnterModeInputValue,
      typeof planEnterModeInputShape
    >,
  );

export type PlanModeOutputValue = { mode: string; previousMode: string | null };
const planModeOutputShape = Type.Object(
  {
    mode: Type.String({ minLength: 1, maxLength: 32 }),
    previousMode: Type.Union([Type.String({ maxLength: 32 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export const PlanModeOutput: TUnsafe<PlanModeOutputValue> = Type.Unsafe<PlanModeOutputValue>(
  planModeOutputShape satisfies SchemaProof<PlanModeOutputValue, typeof planModeOutputShape>,
);

/** 입력이 없는 메서드와 도구가 쓴다 */
export const PlanExitModeInput: TObject<{}> = Type.Object({}, { additionalProperties: false });

export type PlanSubmitParamsValue = {
  title: string;
  body: string;
  /** 기존 계획의 새 버전이면 그 planId */
  planId?: PlanId;
};
const submitFields = {
  title: PlanTitle,
  body: PlanBody,
  planId: Type.Optional(PlanIdSchema),
};
const planSubmitParamsShape = Type.Object(submitFields, { additionalProperties: false });
export const PlanSubmitParams: TUnsafe<PlanSubmitParamsValue> = Type.Unsafe<PlanSubmitParamsValue>(
  planSubmitParamsShape satisfies SchemaProof<PlanSubmitParamsValue, typeof planSubmitParamsShape>,
);

export type PlanSubmitInputValue = PlanSubmitParamsValue & {
  /** 참이면 결정이 날 때까지 반환을 미룬다(메모리 대기). 도구 경로는 거짓(§4.2.4) */
  wait?: boolean;
};
const planSubmitInputShape = Type.Object(
  { ...submitFields, wait: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export const PlanSubmitInput: TUnsafe<PlanSubmitInputValue> = Type.Unsafe<PlanSubmitInputValue>(
  planSubmitInputShape satisfies SchemaProof<PlanSubmitInputValue, typeof planSubmitInputShape>,
);

export type PlanSubmitResult =
  | { status: "input_required"; planId: PlanId; version: number; approvalId: ApprovalId }
  | {
      status: "decided";
      planId: PlanId;
      version: number;
      approvalId: ApprovalId;
      decision: PlanDecision;
      feedback: string | null;
    };
const planSubmitOutputShape = Type.Union([
  Type.Object(
    {
      status: Type.Literal("input_required"),
      planId: PlanIdSchema,
      version: Type.Integer({ minimum: 1 }),
      approvalId: ApprovalIdSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal("decided"),
      planId: PlanIdSchema,
      version: Type.Integer({ minimum: 1 }),
      approvalId: ApprovalIdSchema,
      decision: PlanDecisionSchema,
      feedback: Type.Union([Type.String(), Type.Null()]),
    },
    { additionalProperties: false },
  ),
]);
export const PlanSubmitOutput: TUnsafe<PlanSubmitResult> = Type.Unsafe<PlanSubmitResult>(
  planSubmitOutputShape satisfies SchemaSound<PlanSubmitResult, typeof planSubmitOutputShape>,
);

const planTargetFields = {
  planId: PlanIdSchema,
  version: Type.Optional(Type.Integer({ minimum: 1 })),
};
export type PlanApproveInputValue = { planId: PlanId; version?: number; note?: string };
const planApproveInputShape = Type.Object(
  { ...planTargetFields, note: Type.Optional(Type.String({ maxLength: 2000 })) },
  { additionalProperties: false },
);
export const PlanApproveInput: TUnsafe<PlanApproveInputValue> = Type.Unsafe<PlanApproveInputValue>(
  planApproveInputShape satisfies SchemaProof<PlanApproveInputValue, typeof planApproveInputShape>,
);

export type PlanRejectInputValue = { planId: PlanId; version?: number; reason?: string };
const planRejectInputShape = Type.Object(
  { ...planTargetFields, reason: Type.Optional(Type.String({ maxLength: 8192 })) },
  { additionalProperties: false },
);
export const PlanRejectInput: TUnsafe<PlanRejectInputValue> = Type.Unsafe<PlanRejectInputValue>(
  planRejectInputShape satisfies SchemaProof<PlanRejectInputValue, typeof planRejectInputShape>,
);

export type PlanReviseInputValue = { planId: PlanId; version?: number; feedback: string };
const planReviseInputShape = Type.Object(
  { ...planTargetFields, feedback: Type.String({ minLength: 1, maxLength: 8192 }) },
  { additionalProperties: false },
);
export const PlanReviseInput: TUnsafe<PlanReviseInputValue> = Type.Unsafe<PlanReviseInputValue>(
  planReviseInputShape satisfies SchemaProof<PlanReviseInputValue, typeof planReviseInputShape>,
);

export type PlanVersionsInputValue = { planId: PlanId };
const planVersionsInputShape = Type.Object(
  { planId: PlanIdSchema },
  { additionalProperties: false },
);
export const PlanVersionsInput: TUnsafe<PlanVersionsInputValue> =
  Type.Unsafe<PlanVersionsInputValue>(
    planVersionsInputShape satisfies SchemaProof<
      PlanVersionsInputValue,
      typeof planVersionsInputShape
    >,
  );

export type PlanOutputValue = { plan: PlanVersion };
const planOutputShape = Type.Object({ plan: PlanVersionSchema }, { additionalProperties: false });
export const PlanOutput: TUnsafe<PlanOutputValue> = Type.Unsafe<PlanOutputValue>(
  planOutputShape satisfies SchemaProof<PlanOutputValue, typeof planOutputShape>,
);

export type PlanVersionsOutputValue = { versions: PlanVersion[] };
const planVersionsOutputShape = Type.Object(
  { versions: Type.Array(PlanVersionSchema) },
  { additionalProperties: false },
);
export const PlanVersionsOutput: TUnsafe<PlanVersionsOutputValue> =
  Type.Unsafe<PlanVersionsOutputValue>(
    planVersionsOutputShape satisfies SchemaProof<
      PlanVersionsOutputValue,
      typeof planVersionsOutputShape
    >,
  );

const PLAN_ERRORS = {
  plan_not_approved: {
    description: "승인 필수 설정에서 승인된 계획 없이 계획 모드를 나가려 함",
    retryable: false,
  },
  plan_pending: { description: "같은 계획의 이전 버전이 아직 승인 대기 중", retryable: false },
  plan_closed: {
    description: "이미 결정된 버전에 결정을 다시 내리려 함",
    retryable: false,
    detail: Type.Object({ status: PlanStatusSchema }),
  },
  plan_mode_inactive: {
    description: "계획 모드가 아닌데 계획 모드 전용 동작을 요청함",
    retryable: false,
  },
} as const;

/** submit_plan 결과의 모델용 문장. 순수 함수 */
export function renderPlanSubmit(out: PlanSubmitResult): ToolContent {
  const head = `계획 ${out.planId} v${out.version}`;
  let text: string;
  if (out.status === "input_required") {
    text = `${head}: 사용자 승인 대기 중.`;
  } else if (out.decision === "approved") {
    text = `${head}: 승인됨. 계획대로 실행한다.`;
  } else if (out.decision === "rejected") {
    text = `${head}: 반려됨.${out.feedback === null || out.feedback === "" ? "" : ` 사유: ${out.feedback}`}`;
  } else {
    text = `${head}: 수정 요청. ${out.feedback ?? ""}`.trimEnd();
  }
  return { content: [{ type: "text", text }], structuredContent: out };
}

/** 승인 요청의 대상(subject) 내용. 승인 kind = "plan" */
export type PlanApprovalSubject = {
  planId: PlanId;
  version: number;
  title: string;
  body: string;
  artifact: ArtifactRef | null;
};
const planApprovalSubjectShape = Type.Object(
  {
    planId: PlanIdSchema,
    version: Type.Integer({ minimum: 1 }),
    title: Type.String({ maxLength: 200 }),
    body: Type.String({ maxLength: 65536 }),
    artifact: Type.Union([ArtifactRefSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export const PlanApprovalSubjectSchema: TUnsafe<PlanApprovalSubject> =
  Type.Unsafe<PlanApprovalSubject>(
    planApprovalSubjectShape satisfies SchemaProof<
      PlanApprovalSubject,
      typeof planApprovalSubjectShape
    >,
  );

/** decision = "answer"일 때의 answer 내용. decision이 "allow" | "deny"이면 answer는 null 또는 { note: string }이다 */
export type PlanApprovalAnswer = { action: "revise"; feedback: string };
const planApprovalAnswerShape = Type.Object(
  { action: Type.Literal("revise"), feedback: Type.String({ minLength: 1, maxLength: 8192 }) },
  { additionalProperties: false },
);
export const PlanApprovalAnswerSchema: TUnsafe<PlanApprovalAnswer> =
  Type.Unsafe<PlanApprovalAnswer>(
    planApprovalAnswerShape satisfies SchemaProof<
      PlanApprovalAnswer,
      typeof planApprovalAnswerShape
    >,
  );

type PlansMethods = {
  readonly enterMode: MethodDef<typeof PlanEnterModeInput, typeof PlanModeOutput>;
  readonly exitMode: MethodDef<typeof PlanExitModeInput, typeof PlanModeOutput>;
  readonly submit: MethodDef<typeof PlanSubmitInput, typeof PlanSubmitOutput>;
  readonly approve: MethodDef<typeof PlanApproveInput, typeof PlanOutput>;
  readonly reject: MethodDef<typeof PlanRejectInput, typeof PlanOutput>;
  readonly revise: MethodDef<typeof PlanReviseInput, typeof PlanOutput>;
  readonly versions: MethodDef<typeof PlanVersionsInput, typeof PlanVersionsOutput>;
};

export const WorkPlans: CapabilityDef<
  PlansMethods,
  readonly [
    ToolSpec<"enterMode", typeof PlanEnterModeInput, PlansMethods["enterMode"]>,
    ToolSpec<"exitMode", typeof PlanExitModeInput, PlansMethods["exitMode"]>,
    ToolSpec<"submit", typeof PlanSubmitParams, PlansMethods["submit"]>,
  ]
> = defineCapability({
  id: "work.plans",
  version: "1.0.0",
  description: "계획 객체와 승인 흐름. 계획 모드의 쓰기 차단은 L1.tools가 한다.",
  service: {
    methods: {
      enterMode: {
        description: "권한 모드를 계획 모드로 바꾸도록 L1.tools에 요청한다.",
        input: PlanEnterModeInput,
        output: PlanModeOutput,
        replay: "safe",
        errors: PLAN_ERRORS,
      },
      exitMode: {
        description:
          "계획 모드를 끝내고 이전 모드로 돌린다. 승인 필수면 승인된 계획이 있어야 한다.",
        input: PlanExitModeInput,
        output: PlanModeOutput,
        replay: "safe",
        errors: PLAN_ERRORS,
      },
      submit: {
        description: "계획을 제출하고 승인을 요청한다.",
        input: PlanSubmitInput,
        output: PlanSubmitOutput,
        replay: "safe",
        errors: PLAN_ERRORS,
      },
      approve: {
        description: "승인 대기 중인 버전을 승인한다.",
        input: PlanApproveInput,
        output: PlanOutput,
        replay: "safe",
        errors: PLAN_ERRORS,
      },
      reject: {
        description: "승인 대기 중인 버전을 반려한다.",
        input: PlanRejectInput,
        output: PlanOutput,
        replay: "safe",
        errors: PLAN_ERRORS,
      },
      revise: {
        description: "승인 대기 중인 버전에 수정을 요청한다.",
        input: PlanReviseInput,
        output: PlanOutput,
        replay: "safe",
        errors: PLAN_ERRORS,
      },
      versions: {
        description: "계획의 모든 버전을 조회한다.",
        input: PlanVersionsInput,
        output: PlanVersionsOutput,
        replay: "safe",
      },
    },
  },
  tools: [
    {
      name: "enter_plan_mode",
      label: "계획 모드 시작",
      description: "쓰기 도구를 막는 계획 모드로 들어간다. 큰 변경 전에 조사와 계획만 할 때 쓴다.",
      method: "enterMode",
      parameters: PlanEnterModeInput,
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    },
    {
      name: "exit_plan_mode",
      label: "계획 모드 종료",
      description:
        "계획 모드를 끝낸다. 승인 필수 설정이면 submit_plan으로 승인받은 뒤에만 끝낼 수 있다.",
      method: "exitMode",
      parameters: PlanExitModeInput,
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    },
    {
      name: "submit_plan",
      label: "계획 제출",
      description:
        "계획을 Markdown 본문으로 제출하고 사용자 승인을 받는다. 결과는 승인, 반려, 수정 요청 중 하나다. " +
        "수정 요청이면 같은 planId로 새 버전을 제출한다.",
      method: "submit",
      parameters: PlanSubmitParams,
      toInput: (p) => ({ ...p, wait: false }),
      toContent: renderPlanSubmit,
      outputSchema: PlanSubmitOutput,
      replay: "safe",
      executionMode: "sequential",
      hints: { readOnly: false, destructive: false, idempotent: true, openWorld: false },
    },
  ],
});
export const WorkPlansKey: ServiceKey<CapabilityApi<typeof WorkPlans>> = serviceKey(WorkPlans);

// ── work.goals (§3.4) ──────────────────────────────────────────────────

/** 판정 방식. model: 별도 판정 모델(기본). delegated: 다른 주체가 judge 메서드로 판정을 넣는다(L3 판정자) */
export type GoalJudgeSpec =
  | {
      kind: "model";
      /** 판정 기준 목록. L1.agents JudgeInput.goal.criteria로 넘긴다. 모델 역할은 L1.models 역할 표의 judge로 고정이다 */
      rubric?: string[];
    }
  | {
      kind: "delegated";
      /** 판정을 넣을 주체의 scope id(F.extensions.spec ScopeId). 예: "<그룹 이름>" */
      owner: string;
      /** 턴이 끝난 뒤 판정을 기다리는 시간. 생략하면 설정 l2.work.goal.delegatedTimeoutSec */
      timeoutSec?: number;
    };
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
export const GoalJudgeSpecSchema: TUnsafe<GoalJudgeSpec> = Type.Unsafe<GoalJudgeSpec>(
  goalJudgeSpecShape satisfies SchemaSound<GoalJudgeSpec, typeof goalJudgeSpecShape>,
);

export type GoalVerdict = {
  met: boolean;
  reason: string;
  /** 미충족이면 부족한 점. 다음 턴 안내문에 들어간다 */
  missing: string[];
};
const goalVerdictShape = Type.Object(
  {
    met: Type.Boolean(),
    reason: Type.String({ minLength: 1, maxLength: 2000 }),
    missing: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 }),
  },
  { additionalProperties: false },
);
export const GoalVerdictSchema: TUnsafe<GoalVerdict> = Type.Unsafe<GoalVerdict>(
  goalVerdictShape satisfies SchemaProof<GoalVerdict, typeof goalVerdictShape>,
);

export const GoalStatusSchema: TUnion<
  [
    TLiteral<"active">,
    TLiteral<"met">,
    TLiteral<"limit_reached">,
    TLiteral<"cleared">,
    TLiteral<"judge_failed">,
  ]
> = Type.Union([
  Type.Literal("active"),
  Type.Literal("met"),
  Type.Literal("limit_reached"),
  Type.Literal("cleared"),
  Type.Literal("judge_failed"),
]);
export type GoalStatus = Static<typeof GoalStatusSchema>;

/** 미충족 판정 뒤 다음 턴을 누가 투입하는가. self: work.goals가 post. external: 판정만 기록(goalId 루프가 투입, L2.readme §4.2) */
export const GoalContinuationSchema: TUnion<[TLiteral<"self">, TLiteral<"external">]> = Type.Union([
  Type.Literal("self"),
  Type.Literal("external"),
]);
export type GoalContinuation = Static<typeof GoalContinuationSchema>;

export type Goal = {
  goalId: GoalId;
  condition: string;
  judge: GoalJudgeSpec;
  /** 목표 설정 시점의 l1.agents.judge.maxRuns 값. 표시용이다. 상한 판정은 L1.agents가 한다(§4.3.2) */
  maxRuns: number;
  continuation: GoalContinuation;
  judgments: number;
  status: GoalStatus;
  lastVerdict: GoalVerdict | null;
};
const goalShape = Type.Object(
  {
    goalId: GoalIdSchema,
    condition: Type.String({ minLength: 1, maxLength: 2000 }),
    judge: GoalJudgeSpecSchema,
    maxRuns: Type.Integer({ minimum: 1 }),
    continuation: GoalContinuationSchema,
    judgments: Type.Integer({ minimum: 0 }),
    status: GoalStatusSchema,
    lastVerdict: Type.Union([GoalVerdictSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export const GoalSchema: TUnsafe<Goal> = Type.Unsafe<Goal>(
  goalShape satisfies SchemaProof<Goal, typeof goalShape>,
);

export type GoalJudgment = {
  goalId: GoalId;
  /** 1부터 시작하는 판정 순번 */
  n: number;
  turnId: TurnId;
  /** 판정 실패면 null */
  verdict: GoalVerdict | null;
  judgeKind: "model" | "delegated";
  failure: { code: string; message: string } | null;
};
const goalJudgmentFields = {
  goalId: GoalIdSchema,
  n: Type.Integer({ minimum: 1 }),
  turnId: TurnIdSchema,
  verdict: Type.Union([GoalVerdictSchema, Type.Null()]),
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
export const GoalJudgmentSchema: TUnsafe<GoalJudgment> = Type.Unsafe<GoalJudgment>(
  goalJudgmentShape satisfies SchemaProof<GoalJudgment, typeof goalJudgmentShape>,
);

export type GoalSetInputValue = {
  condition: string;
  judge?: GoalJudgeSpec;
  /** 생략하면 "self" */
  continuation?: GoalContinuation;
  /** 참이면 활성 목표를 cleared로 끝내고 새 목표를 건다 */
  replace?: boolean;
};
const goalSetInputShape = Type.Object(
  {
    condition: Type.String({ minLength: 1, maxLength: 2000 }),
    judge: Type.Optional(GoalJudgeSpecSchema),
    continuation: Type.Optional(GoalContinuationSchema),
    replace: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export const GoalSetInput: TUnsafe<GoalSetInputValue> = Type.Unsafe<GoalSetInputValue>(
  goalSetInputShape satisfies SchemaProof<GoalSetInputValue, typeof goalSetInputShape>,
);

export type GoalRefInput = { goalId?: GoalId };
const goalRefInputShape = Type.Object(
  { goalId: Type.Optional(GoalIdSchema) },
  { additionalProperties: false },
);
export const GoalStatusInput: TUnsafe<GoalRefInput> = Type.Unsafe<GoalRefInput>(
  goalRefInputShape satisfies SchemaProof<GoalRefInput, typeof goalRefInputShape>,
);
export const GoalClearInput: TUnsafe<GoalRefInput> = Type.Unsafe<GoalRefInput>(
  goalRefInputShape satisfies SchemaProof<GoalRefInput, typeof goalRefInputShape>,
);

export type GoalJudgeInputValue = { goalId: GoalId; turnId: TurnId; verdict: GoalVerdict };
const goalJudgeInputShape = Type.Object(
  { goalId: GoalIdSchema, turnId: TurnIdSchema, verdict: GoalVerdictSchema },
  { additionalProperties: false },
);
export const GoalJudgeInput: TUnsafe<GoalJudgeInputValue> = Type.Unsafe<GoalJudgeInputValue>(
  goalJudgeInputShape satisfies SchemaProof<GoalJudgeInputValue, typeof goalJudgeInputShape>,
);

export type GoalOutputValue = { goal: Goal };
const goalOutputShape = Type.Object({ goal: GoalSchema }, { additionalProperties: false });
export const GoalOutput: TUnsafe<GoalOutputValue> = Type.Unsafe<GoalOutputValue>(
  goalOutputShape satisfies SchemaProof<GoalOutputValue, typeof goalOutputShape>,
);

export type GoalStatusOutputValue = { goal: Goal | null; recent: GoalJudgment[] };
const goalStatusOutputShape = Type.Object(
  {
    goal: Type.Union([GoalSchema, Type.Null()]),
    recent: Type.Array(GoalJudgmentSchema, { maxItems: 10 }),
  },
  { additionalProperties: false },
);
export const GoalStatusOutput: TUnsafe<GoalStatusOutputValue> = Type.Unsafe<GoalStatusOutputValue>(
  goalStatusOutputShape satisfies SchemaProof<GoalStatusOutputValue, typeof goalStatusOutputShape>,
);

export type GoalJudgeOutputValue = { goal: Goal; judgment: GoalJudgment };
const goalJudgeOutputShape = Type.Object(
  { goal: GoalSchema, judgment: GoalJudgmentSchema },
  { additionalProperties: false },
);
export const GoalJudgeOutput: TUnsafe<GoalJudgeOutputValue> = Type.Unsafe<GoalJudgeOutputValue>(
  goalJudgeOutputShape satisfies SchemaProof<GoalJudgeOutputValue, typeof goalJudgeOutputShape>,
);

const GOAL_ERRORS = {
  goal_active: {
    description: "활성 목표가 이미 있다. replace: true로 바꿀 수 있다",
    retryable: false,
    detail: Type.Object({ goalId: GoalIdSchema }),
  },
  goal_closed: { description: "끝난 목표에 판정이나 해제를 요청함", retryable: false },
  goal_not_delegated: {
    description: "delegated 판정자가 아닌 목표에 judge를 호출함",
    retryable: false,
  },
  goal_turn_stale: {
    description: "판정 대상 턴이 그 목표의 판정 대기 턴이 아님",
    retryable: false,
  },
} as const;

type GoalsMethods = {
  readonly set: MethodDef<typeof GoalSetInput, typeof GoalOutput>;
  readonly status: MethodDef<typeof GoalStatusInput, typeof GoalStatusOutput>;
  readonly clear: MethodDef<typeof GoalClearInput, typeof GoalOutput>;
  readonly judge: MethodDef<typeof GoalJudgeInput, typeof GoalJudgeOutput>;
};

/** 모델 도구가 없는 능력이다. 모델 자가 판정은 채택하지 않는다(§4.3.1) */
export const WorkGoals: CapabilityDef<GoalsMethods, readonly []> = defineCapability({
  id: "work.goals",
  version: "1.0.0",
  description:
    "완료 조건을 걸고 턴마다 별도 판정자의 판정으로 다음 턴을 이어 간다. 모델 도구는 없다.",
  service: {
    methods: {
      set: {
        description: "목표를 건다.",
        input: GoalSetInput,
        output: GoalOutput,
        replay: "safe",
        errors: GOAL_ERRORS,
      },
      status: {
        description: "활성 목표(또는 지정 목표)와 최근 판정을 조회한다.",
        input: GoalStatusInput,
        output: GoalStatusOutput,
        replay: "safe",
      },
      clear: {
        description: "목표를 해제한다.",
        input: GoalClearInput,
        output: GoalOutput,
        replay: "safe",
        errors: GOAL_ERRORS,
      },
      judge: {
        description: "delegated 판정자가 판정을 넣는다.",
        input: GoalJudgeInput,
        output: GoalJudgeOutput,
        replay: "safe",
        errors: GOAL_ERRORS,
      },
    },
  },
  tools: [],
});
export const WorkGoalsKey: ServiceKey<CapabilityApi<typeof WorkGoals>> = serviceKey(WorkGoals);

// ── work.reports (§3.5) ────────────────────────────────────────────────

export type ReportSubject = { kind: "goal"; goalId: GoalId } | { kind: "turn"; turnId: TurnId };
const reportSubjectShape = Type.Union([
  Type.Object(
    { kind: Type.Literal("goal"), goalId: GoalIdSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("turn"), turnId: TurnIdSchema },
    { additionalProperties: false },
  ),
]);
export const ReportSubjectSchema: TUnsafe<ReportSubject> = Type.Unsafe<ReportSubject>(
  reportSubjectShape satisfies SchemaSound<ReportSubject, typeof reportSubjectShape>,
);

export const ReportOutcomeSchema: TUnion<
  [
    TLiteral<"met">,
    TLiteral<"limit_reached">,
    TLiteral<"cleared">,
    TLiteral<"judge_failed">,
    TLiteral<"turn_completed">,
    TLiteral<"turn_failed">,
  ]
> = Type.Union([
  Type.Literal("met"),
  Type.Literal("limit_reached"),
  Type.Literal("cleared"),
  Type.Literal("judge_failed"),
  Type.Literal("turn_completed"),
  Type.Literal("turn_failed"),
]);
export type ReportOutcome = Static<typeof ReportOutcomeSchema>;

export type ReportUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** provider가 비용을 주지 않으면 null */
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
export const ReportUsageSchema: TUnsafe<ReportUsage> = Type.Unsafe<ReportUsage>(
  reportUsageShape satisfies SchemaProof<ReportUsage, typeof reportUsageShape>,
);

export type WorkReport = {
  reportId: ReportId;
  subject: ReportSubject;
  outcome: ReportOutcome;
  /** 결과 요약. 4,000자 이하 */
  summary: string;
  resources: {
    /** 대상 범위 턴들의 모델 사용량 합계 */
    agent: ReportUsage;
    /** 판정 모델 사용량 합계. 목표가 아니면 0 */
    judge: ReportUsage;
    turns: number;
    judgments: number;
    /** 첫 턴 시작부터 마지막 기록까지. recordedAt 차이(ms) */
    durationMs: number;
  };
  remaining: {
    tasks: { id: WorkTaskId; content: string; status: WorkTaskStatus }[];
    /** 마지막 판정의 missing */
    missing: string[];
  };
  artifacts: ArtifactRef[];
  plan: { planId: PlanId; version: number; status: PlanStatus } | null;
};
const workReportShape = Type.Object(
  {
    reportId: ReportIdSchema,
    subject: ReportSubjectSchema,
    outcome: ReportOutcomeSchema,
    summary: Type.String({ maxLength: 4000 }),
    resources: Type.Object(
      {
        agent: ReportUsageSchema,
        judge: ReportUsageSchema,
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
            { id: WorkTaskIdSchema, content: Type.String(), status: WorkTaskStatusSchema },
            { additionalProperties: false },
          ),
          { maxItems: 100 },
        ),
        missing: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 20 }),
      },
      { additionalProperties: false },
    ),
    artifacts: Type.Array(ArtifactRefSchema, { maxItems: 100 }),
    plan: Type.Union([
      Type.Object(
        {
          planId: PlanIdSchema,
          version: Type.Integer({ minimum: 1 }),
          status: PlanStatusSchema,
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export const WorkReportSchema: TUnsafe<WorkReport> = Type.Unsafe<WorkReport>(
  workReportShape satisfies SchemaProof<WorkReport, typeof workReportShape>,
);

export type ReportBuildInputValue = {
  subject: ReportSubject;
  /** 호출자가 요약을 주면 그대로 쓴다. 없으면 §4.4 3항 규칙으로 만든다 */
  summary?: string;
  /** 호출자가 아는 산출물. artifacts.registry가 있으면 그 목록과 합친다 */
  artifacts?: ArtifactRef[];
};
const reportBuildInputShape = Type.Object(
  {
    subject: ReportSubjectSchema,
    summary: Type.Optional(Type.String({ maxLength: 4000 })),
    artifacts: Type.Optional(Type.Array(ArtifactRefSchema, { maxItems: 100 })),
  },
  { additionalProperties: false },
);
export const ReportBuildInput: TUnsafe<ReportBuildInputValue> = Type.Unsafe<ReportBuildInputValue>(
  reportBuildInputShape satisfies SchemaProof<ReportBuildInputValue, typeof reportBuildInputShape>,
);

export type ReportBuildOutputValue = { report: WorkReport };
const reportBuildOutputShape = Type.Object(
  { report: WorkReportSchema },
  { additionalProperties: false },
);
export const ReportBuildOutput: TUnsafe<ReportBuildOutputValue> =
  Type.Unsafe<ReportBuildOutputValue>(
    reportBuildOutputShape satisfies SchemaProof<
      ReportBuildOutputValue,
      typeof reportBuildOutputShape
    >,
  );

type ReportsMethods = {
  readonly build: MethodDef<typeof ReportBuildInput, typeof ReportBuildOutput>;
};

/** 모델 도구가 없는 능력이다. 턴 결과 형식이다 */
export const WorkReports: CapabilityDef<ReportsMethods, readonly []> = defineCapability({
  id: "work.reports",
  version: "1.0.0",
  description:
    "완료 보고를 정해진 스키마로 만들고 이벤트로 남긴다. 턴 결과 형식이며 모델 도구는 없다.",
  service: {
    methods: {
      build: {
        description: "대상(목표 또는 턴)의 완료 보고를 만든다.",
        input: ReportBuildInput,
        output: ReportBuildOutput,
        replay: "safe",
      },
    },
  },
  tools: [],
});
export const WorkReportsKey: ServiceKey<CapabilityApi<typeof WorkReports>> =
  serviceKey(WorkReports);

// ── 서비스 묶음 (§3.6) ─────────────────────────────────────────────────

/** work 도메인 묶음 타입(L2.readme §5.6). Cordis에 등록하지 않는다. 등록은 능력마다 cap:<id> 바인딩이다 */
export interface WorkService {
  readonly tasks: CapabilityApi<typeof WorkTasks>;
  readonly plans: CapabilityApi<typeof WorkPlans>;
  readonly goals: CapabilityApi<typeof WorkGoals>;
  readonly reports: CapabilityApi<typeof WorkReports>;
}
/** 묶음 이름. eng.context-map.design §5.3 표의 이름이고 Cordis 등록 이름이 아니다 */
export const WorkServiceName = "xeon.work" as const;
export const WORK_CAPABILITIES: readonly [
  typeof WorkTasks,
  typeof WorkPlans,
  typeof WorkGoals,
  typeof WorkReports,
] = [WorkTasks, WorkPlans, WorkGoals, WorkReports];
