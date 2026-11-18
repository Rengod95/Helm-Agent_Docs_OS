import { Type, type TString, type TUnsafe } from "typebox";
import { Nullable, type SchemaProof, type SchemaSound } from "../../base/index.ts";
import {
  EventIdSchema,
  ItemIdSchema,
  type EventId,
  type ItemId,
} from "../../conversation/index.ts";
import { BlobRefSchema, type BlobRef } from "../blob.ts";
import type { CatalogEntry } from "./entry.ts";

// F.records.spec §3.3.3(파일 되감기, 영역 `workspace`). 소유 생산자 cap.workspace는 owners.ts가 정한다. 모두 내구, 버전 1이다.
// 파일 원본은 blob(BlobRef)에 두고, 이벤트는 경로·해시·크기·모드만 싣는다. 파일 내용은 어떤 payload에도 넣지 않는다.
// 정적 타입은 스키마와 맞춘다(SchemaProof, SchemaSound). 경계 밖에서 온 값은 parse로 검증한다.

export type RewindId = string;
/** `rwd_` 뒤에 소문자 영숫자 8~64자. cap-workspace가 되감기 시작 때 만든다 */
export const RewindIdSchema: TString = Type.String({ pattern: "^rwd_[a-z0-9]{8,64}$" });

const PathShape = Type.String({ minLength: 1, maxLength: 4096 });
const Sha256Shape = Type.String({ pattern: "^[0-9a-f]{64}$", minLength: 64, maxLength: 64 });
const ReasonShape = Nullable(Type.String({ minLength: 1, maxLength: 200 }));

export type RewindScope = "both" | "files" | "conversation";
const RewindScopeShape = Type.Union([
  Type.Literal("both"),
  Type.Literal("files"),
  Type.Literal("conversation"),
]);
export const RewindScopeSchema: TUnsafe<RewindScope> = Type.Unsafe<RewindScope>(
  RewindScopeShape satisfies SchemaSound<RewindScope, typeof RewindScopeShape>,
);

export type UnrestorableReason = "too_large" | "quota" | "unreadable";
const UnrestorableReasonShape = Type.Union([
  Type.Literal("too_large"),
  Type.Literal("quota"),
  Type.Literal("unreadable"),
]);
export const UnrestorableReasonSchema: TUnsafe<UnrestorableReason> =
  Type.Unsafe<UnrestorableReason>(
    UnrestorableReasonShape satisfies SchemaSound<
      UnrestorableReason,
      typeof UnrestorableReasonShape
    >,
  );

/** 파일의 옛 상태. absent는 그 시점에 파일이 없었다는 뜻이다 */
export type FileBefore =
  | { state: "absent" }
  | { state: "saved"; blob: BlobRef; mode: number | null }
  | { state: "unrestorable"; reason: UnrestorableReason; size: number | null };

