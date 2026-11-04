import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "../../base/index.ts";
import {
  CompositionDeclSchema,
  ExtensionLayerSchema,
  PluginIdSchema,
  UiDeclSchema,
  type CompositionDecl,
  type ExtensionLayer,
  type UiDecl,
} from "../../extensions/index.ts";
import type {
  DevkitIssue,
  ExtensionKind,
  InstallPreview,
  KindEntry,
  LinkResult,
  PackResult,
  ReplayReport,
  ScaffoldResult,
} from "../../services/devkit.ts";
import { ExtDiagnosticSchema, type ExtDiagnostic } from "./ext-read.ts";
import {
  closed,
  m4,
  NoParamsSchema,
  request,
  type Io,
  type M4Spec,
  type NoParams,
  type Req,
} from "./schema-kit.ts";

// F.wire-settings.spec §3.3.7(M4 제작). L4.desktop-ux.spec §10.1 W-27~W-29, W-32, W-49. 서비스 계약은 `services/devkit.ts`(`fresnel.devkit`)다.

const Name = Type.String({ minLength: 1, maxLength: 96 });
const Id = Type.String({ minLength: 1, maxLength: 128 });
const Path = Type.String({ minLength: 1, maxLength: 4096 });
const Iso = Type.String({ minLength: 1, maxLength: 40 });
const Count = Type.Integer({ minimum: 0 });
const ThreadRef = Type.String({ minLength: 1, maxLength: 64 });

const ExtensionKindShape = Type.Union([
  Type.Literal("single-plugin"),
  Type.Literal("plugin-group"),
]);
const KindEntryShape = closed({
  id: ExtensionKindShape,
  title: Type.String({ minLength: 1, maxLength: 128 }),
  layers: Type.Array(
    Type.Union([
      Type.Literal("L1"),
      Type.Literal("L2"),
      Type.Literal("L3"),
      Type.Literal("plugin"),
      Type.Literal("X"),
    ]),
    { minItems: 1, maxItems: 5 },
  ),
  status: Type.Union([
    Type.Literal("stable"),
    Type.Literal("preview"),
    Type.Literal("blocked"),
    Type.Literal("deprecated"),
  ]),
  since: Name,
  requires: closed({
    contracts: Name,
    bridge: Type.Optional(Name),
    widgets: Type.Optional(Name),
  }),
  template: Type.Optional(Path),
  checks: Type.Array(Name, { maxItems: 64 }),
  decisions: Type.Array(Name, { maxItems: 64 }),
  security: Type.Array(Name, { maxItems: 64 }),
  blockedReason: Type.Optional(Type.String({ maxLength: 512 })),
});
export interface ExtKindsResult {
  readonly kinds: readonly KindEntry[];
}
const ExtKindsResultShape = closed({ kinds: Type.Array(KindEntryShape, { maxItems: 200 }) });
export const ExtKindsResultSchema: TUnsafe<ExtKindsResult> = Type.Unsafe<ExtKindsResult>(
  ExtKindsResultShape satisfies SchemaProof<ExtKindsResult, typeof ExtKindsResultShape>,
);

export interface ExtScaffoldParams {
  readonly kind: ExtensionKind;
  readonly name: string;
  readonly dir: string;
  readonly layer?: ExtensionLayer;
  readonly group?: { readonly members?: readonly string[]; readonly composition?: CompositionDecl };
  readonly ui?: UiDecl;
}
const ExtScaffoldParamsShape = request({
  kind: ExtensionKindShape,
  name: Name,
  dir: Path,
  layer: Type.Optional(ExtensionLayerSchema),
  group: Type.Optional(
    closed({
      members: Type.Optional(Type.Array(PluginIdSchema, { minItems: 1, maxItems: 16 })),
      composition: Type.Optional(CompositionDeclSchema),
    }),
  ),
  ui: Type.Optional(UiDeclSchema),
});
export const ExtScaffoldParamsSchema: TUnsafe<Req<ExtScaffoldParams>> = Type.Unsafe<
  Req<ExtScaffoldParams>
>(
  ExtScaffoldParamsShape satisfies SchemaProof<
    Req<ExtScaffoldParams>,
    typeof ExtScaffoldParamsShape
  >,
);
const ExtScaffoldResultShape = closed({
  dir: Path,
  files: Type.Array(Path, { maxItems: 1000 }),
});
export const ExtScaffoldResultSchema: TUnsafe<ScaffoldResult> = Type.Unsafe<ScaffoldResult>(
  ExtScaffoldResultShape satisfies SchemaProof<ScaffoldResult, typeof ExtScaffoldResultShape>,
);

