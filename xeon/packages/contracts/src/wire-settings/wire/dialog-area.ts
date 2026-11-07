import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "../../base/index.ts";
import {
  HashHexSchema,
  MemoryEntryIdSchema,
  MemoryReadOutputSchema,
  MemoryStoreSchema,
  MemoryWriteOutputSchema,
  PlanVersionsOutput,
  SkillFilePathSchema,
  SkillScopeSchema,
  type MemoryReadOutput,
  type MemoryStore,
  type MemoryWriteOutput,
  type PlanVersionsOutputValue,
  type SkillScope,
} from "../../capabilities/index.ts";
import {
  closed,
  m4,
  NoParamsSchema,
  request,
  RequestKeySchema,
  type Io,
  type M4Spec,
  type NoParams,
  type Req,
} from "./schema-kit.ts";

// F.wire-settings.spec §3.3.5(M4 대화 영역). L4.desktop-ux.spec §10.1 W-02, W-05, W-06, W-07, W-12, W-14, W-17, W-18.
// W-01(`approval.list`의 threadId 생략), W-16(`thread.read.around`, `ThreadSummary.origin`)은 methods.ts의 기존 스키마를 고쳤다.
// W-12(`host.clients`)의 처리기는 host.ts, W-17(`turn.withdraw`)의 처리기는 turn.ts에 있다. 나머지 처리기는 대화 영역 포트를 거친다.

const Id = Type.String({ minLength: 1, maxLength: 128 });
const Iso = Type.String({ minLength: 1, maxLength: 40 });
const Count = Type.Integer({ minimum: 0 });
const Text = Type.String({ maxLength: 20000 });
const ThreadRef = Type.String({ minLength: 1, maxLength: 64 });
/** `host.clients`의 연결 수 상한. 넘는 연결은 싣지 않는다(자기 연결은 앞에 둔다) */
export const HOST_CLIENTS_MAX = 256;

/** `review.get`(W-02). 승인 페이로드에 없는 hunk 본문을 읽는다 */
export interface ReviewGetParams {
  readonly reviewId: string;
}
const ReviewGetParamsShape = request({ reviewId: Id });
export const ReviewGetParamsSchema: TUnsafe<Req<ReviewGetParams>> = Type.Unsafe<
  Req<ReviewGetParams>
>(ReviewGetParamsShape satisfies SchemaProof<Req<ReviewGetParams>, typeof ReviewGetParamsShape>);
export interface HunkLine {
  readonly kind: "context" | "add" | "del";
  readonly text: string;
}
export interface HunkView {
  readonly hunkId: string;
  readonly header: string;
  readonly oldStart: number;
  readonly newStart: number;
  readonly lines: readonly HunkLine[];
}
export interface ReviewFileView {
  readonly path: string;
  readonly hunks: readonly HunkView[];
}
export interface ReviewGetResult {
  readonly reviewId: string;
  readonly files: readonly ReviewFileView[];
}
const ReviewGetResultShape = closed({
  reviewId: Id,
  files: Type.Array(
    closed({
      path: Type.String({ minLength: 1, maxLength: 4096 }),
      hunks: Type.Array(
        closed({
          hunkId: Id,
          header: Type.String({ maxLength: 512 }),
          oldStart: Count,
          newStart: Count,
          lines: Type.Array(
            closed({
              kind: Type.Union([Type.Literal("context"), Type.Literal("add"), Type.Literal("del")]),
              text: Text,
            }),
            { maxItems: 5000 },
          ),
        }),
        { maxItems: 500 },
      ),
    }),
    { maxItems: 500 },
  ),
});
export const ReviewGetResultSchema: TUnsafe<ReviewGetResult> = Type.Unsafe<ReviewGetResult>(
  ReviewGetResultShape satisfies SchemaProof<ReviewGetResult, typeof ReviewGetResultShape>,
);

