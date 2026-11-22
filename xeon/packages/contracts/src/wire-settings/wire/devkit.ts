import { Type, type TUnsafe } from "typebox";
import { SemVerRangeSchema } from "../../capabilities/index.ts";
import type { SchemaProof } from "../../base/index.ts";
import {
  CompositionDeclSchema,
  DependencyKindSchema,
  ExtensionLayerSchema,
  PluginIdSchema,
  RegistrationIdSchema,
  UiDeclSchema,
  type CompositionDecl,
  type ExtensionLayer,
  type UiDecl,
} from "../../extensions/index.ts";
import type {
  DependenciesEditInput,
  DependenciesEditResult,
  DependencyInfo,
  DevkitIssue,
  KindEntry,
  MemberInfo,
  MembersDetachInput,
  MembersDetachResult,
  MembersEditInput,
  MembersEditResult,
  MembersMergeInput,
  MembersMergeResult,
  PackResult,
  ReplayReport,
  ScaffoldResult,
} from "../../services/devkit.ts";
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

const ExtensionKindShape = Type.Literal("single-plugin");
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

/**
 * `ext.scaffold`의 종류는 플러그인 하나뿐이다(review/m5/profile-project-loader.md §4.9.5). `ext.kinds`도 그 하나만 돌려준다
 */