export interface ExtDirParams {
  readonly dir: string;
}
const ExtDirParamsShape = request({ dir: Path });
export const ExtDirParamsSchema: TUnsafe<Req<ExtDirParams>> = Type.Unsafe<Req<ExtDirParams>>(
  ExtDirParamsShape satisfies SchemaProof<Req<ExtDirParams>, typeof ExtDirParamsShape>,
);

const DevkitIssueShape = closed({
  severity: Type.Union([Type.Literal("error"), Type.Literal("warning"), Type.Literal("info")]),
  code: Name,
  path: Type.String({ maxLength: 512 }),
  message: Type.String({ maxLength: 2000 }),
  file: Type.Optional(Type.String({ maxLength: 1024 })),
  line: Type.Optional(Type.Integer({ minimum: 1 })),
});
export interface ExtValidateDirResult {
  readonly ok: boolean;
  readonly issues: readonly DevkitIssue[];
}
const ExtValidateDirResultShape = closed({
  ok: Type.Boolean(),
  issues: Type.Array(DevkitIssueShape, { maxItems: 500 }),
});
export const ExtValidateDirResultSchema: TUnsafe<ExtValidateDirResult> =
  Type.Unsafe<ExtValidateDirResult>(
    ExtValidateDirResultShape satisfies SchemaProof<
      ExtValidateDirResult,
      typeof ExtValidateDirResultShape
    >,
  );

export interface ExtPackageParams {
  readonly dir: string;
  readonly out?: string;
}
const ExtPackageParamsShape = request({ dir: Path, out: Type.Optional(Path) });
export const ExtPackageParamsSchema: TUnsafe<Req<ExtPackageParams>> = Type.Unsafe<
  Req<ExtPackageParams>
>(ExtPackageParamsShape satisfies SchemaProof<Req<ExtPackageParams>, typeof ExtPackageParamsShape>);
const ExtPackageResultShape = closed({
  path: Path,
  files: Type.Array(Path, { maxItems: 5000 }),
  sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
});
export const ExtPackageResultSchema: TUnsafe<PackResult> = Type.Unsafe<PackResult>(
  ExtPackageResultShape satisfies SchemaProof<PackResult, typeof ExtPackageResultShape>,
);

/** `ext.install`(W-32). 설치는 사람 확인 뒤 호스트가 서비스 `link`로 한다 */
export interface ExtInstallParams {
  readonly source: string;
  /** `ext.installPreview`가 돌려준 `sha256`. 다르면 `source_changed`로 거부한다 */
  readonly sha256: string;
}
const Sha256 = Type.String({ pattern: "^[0-9a-f]{64}$" });
const ExtInstallParamsShape = request({ source: Path, sha256: Sha256 });
export const ExtInstallParamsSchema: TUnsafe<Req<ExtInstallParams>> = Type.Unsafe<
  Req<ExtInstallParams>
>(ExtInstallParamsShape satisfies SchemaProof<Req<ExtInstallParams>, typeof ExtInstallParamsShape>);
/**
 * 설치한 확장이 켜지는 때. 새 이름은 설치 뒤 로더가 곧바로 싣는다: 실행 중인 turn이 없으면 `now`, 있으면 켜기가 다음 단계 경계로 미뤄져 `nextStepBoundary`다.
 * 같은 이름이 이미 실행 중이면 `nextStepBoundary`이고 호출자가 `ext.reload`로 바꾼다. `restart`는 싣지 못했을 때(`loadFailure`)나 로더가 없을 때만 남는다
 * [결정: 2026-11-03 사용자 (a), M4 T-RELOAD]
 */
export const EXT_LOAD_FAILURE_REASONS = [
  "safe_mode",
  "not_found",
  "rejected",
  "error",
  "disabled",
  "loader_unavailable",
] as const;
export type ExtLoadFailureReason = (typeof EXT_LOAD_FAILURE_REASONS)[number];
/** 파일은 복사됐지만 싣지 못한 이유. 화면이 "설치했지만 켜지 못했어요"와 진단을 보인다 */
export interface ExtLoadFailure {
  readonly reason: ExtLoadFailureReason;
  readonly diagnostics: readonly ExtDiagnostic[];
}
const ExtLoadFailureShape = closed({
  reason: Type.Union(EXT_LOAD_FAILURE_REASONS.map((name) => Type.Literal(name))),
  diagnostics: Type.Array(ExtDiagnosticSchema, { maxItems: 64 }),
});
export interface ExtInstallResult extends LinkResult {
  readonly appliesAt: "now" | "nextStepBoundary" | "restart";
  readonly loadFailure?: ExtLoadFailure;
}
const ExtInstallResultShape = closed({
  name: Name,
  version: Name,
  location: Path,
  appliesAt: Type.Union([
    Type.Literal("now"),
    Type.Literal("nextStepBoundary"),
    Type.Literal("restart"),
  ]),
  loadFailure: Type.Optional(ExtLoadFailureShape),
});
export const ExtInstallResultSchema: TUnsafe<ExtInstallResult> = Type.Unsafe<ExtInstallResult>(
  ExtInstallResultShape satisfies SchemaProof<ExtInstallResult, typeof ExtInstallResultShape>,
);