/** `goal.status`(W-05), `work.tasks.list`(W-06) 공통 params */
export interface ThreadScopedParams {
  readonly threadId: string;
}
const ThreadRefParamsShape = request({ threadId: ThreadRef });
export const ThreadRefM4ParamsSchema: TUnsafe<Req<ThreadScopedParams>> = Type.Unsafe<
  Req<ThreadScopedParams>
>(ThreadRefParamsShape satisfies SchemaProof<Req<ThreadScopedParams>, typeof ThreadRefParamsShape>);

export interface GoalView {
  readonly condition: string;
  readonly status: "active" | "met" | "exhausted" | "cleared";
  /** 판정 횟수("판정 2/3"의 2) */
  readonly judged: number;
  /** 최대 판정 횟수(3) */
  readonly maxJudgments: number;
  readonly lastVerdict: { readonly met: boolean; readonly reason: string } | null;
}
export interface GoalStatusResult {
  /** 목표가 없으면 null */
  readonly goal: GoalView | null;
}
const GoalStatusResultShape = closed({
  goal: Type.Union([
    closed({
      condition: Type.String({ maxLength: 4000 }),
      status: Type.Union([
        Type.Literal("active"),
        Type.Literal("met"),
        Type.Literal("exhausted"),
        Type.Literal("cleared"),
      ]),
      judged: Count,
      maxJudgments: Count,
      lastVerdict: Type.Union([
        closed({ met: Type.Boolean(), reason: Type.String({ maxLength: 2000 }) }),
        Type.Null(),
      ]),
    }),
    Type.Null(),
  ]),
});
export const GoalStatusResultSchema: TUnsafe<GoalStatusResult> = Type.Unsafe<GoalStatusResult>(
  GoalStatusResultShape satisfies SchemaProof<GoalStatusResult, typeof GoalStatusResultShape>,
);

export interface TaskView {
  readonly taskId: string;
  readonly content: string;
  readonly status: "pending" | "in_progress" | "done" | "cancelled";
  /** 막힘 사유. 막히지 않았으면 null */
  readonly blockedBy: string | null;
}
export interface WorkTasksListResult {
  readonly tasks: readonly TaskView[];
}
const WorkTasksListResultShape = closed({
  tasks: Type.Array(
    closed({
      taskId: Id,
      content: Type.String({ maxLength: 2000 }),
      status: Type.Union([
        Type.Literal("pending"),
        Type.Literal("in_progress"),
        Type.Literal("done"),
        Type.Literal("cancelled"),
      ]),
      blockedBy: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    }),
    { maxItems: 500 },
  ),
});
export const WorkTasksListResultSchema: TUnsafe<WorkTasksListResult> =
  Type.Unsafe<WorkTasksListResult>(
    WorkTasksListResultShape satisfies SchemaProof<
      WorkTasksListResult,
      typeof WorkTasksListResultShape
    >,
  );

/** `schedule.update`(W-07). 다시 켜기와 고치기 */
export interface ScheduleUpdateParams {
  readonly scheduleId: string;
  readonly enabled?: boolean;
  readonly title?: string;
  readonly prompt?: string;
}
const ScheduleUpdateParamsShape = request({
  scheduleId: Id,
  enabled: Type.Optional(Type.Boolean()),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  prompt: Type.Optional(Type.String({ minLength: 1, maxLength: 20000 })),
});
export const ScheduleUpdateParamsSchema: TUnsafe<Req<ScheduleUpdateParams>> = Type.Unsafe<
  Req<ScheduleUpdateParams>
>(
  ScheduleUpdateParamsShape satisfies SchemaProof<
    Req<ScheduleUpdateParams>,
    typeof ScheduleUpdateParamsShape
  >,
);
export interface ScheduleUpdateResult {
  readonly scheduleId: string;
  readonly enabled: boolean;
  readonly nextRunAt: string | null;
}
const ScheduleUpdateResultShape = closed({
  scheduleId: Id,
  enabled: Type.Boolean(),
  nextRunAt: Type.Union([Iso, Type.Null()]),
});
export const ScheduleUpdateResultSchema: TUnsafe<ScheduleUpdateResult> =
  Type.Unsafe<ScheduleUpdateResult>(
    ScheduleUpdateResultShape satisfies SchemaProof<
      ScheduleUpdateResult,
      typeof ScheduleUpdateResultShape
    >,
  );

