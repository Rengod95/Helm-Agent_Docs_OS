import { Type, type TLiteral, type TUnion, type TUnsafe } from "typebox";
import { Nullable, type SchemaProof } from "../../base/index.ts";
import { closed, request, type Req } from "./schema-kit.ts";
import {
  BacktestItemSchema,
  BacktestSummarySchema,
  SCOPE_KINDS,
  ScopeKindSchema,
  type BacktestItem,
  type BacktestSummary,
  type ScopeKind,
} from "./turn-record.ts";

// 지난 턴에 돌려 보기(M5d-2)의 메서드와 알림 params·result 스키마다. 정본은 docs/xeon/review/m5/turn-record-metrics.md §3.5, §3.7, §4.8이다.
// 항목 `BacktestItem`, 요약 `BacktestSummary`, 분류 `BACKTEST_CLASSES`와 근거 참조의 backtest 변형은 `turn-record.ts`에 있다(여기서 다시 쓰지 않는다).
// 등록은 `turn-record-methods.ts`의 `BACKTEST_WIRE_METHODS`가 한다. 처리기는 아직 없다(apps/host, 실행기는 P1 뒤).
// 저장 문자열(값, 키 이름)은 정본과 글자 하나 다르지 않게 둔다.

const ThreadRef = Type.String({ minLength: 1, maxLength: 64 });
const Id = Type.String({ minLength: 1, maxLength: 128 });
const Name = Type.String({ minLength: 1, maxLength: 96 });
const Cursor = Type.String({ minLength: 1, maxLength: 256 });
const Count = Type.Integer({ minimum: 0 });
const Ms = Type.Number({ minimum: 0 });

/** `scope.threadIds`와 `scope.turns`의 상한(개수). 한 번에 돌리는 턴 상한 `maxTurns`(기본 50)와 같은 수다 */
const SCOPE_LIST_MAX = 50;
/** `scope.lastTurns`의 상한(§3.5 표). 기본 20은 실행기가 채운다 */
const LAST_TURNS_MAX = 50;
/** `backtest.result` 한 쪽의 항목 상한. 턴 목록의 최대 쪽 크기(200)와 맞춘다 [제안] */
const RESULT_PAGE_MAX = 200;
/** `notReproducible`의 고정 문구 수. 정본 §4.8 규칙 53의 (1)~(6)이다 */
const NOT_REPRODUCIBLE_MAX = 6;

// ── 값 목록(enum) ──────────────────────────────────────────────────────

/** 돌려 볼 수 있는 훅(§4.8 규칙 44). 그 밖의 훅은 `3522 backtest.hookNotReplayable`이다 */
export const REPLAYABLE_HOOKS = ["tool.call.before", "guard.tool.before", "tool.result"] as const;
export type ReplayableHook = (typeof REPLAYABLE_HOOKS)[number];
export const ReplayableHookSchema: TUnion<TLiteral<ReplayableHook>[]> = Type.Union(
  REPLAYABLE_HOOKS.map((hook) => Type.Literal(hook)),
);

/** 돌려 보기 실행의 상태(`backtest.status`, §3.5 표). 정본 목록 그대로다 */
export const BACKTEST_RUN_STATES = ["queued", "running", "done", "cancelled", "failed"] as const;
export type BacktestRunState = (typeof BACKTEST_RUN_STATES)[number];
export const BacktestRunStateSchema: TUnion<TLiteral<BacktestRunState>[]> = Type.Union(
  BACKTEST_RUN_STATES.map((state) => Type.Literal(state)),
);

// ── backtest.run ───────────────────────────────────────────────────────

/** 후보 Hook의 플러그인과 버전. `versionId`는 초안(`draft:…`)도 된다(§4.8 규칙 54) */
export interface BacktestCandidate {
  readonly pluginId: string;
  readonly versionId: string;
}

/** 돌려 볼 범위(`backtest.run`의 `scope`). `lastTurns` 기본 20, `include` 기본 `["live"]`는 실행기가 채운다 */
export interface BacktestScope {
  readonly profileId?: string;
  readonly threadIds?: string[];
  readonly turns?: { readonly threadId: string; readonly turnId: string }[];
  readonly lastTurns?: number;
  readonly sinceMs?: number;
  readonly include?: ScopeKind[];
}
const BacktestScopeShape = closed({
  profileId: Type.Optional(Id),
  threadIds: Type.Optional(Type.Array(ThreadRef, { maxItems: SCOPE_LIST_MAX })),
  turns: Type.Optional(
    Type.Array(closed({ threadId: ThreadRef, turnId: ThreadRef }), { maxItems: SCOPE_LIST_MAX }),
  ),
  lastTurns: Type.Optional(Type.Integer({ minimum: 1, maximum: LAST_TURNS_MAX })),
  sinceMs: Type.Optional(Ms),
  include: Type.Optional(Type.Array(ScopeKindSchema, { maxItems: SCOPE_KINDS.length })),
});

