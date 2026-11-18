import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "../../base/index.ts";
import { EmptyParamsSchema } from "./notifications.ts";
import { closed, m4, request, type Io, type M4Spec, type Req } from "./schema-kit.ts";

// 가져오기 wire(docs/xeon/review/m5/migration.md §7.7 [제안], §6.1, §6.3, §7.2). 이 파일은 다른 하네스의 설정을 옮기는 라이브러리(`@fresnel/plugin-migration`, P층)의
// 모양을 자립해서 옮긴다. F층은 P층을 import하지 못하므로 같은 모양을 TypeBox로 다시 쓴다.
// 직렬화되는 모양만 싣는다. 폴더 트리 바이트(`PlannedPlugin.tree`)는 싣지 않는다. 시크릿 값 필드는 없고 개수(`secretCount`)만 있다.
// 이름 공간은 `migration.*`다. 오류 이름은 3670~3679 구간이고, 알림은 `migration.progress`와 `migration.changed`다.
// `Question`, `ReportLine`, `Choices`는 plugin-migration/src/types.ts의 필드와 열거 값을 그대로 따른다.

const Name = Type.String({ minLength: 1, maxLength: 96 });
const Id = Type.String({ minLength: 1, maxLength: 128 });
const Path = Type.String({ minLength: 1, maxLength: 4096 });
const Marker = Type.String({ minLength: 1, maxLength: 1024 });
const Count = Type.Integer({ minimum: 0 });
/** 목적 한 문장. 라이브러리 상한은 200자(코드 포인트)이고 UTF-16 길이 여유를 둬 400으로 잡는다 */
const Purpose = Type.String({ minLength: 1, maxLength: 400 });

// ── 열거 값 ─────────────────────────────────────────────────────────────

/** 감지(`migration.detect`)의 표지가 가리키는 하네스. 존재만 보므로 `agents-md`는 싣지 않는다 */
export const MIGRATION_DETECT_HARNESSES = ["claude-code", "agent-skills", "other"] as const;
export type MigrationDetectHarness = (typeof MIGRATION_DETECT_HARNESSES)[number];

/** 원본 하네스(훑기 항목과 보고 줄). 라이브러리 `HarnessId`와 같은 세 값이다 */
export const MIGRATION_HARNESSES = ["claude-code", "agents-md", "agent-skills"] as const;
export type MigrationHarness = (typeof MIGRATION_HARNESSES)[number];

/** 중간 표현의 종류(라이브러리 `IrKind`) */
export const MIGRATION_IR_KINDS = [
  "instruction",
  "skill",
  "command",
  "agent",
  "mcp",
  "field",
  "blocked",
  "hook",
] as const;
export type MigrationIrKind = (typeof MIGRATION_IR_KINDS)[number];

/** 항목의 범위(라이브러리 `ItemScope`) */
export const MIGRATION_ITEM_SCOPES = ["user", "project", "local", "managed", "plugin"] as const;
export type MigrationItemScope = (typeof MIGRATION_ITEM_SCOPES)[number];

/** 훑기 진단 코드(라이브러리 `ScanDiagnostic.code`) */
export const MIGRATION_DIAGNOSTIC_CODES = [
  "unreadable",
  "too_large",
  "invalid_json",
  "limit",
  "invalid_frontmatter",
] as const;
export type MigrationDiagnosticCode = (typeof MIGRATION_DIAGNOSTIC_CODES)[number];

/** 보고 줄의 판정(라이브러리 `ReportStatus`) */
export const MIGRATION_REPORT_STATUSES = ["exact", "differs", "not_ported", "not_needed"] as const;
export type MigrationReportStatus = (typeof MIGRATION_REPORT_STATUSES)[number];

/** 차이의 종류(라이브러리 `DifferenceKind`) */
export const MIGRATION_DIFFERENCE_KINDS = [
  "semantic_loss",
  "scope_change",
  "time_limit",
  "cost",
  "enforcement_change",
  "approval_flow",
  "renamed",
  "user_choice",
] as const;
export type MigrationDifferenceKind = (typeof MIGRATION_DIFFERENCE_KINDS)[number];

/** 프로필 제안의 범위. 프로젝트 범위 항목은 프로젝트 이름의 프로필로, 사용자 공통 항목은 모든 프로필 공통으로 제안한다 */
export const MIGRATION_PROFILE_SCOPES = ["project", "user-common"] as const;
export type MigrationProfileScope = (typeof MIGRATION_PROFILE_SCOPES)[number];