/** `schedule.runs`(W-07). 실행 기록 */
export interface ScheduleRunsParams {
  readonly scheduleId: string;
  readonly limit?: number;
}
const ScheduleRunsParamsShape = request({
  scheduleId: Id,
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
});
export const ScheduleRunsParamsSchema: TUnsafe<Req<ScheduleRunsParams>> = Type.Unsafe<
  Req<ScheduleRunsParams>
>(
  ScheduleRunsParamsShape satisfies SchemaProof<
    Req<ScheduleRunsParams>,
    typeof ScheduleRunsParamsShape
  >,
);
export interface ScheduleRunRecord {
  readonly runId: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly outcome: "running" | "ok" | "failed" | "skipped";
  readonly threadId: string | null;
  readonly error: string | null;
  /** 앱이 꺼진 동안 밀린 기한을 따라잡아 실행한 기록이거나, 놓쳐서 건너뛴 기록이다(`error`가 `missed`·`too_old`) */
  readonly missed: boolean;
}
export interface ScheduleRunsResult {
  readonly runs: readonly ScheduleRunRecord[];
}
const ScheduleRunsResultShape = closed({
  runs: Type.Array(
    closed({
      runId: Id,
      startedAt: Iso,
      endedAt: Type.Union([Iso, Type.Null()]),
      outcome: Type.Union([
        Type.Literal("running"),
        Type.Literal("ok"),
        Type.Literal("failed"),
        Type.Literal("skipped"),
      ]),
      threadId: Type.Union([ThreadRef, Type.Null()]),
      error: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
      missed: Type.Boolean(),
    }),
    { maxItems: 200 },
  ),
});
export const ScheduleRunsResultSchema: TUnsafe<ScheduleRunsResult> =
  Type.Unsafe<ScheduleRunsResult>(
    ScheduleRunsResultShape satisfies SchemaProof<
      ScheduleRunsResult,
      typeof ScheduleRunsResultShape
    >,
  );

/** `host.clients`(W-12). 열린 연결마다 한 행이다. 이름과 버전은 `host.hello`를 마친 연결만 싣는다 */
export interface HostClientView {
  readonly connectionId: string;
  readonly transport: "in-process" | "stdio" | "socket";
  /** `host.hello`의 `client.name`. hello 전이면 없다 */
  readonly name?: string;
  /** `host.hello`의 `client.version`. hello 전이면 없다 */
  readonly version?: string;
  /** 이 연결이 쓰기로 연 대화 수 */
  readonly writeThreads: number;
  /** 이 연결이 관찰로 연 대화 수 */
  readonly observedThreads: number;
  /** 요청을 보낸 연결 자신이면 참 */
  readonly self: boolean;
}
export interface HostClientsResult {
  readonly clients: readonly HostClientView[];
}
const HostClientsResultShape = closed({
  clients: Type.Array(
    closed({
      connectionId: Id,
      transport: Type.Union([
        Type.Literal("in-process"),
        Type.Literal("stdio"),
        Type.Literal("socket"),
      ]),
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
      version: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
      writeThreads: Count,
      observedThreads: Count,
      self: Type.Boolean(),
    }),
    { maxItems: HOST_CLIENTS_MAX },
  ),
});
export const HostClientsResultSchema: TUnsafe<HostClientsResult> = Type.Unsafe<HostClientsResult>(
  HostClientsResultShape satisfies SchemaProof<HostClientsResult, typeof HostClientsResultShape>,
);

/** `turn.withdraw`(W-17). 큐에 넣고 아직 배치되지 않은 입력을 요청 키로 거둔다 */
export interface TurnWithdrawParams {
  readonly threadId: string;
  readonly requestId: string;
}
const TurnWithdrawParamsShape = request({ threadId: ThreadRef, requestId: RequestKeySchema });
export const TurnWithdrawParamsSchema: TUnsafe<Req<TurnWithdrawParams>> = Type.Unsafe<
  Req<TurnWithdrawParams>
