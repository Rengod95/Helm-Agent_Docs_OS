import { Type, type TUnsafe } from "typebox";
import type { SchemaProof, SchemaSound } from "../../base/index.ts";
import {
  EvidenceRefSchema,
  PLUGIN_ENFORCEMENTS,
  PluginCardSchema,
  type EvidenceRef,
  type PluginCard,
  type PluginEnforcement,
} from "../../extensions/index.ts";
import { closed, m4, request, type Io, type M4Spec, type Req } from "./schema-kit.ts";

// M5c-1 검토 wire(docs/xeon/review/m5/profile-project-loader.md §3.1, §3.4, §3.6, §4.7). 이 파일은 레지스트리(methods.ts)에 등록하지 않는다.
// 이름 공간은 `pluginReview.*`다. 기존 `review.get`(dialog-area.ts)과 겹치지 않으려고 접두를 따로 뒀다.
// 오류 이름은 3650~3669 구간이다(pluginReview.notFound, notPending, pathInvalid, handEditNotAllowed, purposeRequired, profileInvalid).

const Name = Type.String({ minLength: 1, maxLength: 96 });
const Id = Type.String({ minLength: 1, maxLength: 128 });
const Path = Type.String({ minLength: 1, maxLength: 4096 });
const Iso = Type.String({ minLength: 1, maxLength: 40 });
const Count = Type.Integer({ minimum: 0 });
const ContentHash = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const Sha256Hex = Type.String({ pattern: "^[0-9a-f]{64}$" });

export const REVIEW_KINDS = ["new", "update", "remove"] as const;
/** 검토 항목 종류. `new` 처음 보는 플러그인, `update` 같은 플러그인의 새 내용, `remove` 지우기 */
export type ReviewKind = (typeof REVIEW_KINDS)[number];
const ReviewKindShape = Type.Union(REVIEW_KINDS.map((name) => Type.Literal(name)));

export const REVIEW_STATES = [
  "pending",
  "approved",
  "sent_back",
  "discarded",
  "superseded",
  "withdrawn",
] as const;
/** 항목 상태. `pending → approved | sent_back | discarded | superseded | withdrawn`. 닫힌 항목은 다시 열지 않는다(§4.7.7) */
export type ReviewState = (typeof REVIEW_STATES)[number];
const ReviewStateShape = Type.Union(REVIEW_STATES.map((name) => Type.Literal(name)));

export const PROVENANCES = [
  "assistant",
  "project",
  "unknown",
  "bundled",
  "user_instruction",
] as const;
/**
 * 출처. `unknown`은 손으로 고친 것으로 보이는 변경(승인 불가, §4.7.4). `user_instruction`은 사용자가 "지침 추가"로 쓴 한 줄(§4.10)이라 승인할 수 있다
 */
export type Provenance = (typeof PROVENANCES)[number];
const ProvenanceShape = Type.Union(PROVENANCES.map((name) => Type.Literal(name)));

export const DIFF_ROWS = ["inject", "hook", "drive", "runs", "setting", "replaces"] as const;
/** "하는 일의 차이"의 칸. 카드의 칸과 같은 이름이다 */
export type DiffRow = (typeof DIFF_ROWS)[number];
const DiffRowShape = Type.Union(DIFF_ROWS.map((name) => Type.Literal(name)));

/** 차이 한 줄. 칸과 무엇이 바뀌었는지를 적는다 */
export interface DiffEntry {
  readonly row: DiffRow;
  readonly what: string;
  readonly detail?: string;
}
const DiffEntryShape = closed({
  row: DiffRowShape,
  what: Type.String({ minLength: 1, maxLength: 256 }),
  detail: Type.Optional(Type.String({ maxLength: 1024 })),
});
export const DiffEntrySchema: TUnsafe<DiffEntry> = Type.Unsafe<DiffEntry>(
  DiffEntryShape satisfies SchemaProof<DiffEntry, typeof DiffEntryShape>,
);

/**
 * "하는 일의 차이". 이전 검토본 카드와 후보 카드를 칸마다 비교한다. `new`면 전부 `added`다.
 * `costDelta`는 음수가 될 수 있다(줄어든 비용)
 */