export interface ExtScaffoldParams {
  readonly kind: "single-plugin";
  readonly name: string;
  readonly dir: string;
  readonly layer?: ExtensionLayer;
  readonly orchestration?: {
    readonly members?: readonly string[];
    readonly composition?: CompositionDecl;
  };
  readonly ui?: UiDecl;
}
const ExtScaffoldParamsShape = request({
  kind: Type.Literal("single-plugin"),
  name: Name,
  dir: Path,
  layer: Type.Optional(ExtensionLayerSchema),
  orchestration: Type.Optional(
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
      maxCommits: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
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

const ReplayCutShape = closed({
  commitIndex: Type.Integer({ minimum: 1 }),
  equal: Type.Boolean(),
  firstDiff: Type.Union([Count, Type.Null()]),
});
const ReplayReportShape = closed({
  ok: Type.Boolean(),
  commits: Count,
  passed: Count,
  firstDiff: Type.Union([Count, Type.Null()]),
  cuts: Type.Array(ReplayCutShape, { maxItems: 1000 }),
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

/**
 * 구성원 편집(`ext.members.edit`, L3.authoring.spec §3.3). 종류는 `MemberOp` 네 가지뿐이고 한 번에 1~32건을 받는다.
 * 모양은 `MemberOp`(services/devkit.ts)와 같다
 */
const MemberModeShape = Type.Union([
  Type.Literal("hook"),
  Type.Literal("inject"),
  Type.Literal("drive"),
]);
const MemberOpShape = Type.Union([
  closed({
    kind: Type.Literal("add"),
    id: PluginIdSchema,
    layer: Type.Optional(ExtensionLayerSchema),
    title: Type.Optional(Type.String({ maxLength: 64 })),
    mode: Type.Optional(MemberModeShape),
  }),
  closed({ kind: Type.Literal("rename"), id: PluginIdSchema, to: PluginIdSchema }),
  closed({ kind: Type.Literal("remove"), id: PluginIdSchema }),
  closed({
    kind: Type.Literal("move"),
    id: PluginIdSchema,
    toIndex: Type.Integer({ minimum: 0 }),
  }),
]);

const MemberInfoShape = closed({
  id: PluginIdSchema,
  registrationId: RegistrationIdSchema,
  title: Type.Union([Type.String({ maxLength: 64 }), Type.Null()]),
  layer: ExtensionLayerSchema,
  hooks: Type.Array(Name, { maxItems: 64 }),
  drives: Type.Boolean(),
  defaultEnabled: Type.Boolean(),
  blockIds: Type.Array(Id, { maxItems: 64 }),
});
const MembersEditParamsShape = request({
  dir: Path,
  ops: Type.Array(MemberOpShape, { minItems: 1, maxItems: 32 }),
});
export const ExtMembersEditParamsSchema: TUnsafe<Req<MembersEditInput>> = Type.Unsafe<
  Req<MembersEditInput>
>(
  MembersEditParamsShape satisfies SchemaProof<
    Req<MembersEditInput>,
    typeof MembersEditParamsShape
  >,
);
const MembersEditResultShape = closed({
  members: Type.Array(MemberInfoShape, { maxItems: 16 }),
  issues: Type.Array(DevkitIssueShape, { maxItems: 500 }),
  changedFiles: Type.Array(Path, { maxItems: 1000 }),
  entryWiring: Type.Union([Type.Literal("generated"), Type.Literal("manual")]),
});
export const MembersEditResultSchema: TUnsafe<MembersEditResult> = Type.Unsafe<MembersEditResult>(
  MembersEditResultShape satisfies SchemaProof<MembersEditResult, typeof MembersEditResultShape>,
);

/** 구성원 읽기(`ext.members.read`). 쓰지 않고 매니페스트의 구성원을 돌려준다 */
export interface ExtMembersReadResult {
  readonly members: readonly MemberInfo[];
}
const ExtMembersReadResultShape = closed({
  members: Type.Array(MemberInfoShape, { maxItems: 16 }),
});
export const ExtMembersReadResultSchema: TUnsafe<ExtMembersReadResult> =
  Type.Unsafe<ExtMembersReadResult>(
    ExtMembersReadResultShape satisfies SchemaProof<
      ExtMembersReadResult,
      typeof ExtMembersReadResultShape
    >,
  );

/**
 * 의존 편집(`ext.dependencies.edit`, AGE-33). 한 번에 1~32건을 받는다. 모양은 `DependencyOp`(services/devkit.ts)와 같다.
 * 범위 형식은 여기서 길이만 보고, 형식 검사는 편집 함수가 `dependency_range_invalid` 사유로 한다
 */
const DependencyOpShape = Type.Union([
  closed({
    kind: Type.Literal("add"),
    from: Type.Optional(PluginIdSchema),
    dependency: closed({
      plugin: RegistrationIdSchema,
      range: Type.Optional(SemVerRangeSchema),
      kind: Type.Optional(DependencyKindSchema),
    }),
  }),
  closed({
    kind: Type.Literal("remove"),
    from: Type.Optional(PluginIdSchema),
    plugin: RegistrationIdSchema,
  }),
]);
const DependencyInfoShape = closed({
  from: RegistrationIdSchema,
  target: RegistrationIdSchema,
  kind: DependencyKindSchema,
  range: Type.Union([SemVerRangeSchema, Type.Null()]),
});
const DependenciesEditParamsShape = request({
  dir: Path,
  ops: Type.Array(DependencyOpShape, { minItems: 1, maxItems: 32 }),
});
export const ExtDependenciesEditParamsSchema: TUnsafe<Req<DependenciesEditInput>> = Type.Unsafe<
  Req<DependenciesEditInput>
>(
  DependenciesEditParamsShape satisfies SchemaProof<
    Req<DependenciesEditInput>,
    typeof DependenciesEditParamsShape
  >,
);
const DependenciesEditResultShape = closed({
  dependencies: Type.Array(DependencyInfoShape, { maxItems: 512 }),
  issues: Type.Array(DevkitIssueShape, { maxItems: 500 }),
  changedFiles: Type.Array(Path, { maxItems: 1000 }),
});
export const DependenciesEditResultSchema: TUnsafe<DependenciesEditResult> =
  Type.Unsafe<DependenciesEditResult>(
    DependenciesEditResultShape satisfies SchemaProof<
      DependenciesEditResult,
      typeof DependenciesEditResultShape
    >,
  );

/** 의존 읽기(`ext.dependencies.read`). 쓰지 않고 매니페스트의 의존 줄을 돌려준다 */
export interface ExtDependenciesReadResult {
  readonly dependencies: readonly DependencyInfo[];
}
const ExtDependenciesReadResultShape = closed({
  dependencies: Type.Array(DependencyInfoShape, { maxItems: 512 }),
});
export const ExtDependenciesReadResultSchema: TUnsafe<ExtDependenciesReadResult> =
  Type.Unsafe<ExtDependenciesReadResult>(
    ExtDependenciesReadResultShape satisfies SchemaProof<
      ExtDependenciesReadResult,
      typeof ExtDependenciesReadResultShape
    >,
  );

/**
 * 구성원 떼기(`ext.members.detach`, AGE-33). 원본 폴더 `dir`은 읽기만 하고 새 폴더 `outDir`에만 쓴다. 입력 모양은
 * `MembersDetachInput`(services/devkit.ts)과 같다. 이름 형식과 `outDir`의 빈 상태는 편집 함수가 사유로 거절한다
 */
const MembersDetachParamsShape = request({
  dir: Path,
  member: PluginIdSchema,
  outDir: Path,
  name: Type.Optional(Name),
  keepDependency: Type.Optional(Type.Boolean()),
  dependencyKind: Type.Optional(DependencyKindSchema),
});
export const ExtMembersDetachParamsSchema: TUnsafe<Req<MembersDetachInput>> = Type.Unsafe<
  Req<MembersDetachInput>
>(
  MembersDetachParamsShape satisfies SchemaProof<
    Req<MembersDetachInput>,
    typeof MembersDetachParamsShape
  >,
);
const MembersDetachResultShape = closed({
  outDir: Path,
  name: Name,
  changedFiles: Type.Array(Path, { maxItems: 1000 }),
  issues: Type.Array(DevkitIssueShape, { maxItems: 500 }),
  profileMove: closed({ from: RegistrationIdSchema, to: Name }),
});
export const MembersDetachResultSchema: TUnsafe<MembersDetachResult> =
  Type.Unsafe<MembersDetachResult>(
    MembersDetachResultShape satisfies SchemaProof<
      MembersDetachResult,
      typeof MembersDetachResultShape
    >,
  );

/**
 * 구성원 합치기(`ext.members.merge`, AGE-33). 원본 폴더 2~16개는 읽기만 하고 새 폴더 `outDir`에만 쓴다. 입력 모양은
 * `MembersMergeInput`(services/devkit.ts)과 같다. 이름 형식, 원본의 독립성, 충돌, `outDir`의 빈 상태는 편집 함수가 사유로 거절한다
 */
const MembersMergeParamsShape = request({
  dirs: Type.Array(Path, { minItems: 2, maxItems: 16 }),
  outDir: Path,
  name: Name,
  title: Type.Optional(Type.String({ maxLength: 64 })),
});
export const ExtMembersMergeParamsSchema: TUnsafe<Req<MembersMergeInput>> = Type.Unsafe<
  Req<MembersMergeInput>
>(
  MembersMergeParamsShape satisfies SchemaProof<
    Req<MembersMergeInput>,
    typeof MembersMergeParamsShape
  >,
);
const MembersMergeResultShape = closed({
  outDir: Path,
  name: Name,
  members: Type.Array(MemberInfoShape, { maxItems: 16 }),
  changedFiles: Type.Array(Path, { maxItems: 1000 }),
  issues: Type.Array(DevkitIssueShape, { maxItems: 500 }),
  profileMove: Type.Array(closed({ from: RegistrationIdSchema, to: RegistrationIdSchema }), {
    maxItems: 16,
  }),
});
export const MembersMergeResultSchema: TUnsafe<MembersMergeResult> =
  Type.Unsafe<MembersMergeResult>(
    MembersMergeResultShape satisfies SchemaProof<
      MembersMergeResult,
      typeof MembersMergeResultShape
    >,
  );

type U<T> = TUnsafe<T>;
export interface DevkitWireSchemas {
  "ext.kinds": Io<U<NoParams>, U<ExtKindsResult>>;
  "ext.scaffold": Io<U<Req<ExtScaffoldParams>>, U<ScaffoldResult>>;
  "ext.validate": Io<U<Req<ExtDirParams>>, U<ExtValidateDirResult>>;
  "ext.package": Io<U<Req<ExtPackageParams>>, U<PackResult>>;
  "ext.test.run": Io<U<Req<ExtTestRunParams>>, U<ExtTestRunResult>>;
  "ext.test.list": Io<U<NoParams>, U<ExtTestListResult>>;
  "ext.members.edit": Io<U<Req<MembersEditInput>>, U<MembersEditResult>>;
  "ext.members.read": Io<U<Req<ExtDirParams>>, U<ExtMembersReadResult>>;
  "ext.members.detach": Io<U<Req<MembersDetachInput>>, U<MembersDetachResult>>;
  "ext.members.merge": Io<U<Req<MembersMergeInput>>, U<MembersMergeResult>>;
  "ext.dependencies.edit": Io<U<Req<DependenciesEditInput>>, U<DependenciesEditResult>>;
  "ext.dependencies.read": Io<U<Req<ExtDirParams>>, U<ExtDependenciesReadResult>>;
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
  "ext.test.run": m4(ExtTestRunParamsSchema, ExtTestRunResultSchema),
  "ext.test.list": m4(NoParamsSchema, ExtTestListResultSchema),
  "ext.members.edit": m4(ExtMembersEditParamsSchema, MembersEditResultSchema),
  "ext.members.read": m4(ExtDirParamsSchema, ExtMembersReadResultSchema),
  "ext.members.detach": m4(ExtMembersDetachParamsSchema, MembersDetachResultSchema),
  "ext.members.merge": m4(ExtMembersMergeParamsSchema, MembersMergeResultSchema),
  "ext.dependencies.edit": m4(ExtDependenciesEditParamsSchema, DependenciesEditResultSchema),
  "ext.dependencies.read": m4(ExtDirParamsSchema, ExtDependenciesReadResultSchema),
};