/** 알림 `migration.changed`의 종류 */
export const MIGRATION_CHANGE_KINDS = ["scan", "proposal", "apply", "dismiss"] as const;
export type MigrationChangeKind = (typeof MIGRATION_CHANGE_KINDS)[number];

const DetectHarnessShape = Type.Union(MIGRATION_DETECT_HARNESSES.map((name) => Type.Literal(name)));
const HarnessShape = Type.Union(MIGRATION_HARNESSES.map((name) => Type.Literal(name)));
const IrKindShape = Type.Union(MIGRATION_IR_KINDS.map((name) => Type.Literal(name)));
const ItemScopeShape = Type.Union(MIGRATION_ITEM_SCOPES.map((name) => Type.Literal(name)));
const DiagnosticCodeShape = Type.Union(
  MIGRATION_DIAGNOSTIC_CODES.map((name) => Type.Literal(name)),
);
const ReportStatusShape = Type.Union(MIGRATION_REPORT_STATUSES.map((name) => Type.Literal(name)));
const DifferenceKindShape = Type.Union(
  MIGRATION_DIFFERENCE_KINDS.map((name) => Type.Literal(name)),
);
const ProfileScopeShape = Type.Union(MIGRATION_PROFILE_SCOPES.map((name) => Type.Literal(name)));
const ChangeKindShape = Type.Union(MIGRATION_CHANGE_KINDS.map((name) => Type.Literal(name)));

// ── 감지 ────────────────────────────────────────────────────────────────

/** 감지 표지 하나. 존재만 확인한 결과이고 내용은 읽지 않는다 */
export interface ForeignFormatFound {
  /** 프로젝트 루트 기준 상대 경로. 상위 폴더의 `.agents/skills`는 `../.agents/skills`다 */
  readonly marker: string;
  readonly harness: MigrationDetectHarness;
  /** 엔진이 이 자리를 읽는가. M5g-2 뒤에는 거짓이다(다른 하네스 형식은 가져오기로만 들어온다) */
  readonly engineReads: boolean;
  /** 가져오기가 옮길 수 있는가 */
  readonly importable: boolean;
}
const ForeignFormatFoundShape = closed({
  marker: Marker,
  harness: DetectHarnessShape,
  engineReads: Type.Boolean(),
  importable: Type.Boolean(),
});
export const ForeignFormatFoundSchema: TUnsafe<ForeignFormatFound> =
  Type.Unsafe<ForeignFormatFound>(
    ForeignFormatFoundShape satisfies SchemaProof<
      ForeignFormatFound,
      typeof ForeignFormatFoundShape
    >,
  );

/**
 * 가져오기 알림의 값. `trust.get`의 `foreignFormats`와 `migration.detect`의 `notice`가 같은 모양이다.
 * `willStopReading`은 이제 읽지 않는 자리다(엔진이 예전에 읽던 `.mcp.json`, `../.agents/skills`). 필드 이름은 wire 호환으로 그대로다.
 * `importable`은 엔진은 읽지 않지만 가져오기로 옮길 수 있는 자리다. 두 목록은 겹칠 수 있다
 */
export interface ForeignFormatNotice {
  readonly code: "foreign_format_found";
  readonly willStopReading: readonly string[];
  readonly importable: readonly string[];
  readonly importAvailable: boolean;
}
const ForeignFormatNoticeShape = closed({
  code: Type.Literal("foreign_format_found"),
  willStopReading: Type.Array(Marker, { maxItems: 64 }),
  importable: Type.Array(Marker, { maxItems: 64 }),
  importAvailable: Type.Boolean(),
});
export const ForeignFormatNoticeSchema: TUnsafe<ForeignFormatNotice> =
  Type.Unsafe<ForeignFormatNotice>(
    ForeignFormatNoticeShape satisfies SchemaProof<
      ForeignFormatNotice,
      typeof ForeignFormatNoticeShape
    >,
  );

// ── 훑기 ────────────────────────────────────────────────────────────────

/** 훑을 위치 하나. 절대 경로이고 `scope`는 사용자 수준 또는 프로젝트다 */
export interface MigrationScanRoot {
  readonly path: string;
  readonly scope: "user" | "project";
  readonly label: string;
}
const MigrationScanRootShape = closed({
  path: Path,
  scope: Type.Union([Type.Literal("user"), Type.Literal("project")]),
  label: Type.String({ minLength: 1, maxLength: 128 }),
});

