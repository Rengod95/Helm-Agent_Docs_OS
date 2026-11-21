import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "../../base/index.ts";
import {
  CARD_REVIEW_STATES,
  ExtensionNameSchema,
  PLUGIN_ORIGIN_KINDS,
  PluginCardSchema,
  PluginSettingDefSchema,
  type CardReviewState,
  type PluginCard,
  type PluginOriginKind,
  type PluginSettingDef,
} from "../../extensions/index.ts";
import { EmptyParamsSchema } from "./notifications.ts";
import { PluginReviewFileResultSchema, type PluginReviewFileResult } from "./plugin-review.ts";
import { closed, m4, request, type Io, type M4Spec, type Req } from "./schema-kit.ts";

// M5c-1 플러그인 wire(docs/xeon/review/m5/profile-project-loader.md §3.4, §3.6). 이 파일은 레지스트리(methods.ts)에 등록하지 않는다.
// 등록은 통합 담당이 한다. 메서드 단계(`stage`)는 `m4()`이 "M4"를 찍는다. M5 단계 값이 `WireMethodSpec`에 생기면 바꾼다.
// 오류 이름은 3600~3649 구간(플러그인, 초안, 프로젝트)이다. 이름 목록은 작업 보고와 문서에 있다.

const Name = Type.String({ minLength: 1, maxLength: 96 });
const Id = Type.String({ minLength: 1, maxLength: 128 });
const Path = Type.String({ minLength: 1, maxLength: 4096 });
const Iso = Type.String({ minLength: 1, maxLength: 40 });
const ThreadRef = Type.String({ minLength: 1, maxLength: 64 });
const ContentHash = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const Count = Type.Integer({ minimum: 0 });
const Sha256Hex = Type.String({ pattern: "^[0-9a-f]{64}$" });

const OriginShape = Type.Union(PLUGIN_ORIGIN_KINDS.map((name) => Type.Literal(name)));
const CardReviewStateShape = Type.Union(CARD_REVIEW_STATES.map((name) => Type.Literal(name)));

/** 호출할 수 있는 항목의 종류. `plugin`은 이름으로 플러그인 전체를 얹는 입구다(§4.3.2). 스킬·명령·Drive 시작이 없는 플러그인도 일회 사용으로 얹는다 */
export const INVOCABLE_KINDS = ["skill", "command", "drive", "plugin"] as const;
export type InvocableKind = (typeof INVOCABLE_KINDS)[number];
const InvocableKindShape = Type.Union(INVOCABLE_KINDS.map((name) => Type.Literal(name)));

/** `plugin.invocables`와 `plugin.get`의 `entries` 한 줄 */
export interface InvocableEntry {
  readonly plugin: string;
  readonly entry: string;
  readonly kind: InvocableKind;
  readonly title: string;
  readonly reviewedHash: string;
}
const InvocableEntryShape = closed({
  plugin: Name,
  entry: Name,
  kind: InvocableKindShape,
  title: Type.String({ maxLength: 128 }),
  reviewedHash: ContentHash,
});
export const InvocableEntrySchema: TUnsafe<InvocableEntry> = Type.Unsafe<InvocableEntry>(
  InvocableEntryShape satisfies SchemaProof<InvocableEntry, typeof InvocableEntryShape>,
);

/**
 * 초안 하나. 같은 플러그인의 초안은 `parent`로 이어진다. 보관 상한은 플러그인마다 20개다(§4.9.2 [제안]).
 * 검토 항목이 가리키는 초안은 상한을 넘어도 지우지 않으므로 목록 상한은 여유를 둔다
 */
export interface DraftInfo {
  readonly draftId: string;
  readonly name: string;
  readonly contentHash: string;
  /** 같은 플러그인에서 바로 앞 초안. 없으면 null */
  readonly parent: string | null;
  readonly createdAt: string;
  readonly originThreadId: string | null;
  /** 사용자나 빌더가 붙인 한 줄(최대 80자) */
  readonly label: string | null;
  /** 검토함으로 보냈으면 그 항목 id */
  readonly submittedItemId: string | null;
}
const DraftInfoShape = closed({
  draftId: Id,
  name: Name,
  contentHash: ContentHash,
  parent: Type.Union([Id, Type.Null()]),
  createdAt: Iso,
  originThreadId: Type.Union([ThreadRef, Type.Null()]),
  label: Type.Union([Type.String({ maxLength: 80 }), Type.Null()]),
  submittedItemId: Type.Union([Id, Type.Null()]),
});
export const DraftInfoSchema: TUnsafe<DraftInfo> = Type.Unsafe<DraftInfo>(
  DraftInfoShape satisfies SchemaProof<DraftInfo, typeof DraftInfoShape>,
);