const absentShape = Type.Object({ state: Type.Literal("absent") }, { additionalProperties: false });
const savedShape = Type.Object(
  {
    state: Type.Literal("saved"),
    blob: BlobRefSchema,
    /** 파일 권한 비트(0~4095). 없으면 null */
    mode: Nullable(Type.Integer({ minimum: 0, maximum: 4095 })),
  },
  { additionalProperties: false },
);
const unrestorableShape = Type.Object(
  {
    state: Type.Literal("unrestorable"),
    reason: UnrestorableReasonShape,
    size: Nullable(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
const fileBeforeShape = Type.Union([absentShape, savedShape, unrestorableShape]);
export const FileBeforeSchema: TUnsafe<FileBefore> = Type.Unsafe<FileBefore>(
  fileBeforeShape satisfies SchemaSound<FileBefore, typeof fileBeforeShape>,
);

/** 되감기 계획에서 파일에 할 일: 옛 내용 쓰기, 없던 파일 지우기 */
export type RewindFileAction = "restore" | "delete";

/** 되감기 시작 때 정한 파일별 계획의 결과 */
export type RewindPlanOutcome = "planned" | "kept_changed" | "skipped" | "unrestorable";

/** 파일 쓰기·지우기의 결과. 시작·적용·되돌리기·덮어쓰기 이벤트가 같은 모양을 쓴다 */
export type RewindFileOutcome =
  | "restored"
  | "deleted"
  | "already_original"
  | "kept_changed"
  | "skipped"
  | "failed";
export interface RewindFileResult {
  path: string;
  outcome: RewindFileOutcome;
  reason: string | null;
}

/** 되돌리기 뒤 대화 쪽 상태. 파일 되돌리기 결과와 따로 적는다 */
export type RewindUndoState = "restored" | "not_included" | "moved_on";
const RewindUndoStateShape = Type.Union([
  Type.Literal("restored"),
  Type.Literal("not_included"),
  Type.Literal("moved_on"),
]);
export const RewindUndoStateSchema: TUnsafe<RewindUndoState> = Type.Unsafe<RewindUndoState>(
  RewindUndoStateShape satisfies SchemaSound<RewindUndoState, typeof RewindUndoStateShape>,
);

const fileOutcomeShape = Type.Union([
  Type.Literal("restored"),
  Type.Literal("deleted"),
  Type.Literal("already_original"),
  Type.Literal("kept_changed"),
  Type.Literal("skipped"),
  Type.Literal("failed"),
]);
const fileResultShape = Type.Object(
  { path: PathShape, outcome: fileOutcomeShape, reason: ReasonShape },
  { additionalProperties: false },
);
export const RewindFileResultSchema: TUnsafe<RewindFileResult> = Type.Unsafe<RewindFileResult>(
  fileResultShape satisfies SchemaProof<RewindFileResult, typeof fileResultShape>,
);

// ── workspace.files_captured ─────────────────────────────────────────────

/** 한 도구 호출이 한 경로를 만졌다. 그 턴에서 그 경로의 첫 쓰기면 first이고 before가 있다 */
export type WorkspaceCapturedEntry =
  | { path: string; first: true; before: FileBefore; afterSha256: string }
  | { path: string; first: false; before: null; afterSha256: string };

export interface WorkspaceFilesCapturedPayload {
  toolCallId: string | null;
  entries: WorkspaceCapturedEntry[];
}

const capturedFirstShape = Type.Object(
  {
    path: PathShape,
    first: Type.Literal(true),
    before: fileBeforeShape,
    afterSha256: Sha256Shape,
  },
  { additionalProperties: false },
);
const capturedLaterShape = Type.Object(
  {
    path: PathShape,
    first: Type.Literal(false),
    before: Type.Null(),
    afterSha256: Sha256Shape,
  },
  { additionalProperties: false },
);
const filesCapturedShape = Type.Object(
  {
    toolCallId: Nullable(Type.String({ minLength: 1, maxLength: 256 })),
    entries: Type.Array(Type.Union([capturedFirstShape, capturedLaterShape]), {
      minItems: 1,
      maxItems: 1024,
    }),
  },
  { additionalProperties: false },
);
export const WorkspaceFilesCapturedPayloadSchema: TUnsafe<WorkspaceFilesCapturedPayload> =
  Type.Unsafe<WorkspaceFilesCapturedPayload>(
    filesCapturedShape satisfies SchemaProof<
      WorkspaceFilesCapturedPayload,
      typeof filesCapturedShape
    >,
  );

// ── workspace.rewind_started ─────────────────────────────────────────────

/** 되감기 계획의 한 줄. 파일에 손대기 전에 기록한다 */
export interface WorkspaceRewindEntry {
  path: string;
  action: RewindFileAction;
  /** 에이전트가 마지막으로 쓴 내용의 해시. 삭제 전 확인에 쓴다. null이면 파일이 없어야 한다 */
  expectedSha256: string | null;
  /** 돌아갈 상태 */
  targetBefore: FileBefore;
  /** 되감기 직전 현재 상태를 저장한 것. 되돌리기에 쓴다 */
  undoBefore: FileBefore;
  outcome: RewindPlanOutcome;
  reason: string | null;
}

export interface WorkspaceRewindStartedPayload {
  rewindId: RewindId;
  scope: RewindScope;
  targetItemId: ItemId;
  targetEventId: EventId;
  oldLeafEventId: EventId | null;
  entries: WorkspaceRewindEntry[];
}

const RewindPlanOutcomeShape = Type.Union([
  Type.Literal("planned"),
  Type.Literal("kept_changed"),
  Type.Literal("skipped"),
  Type.Literal("unrestorable"),
]);
const rewindEntryShape = Type.Object(
  {
    path: PathShape,
    action: Type.Union([Type.Literal("restore"), Type.Literal("delete")]),
    expectedSha256: Nullable(Sha256Shape),
    targetBefore: fileBeforeShape,
    undoBefore: fileBeforeShape,
    outcome: RewindPlanOutcomeShape,
    reason: ReasonShape,
  },
  { additionalProperties: false },
);
const rewindStartedShape = Type.Object(
  {
    rewindId: RewindIdSchema,
    scope: RewindScopeShape,
    targetItemId: ItemIdSchema,
    targetEventId: EventIdSchema,
    oldLeafEventId: Nullable(EventIdSchema),
    entries: Type.Array(rewindEntryShape, { maxItems: 4096 }),
  },
  { additionalProperties: false },
);
export const WorkspaceRewindStartedPayloadSchema: TUnsafe<WorkspaceRewindStartedPayload> =
  Type.Unsafe<WorkspaceRewindStartedPayload>(
    rewindStartedShape satisfies SchemaProof<
      WorkspaceRewindStartedPayload,
      typeof rewindStartedShape
    >,
  );

// ── workspace.rewind_applied / rewind_undone / rewind_overwritten ─────────

export interface WorkspaceRewindAppliedPayload {
  rewindId: RewindId;
  results: RewindFileResult[];
}

export interface WorkspaceRewindUndonePayload {
  rewindId: RewindId;
  results: RewindFileResult[];
  conversation: RewindUndoState;
}

export interface WorkspaceRewindOverwrittenPayload {
  rewindId: RewindId;
  results: RewindFileResult[];
}

const resultsShape = Type.Array(fileResultShape, { maxItems: 4096 });
const rewindAppliedShape = Type.Object(
  { rewindId: RewindIdSchema, results: resultsShape },
  { additionalProperties: false },
);
const rewindUndoneShape = Type.Object(
  { rewindId: RewindIdSchema, results: resultsShape, conversation: RewindUndoStateShape },
  { additionalProperties: false },
);
const rewindOverwrittenShape = Type.Object(
  { rewindId: RewindIdSchema, results: resultsShape },
  { additionalProperties: false },
);
export const WorkspaceRewindAppliedPayloadSchema: TUnsafe<WorkspaceRewindAppliedPayload> =
  Type.Unsafe<WorkspaceRewindAppliedPayload>(
    rewindAppliedShape satisfies SchemaProof<
      WorkspaceRewindAppliedPayload,
      typeof rewindAppliedShape
    >,
  );
export const WorkspaceRewindUndonePayloadSchema: TUnsafe<WorkspaceRewindUndonePayload> =
  Type.Unsafe<WorkspaceRewindUndonePayload>(
    rewindUndoneShape satisfies SchemaProof<WorkspaceRewindUndonePayload, typeof rewindUndoneShape>,
  );
export const WorkspaceRewindOverwrittenPayloadSchema: TUnsafe<WorkspaceRewindOverwrittenPayload> =
  Type.Unsafe<WorkspaceRewindOverwrittenPayload>(
    rewindOverwrittenShape satisfies SchemaProof<
      WorkspaceRewindOverwrittenPayload,
      typeof rewindOverwrittenShape
    >,
  );

/** 도메인 소유 카탈로그(F.records.spec §3.3.2). 모두 내구, 버전 1, 생산자 cap.workspace */
export const WORKSPACE_EVENT_CATALOG: readonly CatalogEntry[] = [
  {
    kind: "workspace.files_captured",
    version: 1,
    durable: true,
    payload: WorkspaceFilesCapturedPayloadSchema,
  },
  {
    kind: "workspace.rewind_started",
    version: 1,
    durable: true,
    payload: WorkspaceRewindStartedPayloadSchema,
  },
  {
    kind: "workspace.rewind_applied",
    version: 1,
    durable: true,
    payload: WorkspaceRewindAppliedPayloadSchema,
  },
  {
    kind: "workspace.rewind_undone",
    version: 1,
    durable: true,
    payload: WorkspaceRewindUndonePayloadSchema,
  },
  {
    kind: "workspace.rewind_overwritten",
    version: 1,
    durable: true,
    payload: WorkspaceRewindOverwrittenPayloadSchema,
  },
];