/** 훑은 항목 하나. 값 없이 개수만 싣는다(`secretCount`) */
export interface MigrationScanItem {
  readonly itemId: string;
  readonly harness: MigrationHarness;
  readonly kind: MigrationIrKind;
  readonly scope: MigrationItemScope;
  /** 홈은 `~`로 줄인 경로 */
  readonly path: string;
  readonly bytes: number;
  readonly secretCount: number;
}
const MigrationScanItemShape = closed({
  itemId: Id,
  harness: HarnessShape,
  kind: IrKindShape,
  scope: ItemScopeShape,
  path: Path,
  bytes: Count,
  secretCount: Count,
});
export const MigrationScanItemSchema: TUnsafe<MigrationScanItem> = Type.Unsafe<MigrationScanItem>(
  MigrationScanItemShape satisfies SchemaProof<MigrationScanItem, typeof MigrationScanItemShape>,
);

export interface MigrationScanDiagnostic {
  readonly code: MigrationDiagnosticCode;
  readonly path?: string;
  readonly message: string;
}
const MigrationScanDiagnosticShape = closed({
  code: DiagnosticCodeShape,
  path: Type.Optional(Path),
  message: Type.String({ maxLength: 512 }),
});
export const MigrationScanDiagnosticSchema: TUnsafe<MigrationScanDiagnostic> =
  Type.Unsafe<MigrationScanDiagnostic>(
    MigrationScanDiagnosticShape satisfies SchemaProof<
      MigrationScanDiagnostic,
      typeof MigrationScanDiagnosticShape
    >,
  );

// ── 제안: 답과 질문 ─────────────────────────────────────────────────────

/**
 * 사용자의 답. 키는 `Question.id`다. `existingPlugins`는 플러그인 이름 충돌을 피할 때 쓰는 이미 있는 플러그인 이름이다.
 * 답 값은 질문의 선택지 가운데 하나여야 하지만 그 검사는 라이브러리가 한다
 */
export interface MigrationChoices {
  readonly answers: Readonly<Record<string, string>>;
  readonly existingPlugins?: readonly string[];
}
const MigrationChoicesShape = closed({
  answers: Type.Record(Type.String({ maxLength: 128 }), Type.String({ maxLength: 512 })),
  existingPlugins: Type.Optional(Type.Array(Name, { maxItems: 512 })),
});
export const MigrationChoicesSchema: TUnsafe<MigrationChoices> = Type.Unsafe<MigrationChoices>(
  MigrationChoicesShape satisfies SchemaProof<MigrationChoices, typeof MigrationChoicesShape>,
);

/** 사용자가 정해야 하는 질문 하나. `options`의 첫째가 기본 제안이다 */
export interface MigrationQuestion {
  readonly id: string;
  readonly itemId: string;
  readonly text: string;
  readonly options: readonly string[];
}
const MigrationQuestionShape = closed({
  id: Id,
  itemId: Id,
  text: Type.String({ minLength: 1, maxLength: 1024 }),
  options: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
    minItems: 1,
    maxItems: 32,
  }),
});
export const MigrationQuestionSchema: TUnsafe<MigrationQuestion> = Type.Unsafe<MigrationQuestion>(
  MigrationQuestionShape satisfies SchemaProof<MigrationQuestion, typeof MigrationQuestionShape>,
);

/** 보고 줄 하나. 항목 하나가 줄 하나를 낸다. 질문이 열려 있으면 그 줄의 판정은 "예상"이다 */
export interface MigrationReportLine {
  readonly itemId: string;
  readonly harness: MigrationHarness;
  readonly kind: MigrationIrKind;
  /** 사람이 읽는 이름: "스킬 deploy", "MCP 서버 github" */
  readonly label: string;
  readonly source: {
    readonly scope: MigrationItemScope;
    readonly path: string;
    readonly key?: string;
  };
  readonly status: MigrationReportStatus;
  readonly differences: readonly {
    readonly kind: MigrationDifferenceKind;
    readonly text: string;
  }[];
  readonly reason?: { readonly code: string; readonly text: string };
  readonly alternative?: string;
  /** 어느 플러그인 초안의 어느 파일로 갔나 */
  readonly output?: { readonly plugin: string; readonly path: string };
}
const MigrationReportLineShape = closed({
  itemId: Id,
  harness: HarnessShape,
  kind: IrKindShape,
  label: Type.String({ minLength: 1, maxLength: 256 }),
  source: closed({
    scope: ItemScopeShape,
    path: Path,
    key: Type.Optional(Type.String({ maxLength: 512 })),
  }),
  status: ReportStatusShape,
  differences: Type.Array(
    closed({ kind: DifferenceKindShape, text: Type.String({ maxLength: 1024 }) }),
    { maxItems: 64 },
  ),
  reason: Type.Optional(
    closed({
      code: Type.String({ minLength: 1, maxLength: 64 }),
      text: Type.String({ maxLength: 1024 }),
    }),
  ),
  alternative: Type.Optional(Type.String({ maxLength: 1024 })),
  output: Type.Optional(closed({ plugin: Name, path: Path })),
});
export const MigrationReportLineSchema: TUnsafe<MigrationReportLine> =
  Type.Unsafe<MigrationReportLine>(
    MigrationReportLineShape satisfies SchemaProof<
      MigrationReportLine,
      typeof MigrationReportLineShape
    >,
  );