/** `backtest.run` params(§3.5). 후보 하나를 범위의 기록된 호출에 돌린다. 도구는 실행하지 않는다(§4.8 규칙 46) */
export interface BacktestRunParams {
  readonly candidate: BacktestCandidate;
  readonly hook: ReplayableHook;
  readonly scope: BacktestScope;
}
const BacktestRunParamsShape = request({
  candidate: closed({ pluginId: Name, versionId: Id }),
  hook: ReplayableHookSchema,
  scope: BacktestScopeShape,
});
export const BacktestRunParamsSchema: TUnsafe<Req<BacktestRunParams>> = Type.Unsafe<
  Req<BacktestRunParams>
>(
  BacktestRunParamsShape satisfies SchemaProof<
    Req<BacktestRunParams>,
    typeof BacktestRunParamsShape
  >,
);

/** `backtest.run` 결과. 실행 id다 */
export interface BacktestRunResult {
  readonly runId: string;
}
const BacktestRunResultShape = closed({ runId: Id });
export const BacktestRunResultSchema: TUnsafe<BacktestRunResult> = Type.Unsafe<BacktestRunResult>(
  BacktestRunResultShape satisfies SchemaProof<BacktestRunResult, typeof BacktestRunResultShape>,
);

// ── backtest.status · backtest.result · backtest.cancel ───────────────

/** `backtest.status` params */
export interface BacktestStatusParams {
  readonly runId: string;
}
const BacktestStatusParamsShape = request({ runId: Id });
export const BacktestStatusParamsSchema: TUnsafe<Req<BacktestStatusParams>> = Type.Unsafe<
  Req<BacktestStatusParams>
>(
  BacktestStatusParamsShape satisfies SchemaProof<
    Req<BacktestStatusParams>,
    typeof BacktestStatusParamsShape
  >,
);

/** `backtest.status` 결과. `done`은 처리한 호출 수, `total`은 전체 호출 수다 */
export interface BacktestStatusResult {
  readonly state: BacktestRunState;
  readonly done: number;
  readonly total: number;
}
const BacktestStatusResultShape = closed({
  state: BacktestRunStateSchema,
  done: Count,
  total: Count,
});
export const BacktestStatusResultSchema: TUnsafe<BacktestStatusResult> =
  Type.Unsafe<BacktestStatusResult>(
    BacktestStatusResultShape satisfies SchemaProof<
      BacktestStatusResult,
      typeof BacktestStatusResultShape
    >,
  );

/** `backtest.result` params. `cursor`를 생략하면 첫 쪽이다 */
export interface BacktestResultParams {
  readonly runId: string;
  readonly cursor?: string;
}
const BacktestResultParamsShape = request({
  runId: Id,
  cursor: Type.Optional(Cursor),
});
export const BacktestResultParamsSchema: TUnsafe<Req<BacktestResultParams>> = Type.Unsafe<
  Req<BacktestResultParams>
>(
  BacktestResultParamsShape satisfies SchemaProof<
    Req<BacktestResultParams>,
    typeof BacktestResultParamsShape
  >,
);

/** `backtest.result` 결과. `summary`는 실행 전체의 요약이고 `items`는 이 쪽의 항목이다. `notReproducible`은 고정 문구 목록이다(§4.8 규칙 53) */
export interface BacktestResultResult {
  readonly summary: BacktestSummary;
  readonly items: BacktestItem[];
  readonly notReproducible: string[];
  readonly next: string | null;
}
const BacktestResultResultShape = closed({
  summary: BacktestSummarySchema,
  items: Type.Array(BacktestItemSchema, { maxItems: RESULT_PAGE_MAX }),
  notReproducible: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
    maxItems: NOT_REPRODUCIBLE_MAX,
  }),
  next: Nullable(Cursor),
});
export const BacktestResultResultSchema: TUnsafe<BacktestResultResult> =
  Type.Unsafe<BacktestResultResult>(
    BacktestResultResultShape satisfies SchemaProof<
      BacktestResultResult,
      typeof BacktestResultResultShape
    >,
  );

/** `backtest.cancel` params. 결과는 `{}`다(`EmptyParamsSchema`) */
export interface BacktestCancelParams {
  readonly runId: string;
}
const BacktestCancelParamsShape = request({ runId: Id });
export const BacktestCancelParamsSchema: TUnsafe<Req<BacktestCancelParams>> = Type.Unsafe<
  Req<BacktestCancelParams>
>(
  BacktestCancelParamsShape satisfies SchemaProof<
    Req<BacktestCancelParams>,
    typeof BacktestCancelParamsShape
  >,
);

// ── 알림 backtest.progress ────────────────────────────────────────────

/** 알림 `backtest.progress`(§3.5 표). 실행이 호출 `done`개를 마쳤다(전체 `total`개) */
export interface BacktestProgressParams {
  readonly runId: string;
  readonly done: number;
  readonly total: number;
}
const BacktestProgressParamsShape = closed({ runId: Id, done: Count, total: Count });
export const BacktestProgressParamsSchema: TUnsafe<BacktestProgressParams> =
  Type.Unsafe<BacktestProgressParams>(
    BacktestProgressParamsShape satisfies SchemaProof<
      BacktestProgressParams,
      typeof BacktestProgressParamsShape
    >,
  );