/** `plugin.list` 필터 */
export interface PluginListFilter {
  readonly profileId?: string;
  readonly origin?: PluginOriginKind;
  readonly reviewState?: CardReviewState;
}
const PluginListFilterShape = closed({
  profileId: Type.Optional(Id),
  origin: Type.Optional(OriginShape),
  reviewState: Type.Optional(CardReviewStateShape),
});
export interface PluginListParams {
  readonly filter?: PluginListFilter;
}
const PluginListParamsShape = request({ filter: Type.Optional(PluginListFilterShape) });
export const PluginListParamsSchema: TUnsafe<Req<PluginListParams>> = Type.Unsafe<
  Req<PluginListParams>
>(PluginListParamsShape satisfies SchemaProof<Req<PluginListParams>, typeof PluginListParamsShape>);
export interface PluginListResult {
  readonly plugins: readonly PluginCard[];
}
const PluginListResultShape = closed({ plugins: Type.Array(PluginCardSchema, { maxItems: 500 }) });
export const PluginListResultSchema: TUnsafe<PluginListResult> = Type.Unsafe<PluginListResult>(
  PluginListResultShape satisfies SchemaProof<PluginListResult, typeof PluginListResultShape>,
);

/** 플러그인 이름 하나(`plugin.get`, `plugin.revert`, `plugin.requestRemove`, `plugin.draft.list`) */
export interface PluginNameParams {
  readonly name: string;
}
const PluginNameParamsShape = request({ name: Name });
export const PluginNameParamsSchema: TUnsafe<Req<PluginNameParams>> = Type.Unsafe<
  Req<PluginNameParams>
>(PluginNameParamsShape satisfies SchemaProof<Req<PluginNameParams>, typeof PluginNameParamsShape>);

/** 검토된 버전 하나. `current`가 지금 실행되는 검토본이다 */
export interface PluginVersion {
  readonly hash: string;
  readonly approvedAt: string;
  readonly current: boolean;
}
export interface PluginGetResult {
  readonly card: PluginCard;
  readonly versions: readonly PluginVersion[];
  /** 원본 폴더. 원본 폴더가 없는 플러그인(내장 패키지 등)이면 null */
  readonly source: { readonly path: string; readonly matchesReviewed: boolean } | null;
  readonly entries: readonly InvocableEntry[];
  readonly settingsDefs: readonly PluginSettingDef[];
}
const PluginGetResultShape = closed({
  card: PluginCardSchema,
  versions: Type.Array(closed({ hash: ContentHash, approvedAt: Iso, current: Type.Boolean() }), {
    maxItems: 200,
  }),
  source: Type.Union([closed({ path: Path, matchesReviewed: Type.Boolean() }), Type.Null()]),
  entries: Type.Array(InvocableEntryShape, { maxItems: 512 }),
  settingsDefs: Type.Array(PluginSettingDefSchema, { maxItems: 256 }),
});
export const PluginGetResultSchema: TUnsafe<PluginGetResult> = Type.Unsafe<PluginGetResult>(
  PluginGetResultShape satisfies SchemaProof<PluginGetResult, typeof PluginGetResultShape>,
);

/** `plugin.invocables`: 대화가 부를 수 있는 항목(프로필 밖의 검토된 플러그인 포함) */
export interface PluginInvocablesParams {
  readonly threadId: string;
}
const PluginInvocablesParamsShape = request({ threadId: ThreadRef });
export const PluginInvocablesParamsSchema: TUnsafe<Req<PluginInvocablesParams>> = Type.Unsafe<
  Req<PluginInvocablesParams>
>(
  PluginInvocablesParamsShape satisfies SchemaProof<
    Req<PluginInvocablesParams>,
    typeof PluginInvocablesParamsShape
  >,
);
export interface PluginInvocablesResult {
  readonly entries: readonly InvocableEntry[];
}
const PluginInvocablesResultShape = closed({
  entries: Type.Array(InvocableEntryShape, { maxItems: 1024 }),
});
export const PluginInvocablesResultSchema: TUnsafe<PluginInvocablesResult> =
  Type.Unsafe<PluginInvocablesResult>(
    PluginInvocablesResultShape satisfies SchemaProof<
      PluginInvocablesResult,
      typeof PluginInvocablesResultShape
    >,
  );