/** 제안이 만들 플러그인 하나의 요약. 폴더 트리는 싣지 않는다 */
export interface MigrationPlannedPlugin {
  readonly name: string;
  readonly purpose: string;
  /** 이 플러그인이 나온 원본 항목들의 `itemId` */
  readonly derivedFrom: readonly string[];
}
const MigrationPlannedPluginShape = closed({
  name: Name,
  purpose: Purpose,
  derivedFrom: Type.Array(Id, { maxItems: 512 }),
});
export const MigrationPlannedPluginSchema: TUnsafe<MigrationPlannedPlugin> =
  Type.Unsafe<MigrationPlannedPlugin>(
    MigrationPlannedPluginShape satisfies SchemaProof<
      MigrationPlannedPlugin,
      typeof MigrationPlannedPluginShape
    >,
  );

/** 프로필 제안 하나. `pluginNames`는 이 프로필에 넣자고 제안하는 플러그인 이름이다 */
export interface MigrationProfileProposal {
  readonly name: string;
  readonly pluginNames: readonly string[];
  readonly scope: MigrationProfileScope;
}
const MigrationProfileProposalShape = closed({
  name: Name,
  pluginNames: Type.Array(Name, { maxItems: 512 }),
  scope: ProfileScopeShape,
});
export const MigrationProfileProposalSchema: TUnsafe<MigrationProfileProposal> =
  Type.Unsafe<MigrationProfileProposal>(
    MigrationProfileProposalShape satisfies SchemaProof<
      MigrationProfileProposal,
      typeof MigrationProfileProposalShape
    >,
  );

// ── 메서드 ──────────────────────────────────────────────────────────────

export interface MigrationDetectParams {
  readonly workspace: string;
}
const MigrationDetectParamsShape = request({ workspace: Path });
export const MigrationDetectParamsSchema: TUnsafe<Req<MigrationDetectParams>> = Type.Unsafe<
  Req<MigrationDetectParams>
>(
  MigrationDetectParamsShape satisfies SchemaProof<
    Req<MigrationDetectParams>,
    typeof MigrationDetectParamsShape
  >,
);
export interface MigrationDetectResult {
  readonly found: readonly ForeignFormatFound[];
  /** 표지가 하나도 없으면 null */
  readonly notice: ForeignFormatNotice | null;
}
const MigrationDetectResultShape = closed({
  found: Type.Array(ForeignFormatFoundShape, { maxItems: 64 }),
  notice: Type.Union([ForeignFormatNoticeShape, Type.Null()]),
});
export const MigrationDetectResultSchema: TUnsafe<MigrationDetectResult> =
  Type.Unsafe<MigrationDetectResult>(
    MigrationDetectResultShape satisfies SchemaProof<
      MigrationDetectResult,
      typeof MigrationDetectResultShape
    >,
  );

export interface MigrationScanParams {
  readonly roots: readonly MigrationScanRoot[];
}
const MigrationScanParamsShape = request({
  roots: Type.Array(MigrationScanRootShape, { minItems: 1, maxItems: 64 }),
});
export const MigrationScanParamsSchema: TUnsafe<Req<MigrationScanParams>> = Type.Unsafe<
  Req<MigrationScanParams>