>(
  TurnWithdrawParamsShape satisfies SchemaProof<
    Req<TurnWithdrawParams>,
    typeof TurnWithdrawParamsShape
  >,
);
export interface TurnWithdrawResult {
  /** 거둔 입력이 있으면 참. 입력을 찾지 못했거나 이미 배치됐으면 거짓 */
  readonly withdrawn: boolean;
}
const TurnWithdrawResultShape = closed({ withdrawn: Type.Boolean() });
export const TurnWithdrawResultSchema: TUnsafe<TurnWithdrawResult> =
  Type.Unsafe<TurnWithdrawResult>(
    TurnWithdrawResultShape satisfies SchemaProof<
      TurnWithdrawResult,
      typeof TurnWithdrawResultShape
    >,
  );

/** `knowledge.skills.view`(W-14). 스킬 하나의 본문과 지원 파일 목록. `threadId`를 주면 그 대화의 작업 폴더 기준으로 프로젝트 스킬을 찾는다 */
export interface SkillViewParams {
  readonly name: string;
  readonly threadId?: string;
}
const SkillViewParamsShape = request({
  name: Id,
  threadId: Type.Optional(ThreadRef),
});
export const SkillViewParamsSchema: TUnsafe<Req<SkillViewParams>> = Type.Unsafe<
  Req<SkillViewParams>
>(SkillViewParamsShape satisfies SchemaProof<Req<SkillViewParams>, typeof SkillViewParamsShape>);
export interface SkillViewResult {
  readonly name: string;
  readonly scope: SkillScope;
  readonly description: string;
  /** SKILL.md 본문(머리말 제외). 상한을 넘으면 앞부분만 싣고 `bodyTruncated`가 참이다 */
  readonly body: string;
  readonly bodyTruncated: boolean;
  /** 지원 파일 경로(스킬 폴더 안 상대 경로) */
  readonly files: readonly string[];
  /** 스킬 폴더 내용의 해시(64자 hex). 같은 해시면 같은 내용이다 */
  readonly treeHash: string;
}
const SkillViewResultShape = closed({
  name: Id,
  scope: SkillScopeSchema,
  description: Type.String({ maxLength: 1024 }),
  body: Text,
  bodyTruncated: Type.Boolean(),
  files: Type.Array(SkillFilePathSchema, { maxItems: 500 }),
  treeHash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
});
export const SkillViewResultSchema: TUnsafe<SkillViewResult> = Type.Unsafe<SkillViewResult>(
  SkillViewResultShape satisfies SchemaProof<SkillViewResult, typeof SkillViewResultShape>,
);

/**
 * `knowledge.skills.list`(W-14b). 이 대화가 쓸 수 있는 스킬과, 색인에서 빠진 스킬의 이유(형식 오류, 폴더 신뢰 안 됨 등). `threadId`를 주면
 * 그 대화의 작업 폴더 기준이다. 슬래시 목록의 "스킬" 묶음이 읽는다 [결정: 오케스트레이터 기본값, scI]
 */
export interface SkillListParams {
  readonly threadId?: string;
}
const SkillListParamsShape = request({ threadId: Type.Optional(ThreadRef) });
export const SkillListParamsSchema: TUnsafe<Req<SkillListParams>> = Type.Unsafe<
  Req<SkillListParams>