export interface WhatItDoesDiff {
  readonly added: readonly DiffEntry[];
  readonly removed: readonly DiffEntry[];
  readonly changed: readonly DiffEntry[];
  readonly enforcementChange: {
    readonly from: PluginEnforcement;
    readonly to: PluginEnforcement;
  } | null;
  readonly costDelta: { readonly always: number | null; readonly onDemand: number | null };
}
const EnforcementShape = Type.Union(PLUGIN_ENFORCEMENTS.map((name) => Type.Literal(name)));
const WhatItDoesDiffShape = closed({
  added: Type.Array(DiffEntryShape, { maxItems: 512 }),
  removed: Type.Array(DiffEntryShape, { maxItems: 512 }),
  changed: Type.Array(DiffEntryShape, { maxItems: 512 }),
  enforcementChange: Type.Union([
    closed({ from: EnforcementShape, to: EnforcementShape }),
    Type.Null(),
  ]),
  costDelta: closed({
    always: Type.Union([Type.Number(), Type.Null()]),
    onDemand: Type.Union([Type.Number(), Type.Null()]),
  }),
});
export const WhatItDoesDiffSchema: TUnsafe<WhatItDoesDiff> = Type.Unsafe<WhatItDoesDiff>(
  WhatItDoesDiffShape satisfies SchemaProof<WhatItDoesDiff, typeof WhatItDoesDiffShape>,
);

/**
 * 제거 항목의 미리 보기(`kind: "remove"`일 때만). 영향받는 프로필과 같이 지워지는 상태·기록을 항목에 싣는다.
 * 공통 묶음은 프로필 id `"common"`이다
 */
export interface ReviewItemRemoval {
  readonly affectedProfiles: readonly { readonly profileId: string; readonly title: string }[];
  /** `records`는 턴 기록 수이고 모르면 null */
  readonly removes: { readonly state: boolean; readonly records: number | null };
  readonly baseCard: PluginCard;
}
const ReviewItemRemovalShape = closed({
  affectedProfiles: Type.Array(closed({ profileId: Id, title: Type.String({ maxLength: 128 }) }), {
    maxItems: 256,
  }),
  removes: closed({
    state: Type.Boolean(),
    records: Type.Union([Count, Type.Null()]),
  }),
  baseCard: PluginCardSchema,
});
export const ReviewItemRemovalSchema: TUnsafe<ReviewItemRemoval> = Type.Unsafe<ReviewItemRemoval>(
  ReviewItemRemovalShape satisfies SchemaProof<ReviewItemRemoval, typeof ReviewItemRemovalShape>,
);

/** 검토 항목 파일 하나의 요약. 해시는 내용 해시(`sha256:<hex>`)가 아니라 파일 내용의 sha256 16진이다 */
const ReviewFileShape = closed({ path: Path, bytes: Count, sha256: Sha256Hex });

/**
 * 검토함의 한 줄. `card`는 후보 기준이고 `baseHash`가 가리키는 현재 검토본과의 차이는 `diff`에 있다.
 * 스펙은 `pluginReview.list`가 `files`와 `card`를 요약한다고 적지만(§3.4) 요약 방법은 정하지 않았다. [미결] 지금은 목록도 같은 스키마다
 */
export interface ReviewItem {
  readonly itemId: string;
  readonly kind: ReviewKind;
  readonly state: ReviewState;
  readonly name: string;
  /** 제거면 null */
  readonly candidateHash: string | null;
  /** 비교 대상인 현재 검토본. 새 플러그인이면 null */
  readonly baseHash: string | null;
  readonly provenance: Provenance;
  /** 만든 대화. 돌려보내기 사유를 받는 곳이다 */
  readonly originThreadId: string | null;
  /** 승인할 때 기본 대상 프로필 */
  readonly originProfileId: string | null;
  readonly card: PluginCard;
  readonly diff: WhatItDoesDiff;
  readonly evidence: readonly EvidenceRef[];
  readonly files: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
  }[];
  readonly createdAt: string;
  readonly decidedAt: string | null;
  /** 돌려보내기 사유(1~2000자) */
  readonly reason: string | null;
  /** `kind`가 `remove`일 때만 있다. 그 밖에는 null */
  readonly removal: ReviewItemRemoval | null;
}
const ReviewItemShape = closed({
  itemId: Id,
  kind: ReviewKindShape,
  state: ReviewStateShape,
  name: Name,
  candidateHash: Type.Union([ContentHash, Type.Null()]),
  baseHash: Type.Union([ContentHash, Type.Null()]),
  provenance: ProvenanceShape,
  originThreadId: Type.Union([Id, Type.Null()]),
  originProfileId: Type.Union([Id, Type.Null()]),
  card: PluginCardSchema,
  diff: WhatItDoesDiffSchema,
  evidence: Type.Array(EvidenceRefSchema, { maxItems: 500 }),
  files: Type.Array(ReviewFileShape, { maxItems: 2000 }),
  createdAt: Iso,
  decidedAt: Type.Union([Iso, Type.Null()]),
  reason: Type.Union([Type.String({ minLength: 1, maxLength: 2000 }), Type.Null()]),
  removal: Type.Union([ReviewItemRemovalSchema, Type.Null()]),
});
export const ReviewItemSchema: TUnsafe<ReviewItem> = Type.Unsafe<ReviewItem>(
  ReviewItemShape satisfies SchemaProof<ReviewItem, typeof ReviewItemShape>,
);