>(
  MigrationScanParamsShape satisfies SchemaProof<
    Req<MigrationScanParams>,
    typeof MigrationScanParamsShape
  >,
);
export interface MigrationScanResult {
  readonly scanId: string;
  readonly summary: { readonly itemCount: number };
  readonly items: readonly MigrationScanItem[];
  readonly diagnostics: readonly MigrationScanDiagnostic[];
}
const MigrationScanResultShape = closed({
  scanId: Id,
  summary: closed({ itemCount: Count }),
  items: Type.Array(MigrationScanItemShape, { maxItems: 4096 }),
  diagnostics: Type.Array(MigrationScanDiagnosticShape, { maxItems: 512 }),
});
export const MigrationScanResultSchema: TUnsafe<MigrationScanResult> =
  Type.Unsafe<MigrationScanResult>(
    MigrationScanResultShape satisfies SchemaProof<
      MigrationScanResult,
      typeof MigrationScanResultShape
    >,
  );

export interface MigrationProposalParams {
  readonly scanId: string;
  readonly choices?: MigrationChoices;
}
const MigrationProposalParamsShape = request({
  scanId: Id,
  choices: Type.Optional(MigrationChoicesShape),
});
export const MigrationProposalParamsSchema: TUnsafe<Req<MigrationProposalParams>> = Type.Unsafe<
  Req<MigrationProposalParams>
>(
  MigrationProposalParamsShape satisfies SchemaProof<
    Req<MigrationProposalParams>,
    typeof MigrationProposalParamsShape
  >,
);
export interface MigrationProposalResult {
  readonly proposalId: string;
  readonly plugins: readonly MigrationPlannedPlugin[];
  readonly profileProposals: readonly MigrationProfileProposal[];
  readonly questions: readonly MigrationQuestion[];
  readonly report: readonly MigrationReportLine[];
}
const MigrationProposalResultShape = closed({
  proposalId: Id,
  plugins: Type.Array(MigrationPlannedPluginShape, { maxItems: 512 }),
  profileProposals: Type.Array(MigrationProfileProposalShape, { maxItems: 256 }),
  questions: Type.Array(MigrationQuestionShape, { maxItems: 512 }),
  report: Type.Array(MigrationReportLineShape, { maxItems: 4096 }),
});
export const MigrationProposalResultSchema: TUnsafe<MigrationProposalResult> =
  Type.Unsafe<MigrationProposalResult>(
    MigrationProposalResultShape satisfies SchemaProof<
      MigrationProposalResult,
      typeof MigrationProposalResultShape
    >,
  );

export interface MigrationApplyParams {
  readonly proposalId: string;
  readonly choices: MigrationChoices;
  /** 만들 프로필의 이름(`profileProposals[].name`). 없으면 프로필은 만들지 않는다 */
  readonly createProfiles?: readonly string[];
}
const MigrationApplyParamsShape = request({
  proposalId: Id,
  choices: MigrationChoicesShape,
  createProfiles: Type.Optional(Type.Array(Name, { maxItems: 256 })),
});
export const MigrationApplyParamsSchema: TUnsafe<Req<MigrationApplyParams>> = Type.Unsafe<
  Req<MigrationApplyParams>
>(
  MigrationApplyParamsShape satisfies SchemaProof<
    Req<MigrationApplyParams>,
    typeof MigrationApplyParamsShape
  >,
);
export interface MigrationApplyResult {
  readonly drafts: readonly {
    readonly name: string;
    readonly draftId: string;
    readonly itemId: string;
  }[];
  readonly profiles: readonly { readonly profileId: string; readonly name: string }[];
  readonly reportId: string;
}
const MigrationApplyResultShape = closed({
  drafts: Type.Array(closed({ name: Name, draftId: Id, itemId: Id }), { maxItems: 512 }),
  profiles: Type.Array(closed({ profileId: Id, name: Name }), { maxItems: 256 }),
  reportId: Id,
});
export const MigrationApplyResultSchema: TUnsafe<MigrationApplyResult> =
  Type.Unsafe<MigrationApplyResult>(
    MigrationApplyResultShape satisfies SchemaProof<
      MigrationApplyResult,
      typeof MigrationApplyResultShape
    >,
  );

export interface MigrationReportGetParams {
  readonly reportId: string;
}
const MigrationReportGetParamsShape = request({ reportId: Id });
export const MigrationReportGetParamsSchema: TUnsafe<Req<MigrationReportGetParams>> = Type.Unsafe<
  Req<MigrationReportGetParams>