/** `ext.installPreview`(W-32). 설치 전 확인 화면 값. 디스크에 쓰지 않는다 */
export interface ExtInstallPreviewParams {
  readonly source: string;
}
const ExtInstallPreviewParamsShape = request({ source: Path });
export const ExtInstallPreviewParamsSchema: TUnsafe<Req<ExtInstallPreviewParams>> = Type.Unsafe<
  Req<ExtInstallPreviewParams>
>(
  ExtInstallPreviewParamsShape satisfies SchemaProof<
    Req<ExtInstallPreviewParams>,
    typeof ExtInstallPreviewParamsShape
  >,
);
const CapabilityRef = closed({ id: Name, optional: Type.Boolean() });
const ExtInstallPreviewResultShape = closed({
  name: Name,
  version: Name,
  displayName: Type.Union([Name, Type.Null()]),
  description: Type.Union([Type.String({ maxLength: 1024 }), Type.Null()]),
  source: Path,
  sha256: Sha256,
  trustRequest: Type.Union([
    Type.Literal("user"),
    Type.Literal("project"),
    Type.Literal("untrusted"),
    Type.Null(),
  ]),
  installedVersion: Type.Union([Name, Type.Null()]),
  hooks: Type.Array(Name, { maxItems: 1024 }),
  tools: Type.Array(Name, { maxItems: 256 }),
  capabilities: Type.Array(CapabilityRef, { maxItems: 2048 }),
  network: Type.Array(Name, { maxItems: 256 }),
  files: Type.Array(Name, { maxItems: 256 }),
  shell: Type.Array(Name, { maxItems: 256 }),
  drives: Type.Boolean(),
  warnings: Type.Array(
    closed({
      severity: Type.Union([Type.Literal("error"), Type.Literal("warning"), Type.Literal("info")]),
      code: Name,
      path: Type.String({ maxLength: 512 }),
      message: Type.String({ maxLength: 2048 }),
      file: Type.Optional(Path),
      line: Type.Optional(Count),
    }),
    { maxItems: 500 },
  ),
});
export const ExtInstallPreviewResultSchema: TUnsafe<InstallPreview> = Type.Unsafe<InstallPreview>(
  ExtInstallPreviewResultShape satisfies SchemaProof<
    InstallPreview,
    typeof ExtInstallPreviewResultShape
  >,
);

export interface ExtRemoveParams {
  readonly name: string;
}
const ExtRemoveParamsShape = request({ name: Name });
export const ExtRemoveParamsSchema: TUnsafe<Req<ExtRemoveParams>> = Type.Unsafe<
  Req<ExtRemoveParams>
>(ExtRemoveParamsShape satisfies SchemaProof<Req<ExtRemoveParams>, typeof ExtRemoveParamsShape>);
/** 지운 확장이 내려가는 때. 로더가 내리면 `now`(목록에서 바로 빠진다), 로더가 없으면 `restart`다 */
export interface ExtRemoveResult {
  readonly name: string;
  readonly appliesAt: "now" | "nextStepBoundary" | "restart";
}
const ExtRemoveResultShape = closed({
  name: Name,
  appliesAt: Type.Union([
    Type.Literal("now"),
    Type.Literal("nextStepBoundary"),
    Type.Literal("restart"),
  ]),
});
export const ExtRemoveResultSchema: TUnsafe<ExtRemoveResult> = Type.Unsafe<ExtRemoveResult>(
  ExtRemoveResultShape satisfies SchemaProof<ExtRemoveResult, typeof ExtRemoveResultShape>,
);

/**
 * `ext.test.run`(W-29). replay 실행은 개발 모드만(`dev_mode_required`). 이름이 Test run(격리 대화)과 헷갈리지만
 * 플러그인 시험 묶음 실행이라 그대로 둔다 [제안: 기본값, 대안 `ext.suite.*`]
 */
export const EXT_TEST_KINDS = ["replay", "testRun"] as const;
export type ExtTestKind = (typeof EXT_TEST_KINDS)[number];
export interface ExtTestRunParams {
  readonly kind: ExtTestKind;
  readonly target: string;
  readonly options?: {
    readonly maxCommits?: number;
    readonly profileId?: string;
    readonly workspace?: string;
  };
}
const ExtTestRunParamsShape = request({
  kind: Type.Union([Type.Literal("replay"), Type.Literal("testRun")]),
  target: Name,
  options: Type.Optional(
    closed({
      maxCommits: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
      profileId: Type.Optional(Id),
      workspace: Type.Optional(Path),
    }),
  ),
});
export const ExtTestRunParamsSchema: TUnsafe<Req<ExtTestRunParams>> = Type.Unsafe<
  Req<ExtTestRunParams>