/** `plugin.scan`: 원본 폴더를 다시 훑는다. 바뀐 것마다 검토 항목을 만든다 */
export interface PluginScanParams {
  readonly projectId?: string;
}
const PluginScanParamsShape = request({ projectId: Type.Optional(Id) });
export const PluginScanParamsSchema: TUnsafe<Req<PluginScanParams>> = Type.Unsafe<
  Req<PluginScanParams>
>(PluginScanParamsShape satisfies SchemaProof<Req<PluginScanParams>, typeof PluginScanParamsShape>);
export interface PluginScanResult {
  /** 새로 만든 검토 항목 id */
  readonly queued: readonly string[];
}
const PluginScanResultShape = closed({ queued: Type.Array(Id, { maxItems: 512 }) });
export const PluginScanResultSchema: TUnsafe<PluginScanResult> = Type.Unsafe<PluginScanResult>(
  PluginScanResultShape satisfies SchemaProof<PluginScanResult, typeof PluginScanResultShape>,
);

/** `plugin.revert`: 원본 폴더를 현재 검토본 내용으로 되돌린다(손 수정 되돌리기) */
export interface PluginRevertResult {
  readonly restored: true;
}
const PluginRevertResultShape = closed({ restored: Type.Literal(true) });
export const PluginRevertResultSchema: TUnsafe<PluginRevertResult> =
  Type.Unsafe<PluginRevertResult>(
    PluginRevertResultShape satisfies SchemaProof<
      PluginRevertResult,
      typeof PluginRevertResultShape
    >,
  );

/** `plugin.requestRemove`: 지우기 요청. 검토 항목(`remove`)을 만든다. `ext.remove`를 대체한다 */
export interface PluginRequestRemoveResult {
  readonly itemId: string;
}
const PluginRequestRemoveResultShape = closed({ itemId: Id });
export const PluginRequestRemoveResultSchema: TUnsafe<PluginRequestRemoveResult> =
  Type.Unsafe<PluginRequestRemoveResult>(
    PluginRequestRemoveResultShape satisfies SchemaProof<
      PluginRequestRemoveResult,
      typeof PluginRequestRemoveResultShape
    >,
  );

/** `plugin.draft.create`: 원본 폴더 하나를 초안 스냅샷으로 만든다. 검토함에는 아직 가지 않는다 */
export interface PluginDraftCreateParams {
  readonly dir: string;
  readonly originThreadId?: string;
}
const PluginDraftCreateParamsShape = request({
  dir: Path,
  originThreadId: Type.Optional(ThreadRef),
});
export const PluginDraftCreateParamsSchema: TUnsafe<Req<PluginDraftCreateParams>> = Type.Unsafe<
  Req<PluginDraftCreateParams>
>(
  PluginDraftCreateParamsShape satisfies SchemaProof<
    Req<PluginDraftCreateParams>,
    typeof PluginDraftCreateParamsShape
  >,
);
export interface PluginDraftCreateResult {
  readonly draftId: string;
  readonly contentHash: string;
  readonly card: PluginCard;
  readonly info: DraftInfo;
}
const PluginDraftCreateResultShape = closed({
  draftId: Id,
  contentHash: ContentHash,
  card: PluginCardSchema,
  info: DraftInfoShape,
});
export const PluginDraftCreateResultSchema: TUnsafe<PluginDraftCreateResult> =
  Type.Unsafe<PluginDraftCreateResult>(
    PluginDraftCreateResultShape satisfies SchemaProof<
      PluginDraftCreateResult,
      typeof PluginDraftCreateResultShape
    >,
  );

/** `plugin.draft.discard`: 초안 하나를 지운다. 검토 항목이 가리키는 초안은 지우지 않는다(§4.9.2) */
export interface PluginDraftIdParams {
  readonly draftId: string;
}
const PluginDraftIdParamsShape = request({ draftId: Id });
export const PluginDraftIdParamsSchema: TUnsafe<Req<PluginDraftIdParams>> = Type.Unsafe<
  Req<PluginDraftIdParams>