/**
 * 결정. `approve`의 `profileIds`가 비어 있으면 `update` 항목은 이름으로 든 프로필 모두에 새 검토본이 적용된다(§4.7.3 [제안: 미결 4]).
 * `purpose`는 목적 문장이 비었을 때 승인하면서 채운다(§4.7.6). 해시에 영향이 없다
 */
export type ReviewDecision =
  | {
      readonly kind: "approve";
      readonly profileIds: readonly string[];
      readonly libraryOnly: boolean;
      readonly purpose?: string;
    }
  | { readonly kind: "sendBack"; readonly reason: string }
  | { readonly kind: "discard" };
const ReviewDecisionShape = Type.Union([
  closed({
    kind: Type.Literal("approve"),
    profileIds: Type.Array(Id, { maxItems: 128 }),
    libraryOnly: Type.Boolean(),
    purpose: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  }),
  closed({
    kind: Type.Literal("sendBack"),
    reason: Type.String({ minLength: 1, maxLength: 2000 }),
  }),
  closed({ kind: Type.Literal("discard") }),
]);
export const ReviewDecisionSchema: TUnsafe<ReviewDecision> = Type.Unsafe<ReviewDecision>(
  ReviewDecisionShape satisfies SchemaSound<ReviewDecision, typeof ReviewDecisionShape>,
);

// ── 메서드 ──────────────────────────────────────────────────────────────

export interface PluginReviewListParams {
  readonly state?: ReviewState;
  readonly name?: string;
}
const PluginReviewListParamsShape = request({
  state: Type.Optional(ReviewStateShape),
  name: Type.Optional(Name),
});
export const PluginReviewListParamsSchema: TUnsafe<Req<PluginReviewListParams>> = Type.Unsafe<
  Req<PluginReviewListParams>
>(
  PluginReviewListParamsShape satisfies SchemaProof<
    Req<PluginReviewListParams>,
    typeof PluginReviewListParamsShape
  >,
);
export interface PluginReviewListResult {
  readonly items: readonly ReviewItem[];
}
const PluginReviewListResultShape = closed({
  items: Type.Array(ReviewItemShape, { maxItems: 500 }),
});
export const PluginReviewListResultSchema: TUnsafe<PluginReviewListResult> =
  Type.Unsafe<PluginReviewListResult>(
    PluginReviewListResultShape satisfies SchemaProof<
      PluginReviewListResult,
      typeof PluginReviewListResultShape
    >,
  );

export interface PluginReviewItemParams {
  readonly itemId: string;
}
const PluginReviewItemParamsShape = request({ itemId: Id });
export const PluginReviewItemParamsSchema: TUnsafe<Req<PluginReviewItemParams>> = Type.Unsafe<
  Req<PluginReviewItemParams>
>(
  PluginReviewItemParamsShape satisfies SchemaProof<
    Req<PluginReviewItemParams>,
    typeof PluginReviewItemParamsShape
  >,
);
export interface PluginReviewGetResult {
  readonly item: ReviewItem;
}
const PluginReviewGetResultShape = closed({ item: ReviewItemShape });
export const PluginReviewGetResultSchema: TUnsafe<PluginReviewGetResult> =
  Type.Unsafe<PluginReviewGetResult>(
    PluginReviewGetResultShape satisfies SchemaProof<
      PluginReviewGetResult,
      typeof PluginReviewGetResultShape
    >,
  );

/** 후보 스냅샷의 파일 하나. 본문은 `truncated`가 참이면 잘린 것이고 텍스트가 아니면 null이다 */
export interface PluginReviewFileParams {
  readonly itemId: string;
  readonly path: string;
}
const PluginReviewFileParamsShape = request({ itemId: Id, path: Path });
export const PluginReviewFileParamsSchema: TUnsafe<Req<PluginReviewFileParams>> = Type.Unsafe<
  Req<PluginReviewFileParams>
>(
  PluginReviewFileParamsShape satisfies SchemaProof<
    Req<PluginReviewFileParams>,
    typeof PluginReviewFileParamsShape
  >,
);
export interface PluginReviewFileResult {
  readonly path: string;
  readonly text: string | null;
  readonly truncated: boolean;
}
const PluginReviewFileResultShape = closed({
  path: Path,
  text: Type.Union([Type.String({ maxLength: 262144 }), Type.Null()]),
  truncated: Type.Boolean(),
});
export const PluginReviewFileResultSchema: TUnsafe<PluginReviewFileResult> =
  Type.Unsafe<PluginReviewFileResult>(
    PluginReviewFileResultShape satisfies SchemaProof<
      PluginReviewFileResult,
      typeof PluginReviewFileResultShape
    >,
  );

