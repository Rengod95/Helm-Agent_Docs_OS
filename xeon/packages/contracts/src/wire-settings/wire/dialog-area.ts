import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "../../base/index.ts";
import { closed, m4, request, type Io, type M4Spec, type Req } from "./schema-kit.ts";

// F.wire-settings.spec §3.3.5(M4 대화 영역). L4.desktop-ux.spec §10.1 W-02, W-05, W-06, W-07.
// W-01(`approval.list`의 threadId 생략), W-16(`thread.read.around`, `ThreadSummary.origin`)은 methods.ts의 기존 스키마를 고쳤다.

const Id = Type.String({ minLength: 1, maxLength: 128 });
const Iso = Type.String({ minLength: 1, maxLength: 40 });
const Count = Type.Integer({ minimum: 0 });
const Text = Type.String({ maxLength: 20000 });
const ThreadRef = Type.String({ minLength: 1, maxLength: 64 });

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

type U<T> = TUnsafe<T>;
export interface DialogAreaSchemas {
  "review.get": Io<U<Req<ReviewGetParams>>, U<ReviewGetResult>>;
  "goal.status": Io<U<Req<ThreadScopedParams>>, U<GoalStatusResult>>;
  "work.tasks.list": Io<U<Req<ThreadScopedParams>>, U<WorkTasksListResult>>;
  "schedule.update": Io<U<Req<ScheduleUpdateParams>>, U<ScheduleUpdateResult>>;
  "schedule.runs": Io<U<Req<ScheduleRunsParams>>, U<ScheduleRunsResult>>;
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
};