>(SkillListParamsShape satisfies SchemaProof<Req<SkillListParams>, typeof SkillListParamsShape>);
export interface SkillListEntry {
  readonly name: string;
  /** 모델이 보는 잘린 설명 */
  readonly description: string;
  readonly scope: SkillScope;
  /** 모델이 스스로 부를 수 있는가. 거짓이면 사용자가 슬래시로만 부른다 */
  readonly modelInvocable: boolean;
}
export interface SkillListDiagnostic {
  readonly severity: "warning" | "collision";
  readonly message: string;
  readonly path: string;
}
export interface SkillListResult {
  readonly skills: readonly SkillListEntry[];
  readonly diagnostics: readonly SkillListDiagnostic[];
}
export const SKILL_LIST_MAX = 2000;
export const SKILL_DIAGNOSTICS_MAX = 200;
const SkillListResultShape = closed({
  skills: Type.Array(
    closed({
      name: Id,
      description: Type.String({ maxLength: 1024 }),
      scope: SkillScopeSchema,
      modelInvocable: Type.Boolean(),
    }),
    { maxItems: SKILL_LIST_MAX },
  ),
  diagnostics: Type.Array(
    closed({
      severity: Type.Union([Type.Literal("warning"), Type.Literal("collision")]),
      message: Type.String({ maxLength: 512 }),
      path: Type.String({ maxLength: 1024 }),
    }),
    { maxItems: SKILL_DIAGNOSTICS_MAX },
  ),
});
export const SkillListResultSchema: TUnsafe<SkillListResult> = Type.Unsafe<SkillListResult>(
  SkillListResultShape satisfies SchemaProof<SkillListResult, typeof SkillListResultShape>,
);

/** `work.plans.versions`(W-18). 계획 하나의 모든 판. 판의 모양은 `PlanVersionSchema`(capabilities/defs/work.ts)다 */
export interface PlanVersionsParams {
  readonly threadId: string;
  readonly planId: string;
}
const PlanVersionsParamsShape = request({ threadId: ThreadRef, planId: Id });
export const PlanVersionsParamsSchema: TUnsafe<Req<PlanVersionsParams>> = Type.Unsafe<
  Req<PlanVersionsParams>
>(
  PlanVersionsParamsShape satisfies SchemaProof<
    Req<PlanVersionsParams>,
    typeof PlanVersionsParamsShape
  >,
);

/** `knowledge.memory.read`(W-19). 사용자 기억과 환경 기억의 항목, 쓰기 막힘, `fileHash`. `stores`를 생략하면 둘 다 읽는다 */
export interface MemoryReadParams {
  readonly stores?: readonly MemoryStore[];
}
const MemoryReadParamsShape = request({
  stores: Type.Optional(Type.Array(MemoryStoreSchema, { minItems: 1, maxItems: 2 })),
});
export const MemoryReadParamsSchema: TUnsafe<Req<MemoryReadParams>> = Type.Unsafe<
  Req<MemoryReadParams>
>(MemoryReadParamsShape satisfies SchemaProof<Req<MemoryReadParams>, typeof MemoryReadParamsShape>);

/** `knowledge.memory.add`(W-19). 항목 하나를 더한다 */
export interface MemoryAddParams {
  readonly store: MemoryStore;
  readonly text: string;
}
const MemoryAddParamsShape = request({
  store: MemoryStoreSchema,
  text: Type.String({ minLength: 1, maxLength: 20000 }),
});
export const MemoryAddParamsSchema: TUnsafe<Req<MemoryAddParams>> = Type.Unsafe<
  Req<MemoryAddParams>
>(MemoryAddParamsShape satisfies SchemaProof<Req<MemoryAddParams>, typeof MemoryAddParamsShape>);

/** `knowledge.memory.replace`(W-19). 읽을 때 받은 `fileHash`를 `baseHash`로 보낸다. 그 사이 바깥에서 바뀌었으면 거절한다 */
export interface MemoryReplaceParams {
  readonly store: MemoryStore;
  readonly entryId: string;
  readonly text: string;
  readonly baseHash: string;
}
const MemoryReplaceParamsShape = request({
  store: MemoryStoreSchema,
  entryId: MemoryEntryIdSchema,
  text: Type.String({ minLength: 1, maxLength: 20000 }),
  baseHash: HashHexSchema,
});
export const MemoryReplaceParamsSchema: TUnsafe<Req<MemoryReplaceParams>> = Type.Unsafe<
  Req<MemoryReplaceParams>
>(
  MemoryReplaceParamsShape satisfies SchemaProof<
    Req<MemoryReplaceParams>,
    typeof MemoryReplaceParamsShape
  >,
);