>(
  PluginDraftIdParamsShape satisfies SchemaProof<
    Req<PluginDraftIdParams>,
    typeof PluginDraftIdParamsShape
  >,
);
/** `plugin.draft.files`의 한 줄. `ReviewFileEntry`와 같은 모양이다 */
export interface DraftFileEntry {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}
const DraftFileShape = closed({ path: Path, bytes: Count, sha256: Sha256Hex });

/**
 * `plugin.draft.files`(읽기 전용): 초안 한 버전의 파일 목록. 초안은 `drafts/<draftId>/tree`에 그대로 남아 있으므로(플러그인마다 최근 20개와
 * 검토 항목이 가리키는 초안) 보관된 초안이면 언제든 읽는다. 지워진 초안은 `draft.notFound`(3616)다. 이 길은 읽기만 하고 초안을 싣거나 실행하지 않는다.
 * 두 버전의 바뀐 파일은 호출자가 두 목록의 `sha256`을 견줘 가른다(추가, 삭제, 변경) [제안]
 */
export interface PluginDraftFilesResult {
  readonly draftId: string;
  readonly name: string;
  readonly contentHash: string;
  /** 경로순. 해시에 들어가는 파일만이다(`.git` 따위는 없다) */
  readonly files: readonly DraftFileEntry[];
}
const PluginDraftFilesResultShape = closed({
  draftId: Id,
  name: Name,
  contentHash: ContentHash,
  files: Type.Array(DraftFileShape, { maxItems: 2000 }),
});
export const PluginDraftFilesResultSchema: TUnsafe<PluginDraftFilesResult> =
  Type.Unsafe<PluginDraftFilesResult>(
    PluginDraftFilesResultShape satisfies SchemaProof<
      PluginDraftFilesResult,
      typeof PluginDraftFilesResultShape
    >,
  );

/**
 * `plugin.draft.file`(읽기 전용): 초안 한 버전의 파일 하나. `path`는 `plugin.draft.files`에 있어야 하고, 없으면(상위 이동, 절대 경로, 심볼릭 링크 포함)
 * `pluginReview.pathInvalid`(3653)다. 본문 규칙은 `pluginReview.file`과 같다: 텍스트가 아니면 `text`가 null, 256 KiB를 넘으면 앞부분만 싣고 `truncated`다.
 * `missing`은 쓰지 않는다
 */
export interface PluginDraftFileParams {
  readonly draftId: string;
  readonly path: string;
}
const PluginDraftFileParamsShape = request({ draftId: Id, path: Path });
export const PluginDraftFileParamsSchema: TUnsafe<Req<PluginDraftFileParams>> = Type.Unsafe<
  Req<PluginDraftFileParams>
>(
  PluginDraftFileParamsShape satisfies SchemaProof<
    Req<PluginDraftFileParams>,
    typeof PluginDraftFileParamsShape
  >,
);
export type PluginDraftFileResult = PluginReviewFileResult;

/** `plugin.draft.list`: 최신 먼저 */
export interface PluginDraftListResult {
  readonly drafts: readonly DraftInfo[];
}
const PluginDraftListResultShape = closed({
  drafts: Type.Array(DraftInfoShape, { maxItems: 256 }),
});
export const PluginDraftListResultSchema: TUnsafe<PluginDraftListResult> =
  Type.Unsafe<PluginDraftListResult>(
    PluginDraftListResultShape satisfies SchemaProof<
      PluginDraftListResult,
      typeof PluginDraftListResultShape
    >,
  );

/**
 * `plugin.draft.fromInstruction`(§4.10): 사용자의 한 줄 지침으로 지침만 든 플러그인 초안을 만들고 검토 항목(`user_instruction`)을 만든다.
 * `name`을 안 주면 앱이 `instr-<내용 해시 앞 6자>`를 정한다
 */
export interface PluginDraftFromInstructionParams {
  readonly text: string;
  readonly name?: string;
  readonly profileId?: string;
}
const PluginDraftFromInstructionParamsShape = request({
  text: Type.String({ minLength: 1, maxLength: 2000 }),
  /** 폴더 이름이 되므로 확장 이름 문법을 따른다 */
  name: Type.Optional(ExtensionNameSchema),
  profileId: Type.Optional(Id),
});
export const PluginDraftFromInstructionParamsSchema: TUnsafe<
  Req<PluginDraftFromInstructionParams>