>(ExtTestRunParamsShape satisfies SchemaProof<Req<ExtTestRunParams>, typeof ExtTestRunParamsShape>);
export interface ExtTestRunResult {
  readonly testId: string;
  /** testRun이면 Test run 대화 */
  readonly threadId: string | null;
}
const ExtTestRunResultShape = closed({
  testId: Id,
  threadId: Type.Union([ThreadRef, Type.Null()]),
});
export const ExtTestRunResultSchema: TUnsafe<ExtTestRunResult> = Type.Unsafe<ExtTestRunResult>(
  ExtTestRunResultShape satisfies SchemaProof<ExtTestRunResult, typeof ExtTestRunResultShape>,
);

const ReplayReportShape = closed({
  ok: Type.Boolean(),
  commits: Count,
  passed: Count,
  firstDiff: Type.Union([Count, Type.Null()]),
  effects: closed({ turn: Count, spawn: Count, delegate: Count, post: Count }),
  failure: Type.Union([
    Type.Literal("effects-doubled"),
    Type.Literal("effects-mismatch"),
    Type.Literal("max-commits-exceeded"),
    Type.Literal("no-commits"),
    Type.Null(),
  ]),
});
export interface ExtTestRecord {
  readonly testId: string;
  readonly kind: ExtTestKind;
  readonly target: string;
  readonly state: "running" | "passed" | "failed";
  readonly startedAt: string;
  readonly durationMs: number | null;
  readonly threadId: string | null;
  readonly replay: ReplayReport | null;
}
const ExtTestRecordShape = closed({
  testId: Id,
  kind: Type.Union([Type.Literal("replay"), Type.Literal("testRun")]),
  target: Name,
  state: Type.Union([Type.Literal("running"), Type.Literal("passed"), Type.Literal("failed")]),
  startedAt: Iso,
  durationMs: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  threadId: Type.Union([ThreadRef, Type.Null()]),
  replay: Type.Union([ReplayReportShape, Type.Null()]),
});
export interface ExtTestListResult {
  readonly tests: readonly ExtTestRecord[];
}
const ExtTestListResultShape = closed({ tests: Type.Array(ExtTestRecordShape, { maxItems: 500 }) });
export const ExtTestListResultSchema: TUnsafe<ExtTestListResult> = Type.Unsafe<ExtTestListResult>(
  ExtTestListResultShape satisfies SchemaProof<ExtTestListResult, typeof ExtTestListResultShape>,
);

type U<T> = TUnsafe<T>;
export interface DevkitWireSchemas {
  "ext.kinds": Io<U<NoParams>, U<ExtKindsResult>>;
  "ext.scaffold": Io<U<Req<ExtScaffoldParams>>, U<ScaffoldResult>>;
  "ext.validate": Io<U<Req<ExtDirParams>>, U<ExtValidateDirResult>>;
  "ext.package": Io<U<Req<ExtPackageParams>>, U<PackResult>>;
  "ext.installPreview": Io<U<Req<ExtInstallPreviewParams>>, U<InstallPreview>>;
  "ext.install": Io<U<Req<ExtInstallParams>>, U<ExtInstallResult>>;
  "ext.remove": Io<U<Req<ExtRemoveParams>>, U<ExtRemoveResult>>;
  "ext.test.run": Io<U<Req<ExtTestRunParams>>, U<ExtTestRunResult>>;
  "ext.test.list": Io<U<NoParams>, U<ExtTestListResult>>;
}
type Table = {
  readonly [M in keyof DevkitWireSchemas]: M4Spec<
    DevkitWireSchemas[M]["params"],
    DevkitWireSchemas[M]["result"]
  >;
};
export const DEVKIT_WIRE_METHODS: Table = {
  "ext.kinds": m4(NoParamsSchema, ExtKindsResultSchema),
  "ext.scaffold": m4(ExtScaffoldParamsSchema, ExtScaffoldResultSchema),
  "ext.validate": m4(ExtDirParamsSchema, ExtValidateDirResultSchema),
  "ext.package": m4(ExtPackageParamsSchema, ExtPackageResultSchema),
  "ext.installPreview": m4(ExtInstallPreviewParamsSchema, ExtInstallPreviewResultSchema),
  "ext.install": m4(ExtInstallParamsSchema, ExtInstallResultSchema),
  "ext.remove": m4(ExtRemoveParamsSchema, ExtRemoveResultSchema),
  "ext.test.run": m4(ExtTestRunParamsSchema, ExtTestRunResultSchema),
  "ext.test.list": m4(NoParamsSchema, ExtTestListResultSchema),
};