>(
  MigrationReportGetParamsShape satisfies SchemaProof<
    Req<MigrationReportGetParams>,
    typeof MigrationReportGetParamsShape
  >,
);
export interface MigrationReportGetResult {
  readonly report: readonly MigrationReportLine[];
  /** 규칙 이름(원본 하네스)마다 그 규칙이 읽은 원본 문서의 날짜·버전 */
  readonly rulesVersions: Readonly<Record<string, string>>;
}
const MigrationReportGetResultShape = closed({
  report: Type.Array(MigrationReportLineShape, { maxItems: 4096 }),
  rulesVersions: Type.Record(Type.String({ maxLength: 64 }), Type.String({ maxLength: 64 })),
});
export const MigrationReportGetResultSchema: TUnsafe<MigrationReportGetResult> =
  Type.Unsafe<MigrationReportGetResult>(
    MigrationReportGetResultShape satisfies SchemaProof<
      MigrationReportGetResult,
      typeof MigrationReportGetResultShape
    >,
  );

/** 표지 하나를 다시 띄우지 않는다. `root`는 프로젝트 루트 절대 경로, `marker`는 표지의 상대 경로다 */
export interface MigrationDismissParams {
  readonly root: string;
  readonly marker: string;
}
const MigrationDismissParamsShape = request({ root: Path, marker: Marker });
export const MigrationDismissParamsSchema: TUnsafe<Req<MigrationDismissParams>> = Type.Unsafe<
  Req<MigrationDismissParams>
>(
  MigrationDismissParamsShape satisfies SchemaProof<
    Req<MigrationDismissParams>,
    typeof MigrationDismissParamsShape
  >,
);

// ── 알림 ────────────────────────────────────────────────────────────────

/** 알림 `migration.progress`: 훑기가 `done`개를 마쳤다(전체 `total`개). `migration.scan`의 진행이다 */
export interface MigrationProgressParams {
  readonly scanId: string;
  readonly done: number;
  readonly total: number;
}
const MigrationProgressParamsShape = closed({ scanId: Id, done: Count, total: Count });
export const MigrationProgressParamsSchema: TUnsafe<MigrationProgressParams> =
  Type.Unsafe<MigrationProgressParams>(
    MigrationProgressParamsShape satisfies SchemaProof<
      MigrationProgressParams,
      typeof MigrationProgressParamsShape
    >,
  );

/** 알림 `migration.changed`: 가져오기 상태가 바뀌었다. 종류에 따라 다시 읽는다 */
export interface MigrationChangedParams {
  readonly kind: MigrationChangeKind;
}
const MigrationChangedParamsShape = closed({ kind: ChangeKindShape });
export const MigrationChangedParamsSchema: TUnsafe<MigrationChangedParams> =
  Type.Unsafe<MigrationChangedParams>(
    MigrationChangedParamsShape satisfies SchemaProof<
      MigrationChangedParams,
      typeof MigrationChangedParamsShape
    >,
  );

// ── 등록 ────────────────────────────────────────────────────────────────

type U<T> = TUnsafe<T>;
export interface MigrationWireSchemas {
  "migration.detect": Io<U<Req<MigrationDetectParams>>, U<MigrationDetectResult>>;
  "migration.scan": Io<U<Req<MigrationScanParams>>, U<MigrationScanResult>>;
  "migration.proposal": Io<U<Req<MigrationProposalParams>>, U<MigrationProposalResult>>;
  "migration.apply": Io<U<Req<MigrationApplyParams>>, U<MigrationApplyResult>>;
  "migration.report.get": Io<U<Req<MigrationReportGetParams>>, U<MigrationReportGetResult>>;
  /** 빈 결과(`{}`). methods.ts의 `EmptyResultSchema`와 같은 스키마다 */
  "migration.dismiss": Io<U<Req<MigrationDismissParams>>, typeof EmptyParamsSchema>;
}
type Table = {
  readonly [M in keyof MigrationWireSchemas]: M4Spec<
    MigrationWireSchemas[M]["params"],
    MigrationWireSchemas[M]["result"]
  >;
};
export const MIGRATION_WIRE_METHODS: Table = {
  "migration.detect": m4(MigrationDetectParamsSchema, MigrationDetectResultSchema),
  "migration.scan": m4(MigrationScanParamsSchema, MigrationScanResultSchema),
  "migration.proposal": m4(MigrationProposalParamsSchema, MigrationProposalResultSchema),
  "migration.apply": m4(MigrationApplyParamsSchema, MigrationApplyResultSchema),
  "migration.report.get": m4(MigrationReportGetParamsSchema, MigrationReportGetResultSchema),
  "migration.dismiss": m4(MigrationDismissParamsSchema, EmptyParamsSchema),
};