> = Type.Unsafe<Req<PluginDraftFromInstructionParams>>(
  PluginDraftFromInstructionParamsShape satisfies SchemaProof<
    Req<PluginDraftFromInstructionParams>,
    typeof PluginDraftFromInstructionParamsShape
  >,
);
export interface PluginDraftFromInstructionResult {
  readonly draftId: string;
  readonly itemId: string;
}
const PluginDraftFromInstructionResultShape = closed({ draftId: Id, itemId: Id });
export const PluginDraftFromInstructionResultSchema: TUnsafe<PluginDraftFromInstructionResult> =
  Type.Unsafe<PluginDraftFromInstructionResult>(
    PluginDraftFromInstructionResultShape satisfies SchemaProof<
      PluginDraftFromInstructionResult,
      typeof PluginDraftFromInstructionResultShape
    >,
  );

/** 알림 `plugin.changed`: 플러그인의 카드나 상태가 바뀌었다. 목록을 다시 읽는다 */
export interface PluginChangedParams {
  readonly name: string;
}
const PluginChangedParamsShape = closed({ name: Name });
export const PluginChangedParamsSchema: TUnsafe<PluginChangedParams> =
  Type.Unsafe<PluginChangedParams>(
    PluginChangedParamsShape satisfies SchemaProof<
      PluginChangedParams,
      typeof PluginChangedParamsShape
    >,
  );

type U<T> = TUnsafe<T>;
export interface PluginWireSchemas {
  "plugin.list": Io<U<Req<PluginListParams>>, U<PluginListResult>>;
  "plugin.get": Io<U<Req<PluginNameParams>>, U<PluginGetResult>>;
  "plugin.invocables": Io<U<Req<PluginInvocablesParams>>, U<PluginInvocablesResult>>;
  "plugin.scan": Io<U<Req<PluginScanParams>>, U<PluginScanResult>>;
  "plugin.revert": Io<U<Req<PluginNameParams>>, U<PluginRevertResult>>;
  "plugin.requestRemove": Io<U<Req<PluginNameParams>>, U<PluginRequestRemoveResult>>;
  "plugin.draft.create": Io<U<Req<PluginDraftCreateParams>>, U<PluginDraftCreateResult>>;
  /** 빈 결과(`{}`). methods.ts의 `EmptyResultSchema`와 같은 스키마다 */
  "plugin.draft.discard": Io<U<Req<PluginDraftIdParams>>, typeof EmptyParamsSchema>;
  "plugin.draft.list": Io<U<Req<PluginNameParams>>, U<PluginDraftListResult>>;
  "plugin.draft.files": Io<U<Req<PluginDraftIdParams>>, U<PluginDraftFilesResult>>;
  "plugin.draft.file": Io<U<Req<PluginDraftFileParams>>, U<PluginDraftFileResult>>;
  "plugin.draft.fromInstruction": Io<
    U<Req<PluginDraftFromInstructionParams>>,
    U<PluginDraftFromInstructionResult>
  >;
}
type Table = {
  readonly [M in keyof PluginWireSchemas]: M4Spec<
    PluginWireSchemas[M]["params"],
    PluginWireSchemas[M]["result"]
  >;
};
export const PLUGIN_WIRE_METHODS: Table = {
  "plugin.list": m4(PluginListParamsSchema, PluginListResultSchema),
  "plugin.get": m4(PluginNameParamsSchema, PluginGetResultSchema),
  "plugin.invocables": m4(PluginInvocablesParamsSchema, PluginInvocablesResultSchema),
  "plugin.scan": m4(PluginScanParamsSchema, PluginScanResultSchema),
  "plugin.revert": m4(PluginNameParamsSchema, PluginRevertResultSchema),
  "plugin.requestRemove": m4(PluginNameParamsSchema, PluginRequestRemoveResultSchema),
  "plugin.draft.create": m4(PluginDraftCreateParamsSchema, PluginDraftCreateResultSchema),
  "plugin.draft.discard": m4(PluginDraftIdParamsSchema, EmptyParamsSchema),
  "plugin.draft.list": m4(PluginNameParamsSchema, PluginDraftListResultSchema),
  "plugin.draft.files": m4(PluginDraftIdParamsSchema, PluginDraftFilesResultSchema),
  "plugin.draft.file": m4(PluginDraftFileParamsSchema, PluginReviewFileResultSchema),
  "plugin.draft.fromInstruction": m4(
    PluginDraftFromInstructionParamsSchema,
    PluginDraftFromInstructionResultSchema,
  ),
};