/** `knowledge.memory.remove`(W-19). 항목 하나를 지운다 */
export interface MemoryRemoveParams {
  readonly store: MemoryStore;
  readonly entryId: string;
  readonly baseHash: string;
}
const MemoryRemoveParamsShape = request({
  store: MemoryStoreSchema,
  entryId: MemoryEntryIdSchema,
  baseHash: HashHexSchema,
});
export const MemoryRemoveParamsSchema: TUnsafe<Req<MemoryRemoveParams>> = Type.Unsafe<
  Req<MemoryRemoveParams>
>(
  MemoryRemoveParamsShape satisfies SchemaProof<
    Req<MemoryRemoveParams>,
    typeof MemoryRemoveParamsShape
  >,
);

type U<T> = TUnsafe<T>;
export interface DialogAreaSchemas {
  "review.get": Io<U<Req<ReviewGetParams>>, U<ReviewGetResult>>;
  "goal.status": Io<U<Req<ThreadScopedParams>>, U<GoalStatusResult>>;
  "work.tasks.list": Io<U<Req<ThreadScopedParams>>, U<WorkTasksListResult>>;
  "schedule.update": Io<U<Req<ScheduleUpdateParams>>, U<ScheduleUpdateResult>>;
  "schedule.runs": Io<U<Req<ScheduleRunsParams>>, U<ScheduleRunsResult>>;
  "host.clients": Io<U<NoParams>, U<HostClientsResult>>;
  "turn.withdraw": Io<U<Req<TurnWithdrawParams>>, U<TurnWithdrawResult>>;
  "knowledge.skills.view": Io<U<Req<SkillViewParams>>, U<SkillViewResult>>;
  "knowledge.skills.list": Io<U<Req<SkillListParams>>, U<SkillListResult>>;
  "work.plans.versions": Io<U<Req<PlanVersionsParams>>, U<PlanVersionsOutputValue>>;
  "knowledge.memory.read": Io<U<Req<MemoryReadParams>>, U<MemoryReadOutput>>;
  "knowledge.memory.add": Io<U<Req<MemoryAddParams>>, U<MemoryWriteOutput>>;
  "knowledge.memory.replace": Io<U<Req<MemoryReplaceParams>>, U<MemoryWriteOutput>>;
  "knowledge.memory.remove": Io<U<Req<MemoryRemoveParams>>, U<MemoryWriteOutput>>;
}
type Table = {
  readonly [M in keyof DialogAreaSchemas]: M4Spec<
    DialogAreaSchemas[M]["params"],
    DialogAreaSchemas[M]["result"]
  >;
};
export const DIALOG_AREA_METHODS: Table = {
  "review.get": m4(ReviewGetParamsSchema, ReviewGetResultSchema),
  "goal.status": m4(ThreadRefM4ParamsSchema, GoalStatusResultSchema),
  "work.tasks.list": m4(ThreadRefM4ParamsSchema, WorkTasksListResultSchema),
  "schedule.update": m4(ScheduleUpdateParamsSchema, ScheduleUpdateResultSchema),
  "schedule.runs": m4(ScheduleRunsParamsSchema, ScheduleRunsResultSchema),
  "host.clients": m4(NoParamsSchema, HostClientsResultSchema),
  "turn.withdraw": m4(TurnWithdrawParamsSchema, TurnWithdrawResultSchema),
  "knowledge.skills.view": m4(SkillViewParamsSchema, SkillViewResultSchema),
  "knowledge.skills.list": m4(SkillListParamsSchema, SkillListResultSchema),
  "work.plans.versions": m4(PlanVersionsParamsSchema, PlanVersionsOutput),
  "knowledge.memory.read": m4(MemoryReadParamsSchema, MemoryReadOutputSchema),
  "knowledge.memory.add": m4(MemoryAddParamsSchema, MemoryWriteOutputSchema),
  "knowledge.memory.replace": m4(MemoryReplaceParamsSchema, MemoryWriteOutputSchema),
  "knowledge.memory.remove": m4(MemoryRemoveParamsSchema, MemoryWriteOutputSchema),
};