export interface PluginReviewSubmitDraftParams {
  readonly draftId: string;
}
const PluginReviewSubmitDraftParamsShape = request({ draftId: Id });
export const PluginReviewSubmitDraftParamsSchema: TUnsafe<Req<PluginReviewSubmitDraftParams>> =
  Type.Unsafe<Req<PluginReviewSubmitDraftParams>>(
    PluginReviewSubmitDraftParamsShape satisfies SchemaProof<
      Req<PluginReviewSubmitDraftParams>,
      typeof PluginReviewSubmitDraftParamsShape
    >,
  );
export interface PluginReviewSubmitDraftResult {
  readonly itemId: string;
}
const PluginReviewSubmitDraftResultShape = closed({ itemId: Id });
export const PluginReviewSubmitDraftResultSchema: TUnsafe<PluginReviewSubmitDraftResult> =
  Type.Unsafe<PluginReviewSubmitDraftResult>(
    PluginReviewSubmitDraftResultShape satisfies SchemaProof<
      PluginReviewSubmitDraftResult,
      typeof PluginReviewSubmitDraftResultShape
    >,
  );

export interface PluginReviewDecideParams {
  readonly itemId: string;
  readonly decision: ReviewDecision;
}
const PluginReviewDecideParamsShape = request({ itemId: Id, decision: ReviewDecisionShape });
export const PluginReviewDecideParamsSchema: TUnsafe<Req<PluginReviewDecideParams>> = Type.Unsafe<
  Req<PluginReviewDecideParams>
>(
  PluginReviewDecideParamsShape satisfies SchemaProof<
    Req<PluginReviewDecideParams>,
    typeof PluginReviewDecideParamsShape
  >,
);
export interface PluginReviewDecideResult {
  readonly item: ReviewItem;
  /** 적용된 프로필 id */
  readonly appliedTo: readonly string[];
}
const PluginReviewDecideResultShape = closed({
  item: ReviewItemShape,
  appliedTo: Type.Array(Id, { maxItems: 128 }),
});
export const PluginReviewDecideResultSchema: TUnsafe<PluginReviewDecideResult> =
  Type.Unsafe<PluginReviewDecideResult>(
    PluginReviewDecideResultShape satisfies SchemaProof<
      PluginReviewDecideResult,
      typeof PluginReviewDecideResultShape
    >,
  );

/** 알림 `pluginReview.changed`: 항목의 상태가 바뀌었다. 항목을 다시 읽는다 */
export interface PluginReviewChangedParams {
  readonly itemId: string;
  readonly state: ReviewState;
}
const PluginReviewChangedParamsShape = closed({ itemId: Id, state: ReviewStateShape });
export const PluginReviewChangedParamsSchema: TUnsafe<PluginReviewChangedParams> =
  Type.Unsafe<PluginReviewChangedParams>(
    PluginReviewChangedParamsShape satisfies SchemaProof<
      PluginReviewChangedParams,
      typeof PluginReviewChangedParamsShape
    >,
  );

type U<T> = TUnsafe<T>;
export interface PluginReviewWireSchemas {
  "pluginReview.list": Io<U<Req<PluginReviewListParams>>, U<PluginReviewListResult>>;
  "pluginReview.get": Io<U<Req<PluginReviewItemParams>>, U<PluginReviewGetResult>>;
  "pluginReview.file": Io<U<Req<PluginReviewFileParams>>, U<PluginReviewFileResult>>;
  "pluginReview.submitDraft": Io<
    U<Req<PluginReviewSubmitDraftParams>>,
    U<PluginReviewSubmitDraftResult>
  >;
  "pluginReview.decide": Io<U<Req<PluginReviewDecideParams>>, U<PluginReviewDecideResult>>;
}
type Table = {
  readonly [M in keyof PluginReviewWireSchemas]: M4Spec<
    PluginReviewWireSchemas[M]["params"],
    PluginReviewWireSchemas[M]["result"]
  >;
};
export const PLUGIN_REVIEW_WIRE_METHODS: Table = {
  "pluginReview.list": m4(PluginReviewListParamsSchema, PluginReviewListResultSchema),
  "pluginReview.get": m4(PluginReviewItemParamsSchema, PluginReviewGetResultSchema),
  "pluginReview.file": m4(PluginReviewFileParamsSchema, PluginReviewFileResultSchema),
  "pluginReview.submitDraft": m4(
    PluginReviewSubmitDraftParamsSchema,
    PluginReviewSubmitDraftResultSchema,
  ),
  "pluginReview.decide": m4(PluginReviewDecideParamsSchema, PluginReviewDecideResultSchema),
};
