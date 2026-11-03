import { Type, type TUnsafe } from "typebox";
import type {
  AppDecl,
  CompositionDecl,
  ManifestIssue,
  Placement,
  PluginDecl,
  RegistrationStatus,
  UiMode,
  UiNode,
} from "../../extensions/index.ts";
import {
  AppDeclSchema,
  CompositionDeclSchema,
  PluginDeclSchema,
  UiNodeSchema,
} from "../../extensions/index.ts";
import type { SchemaProof } from "../../base/index.ts";
import { closed, request, type Req } from "./schema-kit.ts";

// F.wire-settings.spec §3.3.4(M4 확장 읽기). L4.desktop-ux.spec §10.1 W-15, W-20~W-26, W-31, W-33, W-35~W-42, W-47.
// 행 단위는 확장이고 Registration(플러그인 하나)은 그 아래 `plugins`, `registrationId`로 나온다(ADR-0022 §3.2).
// 모든 id는 문자열이다(브랜드는 호스트 쪽 경계에서 만든다). 시각은 IsoTime 문자열이다.

const Name = Type.String({ minLength: 1, maxLength: 96 });
const Id = Type.String({ minLength: 1, maxLength: 128 });
const Iso = Type.String({ minLength: 1, maxLength: 40 });
const Count = Type.Integer({ minimum: 0 });
const Ms = Type.Number({ minimum: 0 });
const Line = Type.String({ maxLength: 2000 });
const ThreadRef = Type.String({ minLength: 1, maxLength: 64 });
const RegistrationStatusShape = Type.Union([
  Type.Literal("enabled"),
  Type.Literal("enabling"),
  Type.Literal("disabled"),
  Type.Literal("disabling"),
]);
/** 켜짐 요청이 어느 층에서 왔는가(T-REG §7 5번). 화면은 "전역 / 프로젝트 / 이 대화" 배지로 보인다 */
export const ENABLED_SOURCES = ["managed", "thread", "project", "user", "default"] as const;
export type EnabledSource = (typeof ENABLED_SOURCES)[number];
const EnabledSourceShape = Type.Union(ENABLED_SOURCES.map((name) => Type.Literal(name)));

/** 확장이 실린 위치의 종류(`ext.list`의 `origin`). 프로젝트 확장은 신뢰 판정을 거친 작업 폴더 것이다 */
export const EXT_ORIGINS = ["builtin", "managed", "user", "project"] as const;
export type ExtOrigin = (typeof EXT_ORIGINS)[number];
const ExtOriginShape = Type.Union(EXT_ORIGINS.map((name) => Type.Literal(name)));

/** 진단 한 건. 로더가 읽은 위치(W-38)를 `file`, `line`으로 싣는다 */
export interface ExtDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
}
const DiagnosticShape = closed({
  severity: Type.Union([Type.Literal("error"), Type.Literal("warning")]),
  code: Name,
  message: Line,
  file: Type.Optional(Type.String({ maxLength: 1024 })),
  line: Type.Optional(Type.Integer({ minimum: 1 })),
});
const ExtDiagnosticShape2 = DiagnosticShape;
export const ExtDiagnosticSchema: TUnsafe<ExtDiagnostic> = Type.Unsafe<ExtDiagnostic>(
  ExtDiagnosticShape2 satisfies SchemaProof<ExtDiagnostic, typeof ExtDiagnosticShape2>,
);

/**
 * `ext.list`의 Registration 한 줄. 플러그인 하나가 Registration 하나다(`registrationId`는 F.extensions.spec §3.1의 규칙).
 * `thread`는 요청에 `threadId`가 있을 때만 있고 그 대화에서의 상태다
 */
export interface ExtListPlugin {
  readonly registrationId: string;
  /** 루트 플러그인이면 없다 */
  readonly id?: string;
  readonly layer: string;
  readonly status: RegistrationStatus;
  readonly thread?: RegistrationStatus;
  /** 플러그인 그룹의 구성원이면 참(`group`이 없는 확장은 모두 거짓) */
  readonly inGroup: boolean;
  readonly enabledSource?: EnabledSource;
}
const ExtListPluginShape = closed({
  registrationId: Type.String({ minLength: 1, maxLength: 65 }),
  id: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
  layer: Type.String({ minLength: 1, maxLength: 16 }),
  status: RegistrationStatusShape,
  thread: Type.Optional(RegistrationStatusShape),
  inGroup: Type.Boolean(),
  enabledSource: Type.Optional(EnabledSourceShape),
});

/**
 * `ext.list` 한 행(W-15, W-41). 행은 확장 하나이고 Registration은 `plugins` 아래에 있다.
 * `status`는 대표 Registration(루트 플러그인, 없으면 첫 플러그인)의 상태이고 `registration`은 `threadId`를 줬을 때 그 Registration의 대화 상태다
 */
export interface ExtListEntry {
  readonly name: string;
  readonly displayName: string;
  /** 유효 층(`effectiveLayer`): 플러그인 층 가운데 가장 높은 층 */
  readonly layer: string;
  /** `group` 선언이 있으면 참. 행 종류는 `ext.kinds`의 `plugin-group` / `single-plugin`과 같다 */
  readonly isGroup: boolean;
  readonly version: string;
  readonly location: string;
  /**
   * 어디서 실린 확장인가. `builtin`은 호스트 단위, `managed`·`user`·`project`는 로더가 찾은 위치다.
   * 호스트는 항상 채운다(없으면 옛 호스트)
   */
  readonly origin?: ExtOrigin;
  readonly requestedGrade: string;
  readonly effectiveGrade: string;
  readonly tier: string | null;
  readonly status: RegistrationStatus;
  readonly registration?: RegistrationStatus;
  /** 대표 Registration의 켜짐 요청 출처. 없으면 호스트가 아직 채우지 않는다 */
  readonly enabledSource?: EnabledSource;
  readonly plugins: readonly ExtListPlugin[];
  readonly diagnostics: readonly ExtDiagnostic[];
  readonly autoDisabled: boolean;
  /** 안전 모드에서 실리지 않은 이유. 실렸으면 null */
  readonly safeModeExcluded: string | null;
  /** 모든 플러그인의 Hook 수 */
  readonly hookCount: number;
}
const ExtListEntryShape = closed({
  name: Name,
  displayName: Name,
  layer: Type.String({ minLength: 1, maxLength: 16 }),
  isGroup: Type.Boolean(),
  version: Type.String({ minLength: 1, maxLength: 64 }),
  location: Type.String({ maxLength: 4096 }),
  origin: Type.Optional(ExtOriginShape),
  requestedGrade: Type.String({ maxLength: 32 }),
  effectiveGrade: Type.String({ maxLength: 32 }),
  tier: Type.Union([Type.String({ maxLength: 32 }), Type.Null()]),
  status: RegistrationStatusShape,
  registration: Type.Optional(RegistrationStatusShape),
  enabledSource: Type.Optional(EnabledSourceShape),
  plugins: Type.Array(ExtListPluginShape, { minItems: 1, maxItems: 16 }),
  diagnostics: Type.Array(DiagnosticShape, { maxItems: 200 }),
  autoDisabled: Type.Boolean(),
  safeModeExcluded: Type.Union([Line, Type.Null()]),
  hookCount: Count,
});
const ExtListEntryShape2 = ExtListEntryShape;
export const ExtListEntrySchema: TUnsafe<ExtListEntry> = Type.Unsafe<ExtListEntry>(
  ExtListEntryShape2 satisfies SchemaProof<ExtListEntry, typeof ExtListEntryShape2>,
);

export interface ExtListParams {
  readonly threadId?: string;
}
const ExtListParamsShape2 = request({ threadId: Type.Optional(ThreadRef) });
export const ExtListParamsSchema: TUnsafe<Req<ExtListParams>> = Type.Unsafe<Req<ExtListParams>>(
  ExtListParamsShape2 satisfies SchemaProof<Req<ExtListParams>, typeof ExtListParamsShape2>,
);
export interface ExtListResult {
  readonly extensions: readonly ExtListEntry[];
}
const ExtListResultShape2 = closed({
  extensions: Type.Array(ExtListEntryShape, { maxItems: 500 }),
});
export const ExtListResultSchema: TUnsafe<ExtListResult> = Type.Unsafe<ExtListResult>(
  ExtListResultShape2 satisfies SchemaProof<ExtListResult, typeof ExtListResultShape2>,
);

/** `ext.get`(W-20) */
export interface ExtNameParams {
  readonly name: string;
}
const ExtNameParamsShape2 = request({ name: Name });
export const ExtNameParamsSchema: TUnsafe<Req<ExtNameParams>> = Type.Unsafe<Req<ExtNameParams>>(
  ExtNameParamsShape2 satisfies SchemaProof<Req<ExtNameParams>, typeof ExtNameParamsShape2>,
);
/** 플러그인이 건 Hook 하나와 그 예산 */
export interface ExtHookInfo {
  readonly registrationId: string;
  readonly hook: string;
  readonly budgetClass: string;
  readonly budgetMs: number;
}
const HookInfoShape = closed({ registrationId: Name, hook: Name, budgetClass: Name, budgetMs: Ms });
/** Registration 단위 기능 엣지. `peer`는 맞은편 Registration id다 */
export interface ExtBindingEdge {
  readonly registrationId: string;
  readonly capability: string;
  readonly relation: "provides" | "requires" | "optional";
  readonly peer: string | null;
  readonly satisfied: boolean;
}
const BindingEdgeShape = closed({
  registrationId: Name,
  capability: Name,
  relation: Type.Union([
    Type.Literal("provides"),
    Type.Literal("requires"),
    Type.Literal("optional"),
  ]),
  peer: Type.Union([Name, Type.Null()]),
  satisfied: Type.Boolean(),
});
export interface ExtGetResult {
  readonly entry: ExtListEntry;
  /** 검사를 통과한 매니페스트 JSON */
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly hooks: readonly ExtHookInfo[];
  readonly bindings: readonly ExtBindingEdge[];
}
const ExtGetResultShape2 = closed({
  entry: ExtListEntryShape,
  manifest: Type.Record(Type.String(), Type.Unknown()),
  hooks: Type.Array(HookInfoShape, { maxItems: 1024 }),
  bindings: Type.Array(BindingEdgeShape, { maxItems: 256 }),
});
export const ExtGetResultSchema: TUnsafe<ExtGetResult> = Type.Unsafe<ExtGetResult>(
  ExtGetResultShape2 satisfies SchemaProof<ExtGetResult, typeof ExtGetResultShape2>,
);

/** `ext.reenable`(W-21), `ext.reload`(W-38) 공통 result */
export interface ExtAppliedResult {
  readonly appliesAt: "nextStepBoundary" | "now";
  readonly diagnostics: readonly ExtDiagnostic[];
}
const ExtAppliedResultShape2 = closed({
  appliesAt: Type.Union([Type.Literal("nextStepBoundary"), Type.Literal("now")]),
  diagnostics: Type.Array(DiagnosticShape, { maxItems: 200 }),
});
export const ExtAppliedResultSchema: TUnsafe<ExtAppliedResult> = Type.Unsafe<ExtAppliedResult>(
  ExtAppliedResultShape2 satisfies SchemaProof<ExtAppliedResult, typeof ExtAppliedResultShape2>,
);

/** `ext.health`(W-22) */
export interface ExtHealthParams {
  readonly name?: string;
  readonly threadId?: string;
}
const ExtHealthParamsShape2 = request({
  name: Type.Optional(Name),
  threadId: Type.Optional(ThreadRef),
});
export const ExtHealthParamsSchema: TUnsafe<Req<ExtHealthParams>> = Type.Unsafe<
  Req<ExtHealthParams>
>(ExtHealthParamsShape2 satisfies SchemaProof<Req<ExtHealthParams>, typeof ExtHealthParamsShape2>);
/** 실패 장부는 Registration 단위다(자동 끔이 Registration마다 걸린다) */
export interface ExtHealthEntry {
  readonly name: string;
  readonly registrationId: string;
  readonly consecutiveFailures: number;
  readonly windowFailures: number;
  /**
   * 실패 장부 창이 덮는 시간(ms): 창 안의 가장 오래된 호출부터 지금까지. 장부의 창은 시간이 아니라 최근 호출 수
   * (`x.operations.autoDisable.windowSize`)라서 이 값은 호출이 얼마나 뜸한지에 따라 변한다. 창에 호출이 없으면 0.
   * 비율은 `windowFailures / windowCalls`(호출당)나 `windowFailures / windowMs`(시간당)로 계산한다
   */
  readonly windowMs: number;
  /** 창 안의 호출 수. 호스트는 항상 채운다 */
  readonly windowCalls?: number;
  readonly autoDisabled: boolean;
  readonly lastFailureAt: string | null;
  readonly lastError: string | null;
}
const HealthEntryShape = closed({
  name: Name,
  registrationId: Name,
  consecutiveFailures: Count,
  windowFailures: Count,
  windowMs: Ms,
  windowCalls: Type.Optional(Count),
  autoDisabled: Type.Boolean(),
  lastFailureAt: Type.Union([Iso, Type.Null()]),
  lastError: Type.Union([Line, Type.Null()]),
});
export interface ExtHealthResult {
  readonly health: readonly ExtHealthEntry[];
}
const ExtHealthResultShape2 = closed({ health: Type.Array(HealthEntryShape, { maxItems: 500 }) });
export const ExtHealthResultSchema: TUnsafe<ExtHealthResult> = Type.Unsafe<ExtHealthResult>(
  ExtHealthResultShape2 satisfies SchemaProof<ExtHealthResult, typeof ExtHealthResultShape2>,
);

/** `ext.timings`(W-23). 원천은 핸들러 계측(X-15)이고 `TraceReadPort.timings`가 같은 값을 준다 */
export interface ExtTimingsParams {
  readonly name: string;
  readonly threadId?: string;
}
const ExtTimingsParamsShape2 = request({ name: Name, threadId: Type.Optional(ThreadRef) });
export const ExtTimingsParamsSchema: TUnsafe<Req<ExtTimingsParams>> = Type.Unsafe<
  Req<ExtTimingsParams>
>(
  ExtTimingsParamsShape2 satisfies SchemaProof<
    Req<ExtTimingsParams>,
    typeof ExtTimingsParamsShape2
  >,
);
/** `group.list`(W-24) */
export interface GroupListParams {
  readonly threadId?: string;
}
const GroupListParamsShape2 = request({ threadId: Type.Optional(ThreadRef) });
export const GroupListParamsSchema: TUnsafe<Req<GroupListParams>> = Type.Unsafe<
  Req<GroupListParams>
>(GroupListParamsShape2 satisfies SchemaProof<Req<GroupListParams>, typeof GroupListParamsShape2>);
export interface GroupMetricsSummaryWire {
  readonly denies: number;
  readonly posts: number;
  readonly spawns: number;
  readonly delegates: number;
  readonly costUsd: number;
  readonly leaseMs: number;
}
const MetricsSummaryShape = closed({
  denies: Count,
  posts: Count,
  spawns: Count,
  delegates: Count,
  costUsd: Ms,
  leaseMs: Ms,
});
export interface GroupStatusWire {
  readonly id: string;
  readonly displayName: string;
  readonly scope: RegistrationStatus;
  readonly pendingToggle: "enable" | "disable" | null;
  readonly usesDrive: boolean;
  readonly drive: "holder" | "waiting" | "none" | "error" | "rejected";
  readonly lastError: { readonly kind: string; readonly message: string } | null;
  readonly metrics: GroupMetricsSummaryWire | null;
}
const GroupStatusShape = closed({
  id: Name,
  displayName: Name,
  scope: RegistrationStatusShape,
  pendingToggle: Type.Union([Type.Literal("enable"), Type.Literal("disable"), Type.Null()]),
  usesDrive: Type.Boolean(),
  drive: Type.Union([
    Type.Literal("holder"),
    Type.Literal("waiting"),
    Type.Literal("none"),
    Type.Literal("error"),
    Type.Literal("rejected"),
  ]),
  lastError: Type.Union([closed({ kind: Name, message: Line }), Type.Null()]),
  metrics: Type.Union([MetricsSummaryShape, Type.Null()]),
});
export interface GroupListResult {
  readonly groups: readonly GroupStatusWire[];
}
const GroupListResultShape2 = closed({ groups: Type.Array(GroupStatusShape, { maxItems: 500 }) });
export const GroupListResultSchema: TUnsafe<GroupListResult> = Type.Unsafe<GroupListResult>(
  GroupListResultShape2 satisfies SchemaProof<GroupListResult, typeof GroupListResultShape2>,
);

/** `group.metrics`(W-25) */
export interface GroupMetricsParams {
  readonly id: string;
  readonly threadId?: string;
  readonly since?: string;
}
const GroupMetricsParamsShape2 = request({
  id: Name,
  threadId: Type.Optional(ThreadRef),
  since: Type.Optional(Iso),
});
export const GroupMetricsParamsSchema: TUnsafe<Req<GroupMetricsParams>> = Type.Unsafe<
  Req<GroupMetricsParams>
>(
  GroupMetricsParamsShape2 satisfies SchemaProof<
    Req<GroupMetricsParams>,
    typeof GroupMetricsParamsShape2
  >,
);
export interface GroupMetricsFull {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
  readonly leaseMs: number;
  readonly leases: number;
  readonly denies: number;
  readonly chainPatches: number;
  readonly handlerErrors: number;
  readonly posts: number;
  readonly spawns: number;
  readonly delegates: number;
  readonly commits: number;
  readonly records: number;
}
const MetricsFullShape = closed({
  inputTokens: Count,
  outputTokens: Count,
  cacheReadTokens: Count,
  cacheWriteTokens: Count,
  costUsd: Ms,
  leaseMs: Ms,
  leases: Count,
  denies: Count,
  chainPatches: Count,
  handlerErrors: Count,
  posts: Count,
  spawns: Count,
  delegates: Count,
  commits: Count,
  records: Count,
});
export interface GroupMetricsResult {
  readonly id: string;
  /** 계측이 꺼져 있으면(`l3.group-kit.instrumentation = false`) null */
  readonly metrics: GroupMetricsFull | null;
  readonly since: string | null;
  /**
   * `since`를 지킬 수 없는 지표 이름. `since`가 없으면 빈 배열이다. 이벤트에서 접는 값(`leases`, `leaseMs`)은 `since`를 지키고,
   * 프로세스 메모리 카운터에서 오는 값(토큰, `denies`, `posts` 같은 개수)은 프로세스가 뜬 뒤의 누계라 지키지 않는다.
   * `costUsd`는 둘의 합이라 지키지 않는다. 호스트는 항상 채운다
   */
  readonly sinceIgnoredBy?: readonly string[];
}
const GroupMetricsResultShape2 = closed({
  id: Name,
  metrics: Type.Union([MetricsFullShape, Type.Null()]),
  since: Type.Union([Iso, Type.Null()]),
  sinceIgnoredBy: Type.Optional(Type.Array(Name, { maxItems: 32 })),
});
export const GroupMetricsResultSchema: TUnsafe<GroupMetricsResult> =
  Type.Unsafe<GroupMetricsResult>(
    GroupMetricsResultShape2 satisfies SchemaProof<
      GroupMetricsResult,
      typeof GroupMetricsResultShape2
    >,
  );

/** `group.promotion`(W-26) */
export interface GroupPromotionParams {
  readonly threadIds?: readonly string[];
}
const GroupPromotionParamsShape2 = request({
  threadIds: Type.Optional(Type.Array(ThreadRef, { maxItems: 200 })),
});
export const GroupPromotionParamsSchema: TUnsafe<Req<GroupPromotionParams>> = Type.Unsafe<
  Req<GroupPromotionParams>
>(
  GroupPromotionParamsShape2 satisfies SchemaProof<
    Req<GroupPromotionParams>,
    typeof GroupPromotionParamsShape2
  >,
);
export interface PromotionCandidate {
  readonly tool: string;
  readonly owner: string;
  readonly consumers: readonly string[];
  readonly userCalls: number;
}
const PromotionCandidateShape = closed({
  tool: Name,
  owner: Name,
  consumers: Type.Array(Name, { maxItems: 64 }),
  userCalls: Count,
});
export interface GroupPromotionResult {
  readonly throughSeq: number;
  readonly threads: number;
  readonly candidates: readonly PromotionCandidate[];
}
const GroupPromotionResultShape2 = closed({
  throughSeq: Count,
  threads: Count,
  candidates: Type.Array(PromotionCandidateShape, { maxItems: 200 }),
});
export const GroupPromotionResultSchema: TUnsafe<GroupPromotionResult> =
  Type.Unsafe<GroupPromotionResult>(
    GroupPromotionResultShape2 satisfies SchemaProof<
      GroupPromotionResult,
      typeof GroupPromotionResultShape2
    >,
  );

/** `group.driveLock`(W-42). 옛 이름 `group.lease`(저장 이름 `lease.*`는 그대로) */
export interface GroupDriveLockParams {
  readonly threadId: string;
}
const GroupDriveLockParamsShape2 = request({ threadId: ThreadRef });
export const GroupDriveLockParamsSchema: TUnsafe<Req<GroupDriveLockParams>> = Type.Unsafe<
  Req<GroupDriveLockParams>
>(
  GroupDriveLockParamsShape2 satisfies SchemaProof<
    Req<GroupDriveLockParams>,
    typeof GroupDriveLockParamsShape2
  >,
);
export interface DriveLockWait {
  /** 기다리는 Registration id */
  readonly registrationId: string;
  /** 거절·양보로 기다린 횟수. 사유 `waiting`(loop.ask) 반납 중에는 세지 않는다 */
  readonly waits: number;
  /** `leaseWaitLimit`. 넘으면 거부된다 */
  readonly waitLimit: number;
}
const DriveLockWaitShape = closed({ registrationId: Name, waits: Count, waitLimit: Count });
/** drive lock 요청이 대기 상한 뒤 거부된 가장 최근 기록(`lease.rejected`) */
export interface DriveLockRejection {
  readonly groupId: string;
  readonly reason: string;
  readonly requestSeq: number;
}
const DriveLockRejectionShape = closed({ groupId: Name, reason: Line, requestSeq: Count });
export interface GroupDriveLockResult {
  /** drive lock을 가진 Registration id. 없으면 null */
  readonly holder: string | null;
  readonly leaseEpoch: number;
  /** 설정 `x.primitives.activeDriver`의 값. 없으면 null(자동 중재) */
  readonly activeDriver: string | null;
  readonly limits: {
    readonly turns: number;
    readonly spawns: number;
    readonly tokens: number | null;
  };
  readonly used: { readonly turns: number; readonly spawns: number; readonly tokens: number };
  readonly candidates: readonly DriveLockWait[];
  readonly lastRejected: DriveLockRejection | null;
}
const GroupDriveLockResultShape2 = closed({
  holder: Type.Union([Name, Type.Null()]),
  leaseEpoch: Count,
  activeDriver: Type.Union([Name, Type.Null()]),
  limits: closed({ turns: Count, spawns: Count, tokens: Type.Union([Count, Type.Null()]) }),
  used: closed({ turns: Count, spawns: Count, tokens: Count }),
  candidates: Type.Array(DriveLockWaitShape, { maxItems: 64 }),
  lastRejected: Type.Union([DriveLockRejectionShape, Type.Null()]),
});
export const GroupDriveLockResultSchema: TUnsafe<GroupDriveLockResult> =
  Type.Unsafe<GroupDriveLockResult>(
    GroupDriveLockResultShape2 satisfies SchemaProof<
      GroupDriveLockResult,
      typeof GroupDriveLockResultShape2
    >,
  );

/** `ext.versions`(W-31), `ext.rollback` */
export interface ExtVersionEntry {
  readonly version: string;
  readonly installedAt: string;
  readonly source: "bundled" | "user" | "authored";
  readonly manifestHash: string;
  readonly stateSchemaVersion: number | null;
  readonly current: boolean;
}
const VersionEntryShape = closed({
  version: Type.String({ minLength: 1, maxLength: 64 }),
  installedAt: Iso,
  source: Type.Union([Type.Literal("bundled"), Type.Literal("user"), Type.Literal("authored")]),
  manifestHash: Type.String({ minLength: 1, maxLength: 128 }),
  stateSchemaVersion: Type.Union([Count, Type.Null()]),
  current: Type.Boolean(),
});
export interface ExtVersionsResult {
  readonly versions: readonly ExtVersionEntry[];
}
const ExtVersionsResultShape2 = closed({
  versions: Type.Array(VersionEntryShape, { maxItems: 100 }),
});
export const ExtVersionsResultSchema: TUnsafe<ExtVersionsResult> = Type.Unsafe<ExtVersionsResult>(
  ExtVersionsResultShape2 satisfies SchemaProof<ExtVersionsResult, typeof ExtVersionsResultShape2>,
);
export interface ExtRollbackParams {
  readonly name: string;
  readonly version: string;
  /** 내려가는 마이그레이션이 없을 때 상태를 비우고 되돌린다 */
  readonly clearState?: boolean;
}
const ExtRollbackParamsShape2 = request({
  name: Name,
  version: Type.String({ minLength: 1, maxLength: 64 }),
  clearState: Type.Optional(Type.Boolean()),
});
export const ExtRollbackParamsSchema: TUnsafe<Req<ExtRollbackParams>> = Type.Unsafe<
  Req<ExtRollbackParams>
>(
  ExtRollbackParamsShape2 satisfies SchemaProof<
    Req<ExtRollbackParams>,
    typeof ExtRollbackParamsShape2
  >,
);
export interface ExtRollbackResult {
  readonly appliesAt: "nextStepBoundary" | "restart";
  readonly stateCleared: boolean;
}
const ExtRollbackResultShape2 = closed({
  appliesAt: Type.Union([Type.Literal("nextStepBoundary"), Type.Literal("restart")]),
  stateCleared: Type.Boolean(),
});
export const ExtRollbackResultSchema: TUnsafe<ExtRollbackResult> = Type.Unsafe<ExtRollbackResult>(
  ExtRollbackResultShape2 satisfies SchemaProof<ExtRollbackResult, typeof ExtRollbackResultShape2>,
);

/** `ext.ui.list`(W-33). 옛 이름 `ext.view.list` */
export interface ExtUiListParams {
  readonly threadId?: string;
}
const ExtUiListParamsShape2 = request({ threadId: Type.Optional(ThreadRef) });
export const ExtUiListParamsSchema: TUnsafe<Req<ExtUiListParams>> = Type.Unsafe<
  Req<ExtUiListParams>
>(ExtUiListParamsShape2 satisfies SchemaProof<Req<ExtUiListParams>, typeof ExtUiListParamsShape2>);
export interface ExtUiEntry {
  readonly extension: string;
  readonly id: string;
  readonly placement: Placement;
  readonly mode: UiMode;
  readonly title: string;
  readonly state: "ok" | "invalid" | "disabled";
  /** 엔진이 검사한 화면 트리. `app` 모드면 없다 */
  readonly tree?: UiNode;
  readonly app?: AppDecl;
  readonly issues: readonly ExtDiagnostic[];
}
const UiEntryShape = closed({
  extension: Name,
  id: Name,
  placement: Type.Union([
    Type.Literal("page"),
    Type.Literal("panel"),
    Type.Literal("card"),
    Type.Literal("status"),
    Type.Literal("command"),
    Type.Literal("settings"),
  ]),
  mode: Type.Union([Type.Literal("native"), Type.Literal("app")]),
  title: Type.String({ maxLength: 256 }),
  state: Type.Union([Type.Literal("ok"), Type.Literal("invalid"), Type.Literal("disabled")]),
  tree: Type.Optional(UiNodeSchema),
  app: Type.Optional(AppDeclSchema),
  issues: Type.Array(DiagnosticShape, { maxItems: 200 }),
});
export interface ExtUiListResult {
  readonly items: readonly ExtUiEntry[];
}
const ExtUiListResultShape2 = closed({ items: Type.Array(UiEntryShape, { maxItems: 500 }) });
export const ExtUiListResultSchema: TUnsafe<ExtUiListResult> = Type.Unsafe<ExtUiListResult>(
  ExtUiListResultShape2 satisfies SchemaProof<ExtUiListResult, typeof ExtUiListResultShape2>,
);

/** `ext.ui.post`, `ext.ui.requestApproval`(ADR-0021 §3.4). 옛 이름 `ext.view.post`, `ext.view.requestApproval` */
export interface ExtUiPostParams {
  readonly extension: string;
  readonly ui: string;
  /** 대화. 필수다. 화면은 대화를 바꿔도 남을 수 있어 "활성 대화"로 추정하지 않는다 */
  readonly threadId: string;
  readonly name: string;
  readonly payload?: unknown;
  /** 멱등 키(1~64자). 같은 키의 두 번째 호출은 큐에 넣지 않고 `accepted: true`를 돌려준다. 생략하면 호출마다 새 키다 */
  readonly requestId?: string;
}
const ExtUiPostParamsShape2 = request({
  extension: Name,
  ui: Name,
  threadId: ThreadRef,
  name: Name,
  payload: Type.Optional(Type.Unknown()),
  requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
});
export const ExtUiPostParamsSchema: TUnsafe<Req<ExtUiPostParams>> = Type.Unsafe<
  Req<ExtUiPostParams>
>(ExtUiPostParamsShape2 satisfies SchemaProof<Req<ExtUiPostParams>, typeof ExtUiPostParamsShape2>);
export interface ExtUiApprovalParams {
  readonly extension: string;
  readonly ui: string;
  /** 승인 카드가 뜰 대화. 필수다(`ExtUiPostParams.threadId`와 같은 이유) */
  readonly threadId: string;
  readonly method: string;
  readonly params?: unknown;
  /** 멱등 키(1~64자). 같은 키의 두 번째 호출은 새 승인을 만들지 않고 처음 승인의 id를 돌려준다. 생략하면 호출마다 새 승인이다 */
  readonly requestId?: string;
}
const ExtUiApprovalParamsShape2 = request({
  extension: Name,
  ui: Name,
  threadId: ThreadRef,
  method: Name,
  params: Type.Optional(Type.Unknown()),
  requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
});
export const ExtUiApprovalParamsSchema: TUnsafe<Req<ExtUiApprovalParams>> = Type.Unsafe<
  Req<ExtUiApprovalParams>
>(
  ExtUiApprovalParamsShape2 satisfies SchemaProof<
    Req<ExtUiApprovalParams>,
    typeof ExtUiApprovalParamsShape2
  >,
);
export interface ExtUiPostResult {
  readonly accepted: boolean;
}
const ExtUiPostResultShape2 = closed({ accepted: Type.Boolean() });
export const ExtUiPostResultSchema: TUnsafe<ExtUiPostResult> = Type.Unsafe<ExtUiPostResult>(
  ExtUiPostResultShape2 satisfies SchemaProof<ExtUiPostResult, typeof ExtUiPostResultShape2>,
);
export interface ExtUiApprovalResult {
  readonly approvalId: string;
}
const ExtUiApprovalResultShape2 = closed({ approvalId: Id });
export const ExtUiApprovalResultSchema: TUnsafe<ExtUiApprovalResult> =
  Type.Unsafe<ExtUiApprovalResult>(
    ExtUiApprovalResultShape2 satisfies SchemaProof<
      ExtUiApprovalResult,
      typeof ExtUiApprovalResultShape2
    >,
  );

/** `host.status.safeModeCause`의 값(W-35) */
export const SAFE_MODE_CAUSES = ["user", "startupFailures", "flag"] as const;
export type SafeModeCause = (typeof SAFE_MODE_CAUSES)[number];

/** `hooks.list`(W-36). 호스트 훅 레지스트리의 Hook 한 줄 */
export interface HookEntry {
  readonly hook: string;
  /** 훅 종류(first, chain, collect, tap, detached 같은 fold) */
  readonly fold: string;
  /** 이 Hook에 걸린 핸들러 수 */
  readonly handlers: number;
  /** 건 Registration id들(코어 핸들러는 제외) */
  readonly registrations: readonly string[];
  /** 외부(X) 훅이면 참 */
  readonly external: boolean;
  /**
   * 실제로 등록된 핸들러를 디스패치 순서(tier, 확장 로드 순서, 등록 순서, F.extensions.spec §4.2)로 센 목록에,
   * 핸들러가 없는(꺼졌거나 setup에 실패해 레지스트리에서 빠진) Registration이 선언한 Hook을 `tier: null`로 뒤에 붙인다
   * (`registrationId` 오름차순, 디스패치되지 않는다). `handlers`와 `registrations`는 이 목록에서 `tier`가 있는 행을 같은 순서로 센다.
   * 호스트는 항상 채운다(없으면 옛 호스트)
   */
  readonly order?: readonly HookHandlerRow[];
}
/** 훅 핸들러 하나. 순서는 배열 위치다 */
export interface HookHandlerRow {
  readonly registrationId: string;
  readonly extension: string;
  /** 디스패치 정렬의 첫째 키. 작을수록 먼저. 등록된 핸들러가 없는 행은 null */
  readonly tier: number | null;
  /** 그 Registration의 전역 상태. `disabled`이면 디스패치에서 빠진다 */
  readonly status: RegistrationStatus;
  /** Registration의 마지막 오류 코드(setup 실패 등). 없으면 null */
  readonly error: string | null;
}
const HookHandlerRowShape = closed({
  registrationId: Name,
  extension: Name,
  tier: Type.Union([Type.Integer(), Type.Null()]),
  status: RegistrationStatusShape,
  error: Type.Union([Line, Type.Null()]),
});
const HookEntryShape = closed({
  hook: Name,
  fold: Name,
  handlers: Count,
  registrations: Type.Array(Name, { maxItems: 256 }),
  external: Type.Boolean(),
  order: Type.Optional(Type.Array(HookHandlerRowShape, { maxItems: 256 })),
});
export interface HooksListResult {
  readonly hooks: readonly HookEntry[];
}
const HooksListResultShape2 = closed({ hooks: Type.Array(HookEntryShape, { maxItems: 500 }) });
export const HooksListResultSchema: TUnsafe<HooksListResult> = Type.Unsafe<HooksListResult>(
  HooksListResultShape2 satisfies SchemaProof<HooksListResult, typeof HooksListResultShape2>,
);

/** `ext.bindings`(W-40). 엣지는 Registration 단위다 */
export interface ExtBindingsParams {
  readonly threadId?: string;
}
const ExtBindingsParamsShape2 = request({ threadId: Type.Optional(ThreadRef) });
export const ExtBindingsParamsSchema: TUnsafe<Req<ExtBindingsParams>> = Type.Unsafe<
  Req<ExtBindingsParams>
>(
  ExtBindingsParamsShape2 satisfies SchemaProof<
    Req<ExtBindingsParams>,
    typeof ExtBindingsParamsShape2
  >,
);
export interface CapabilityBinding {
  readonly capability: string;
  readonly provider: { readonly registrationId: string; readonly version: string } | null;
  readonly consumers: readonly {
    readonly registrationId: string;
    readonly relation: "requires" | "optional";
  }[];
  readonly unmet: boolean;
}
const CapabilityBindingShape = closed({
  capability: Name,
  provider: Type.Union([closed({ registrationId: Name, version: Name }), Type.Null()]),
  consumers: Type.Array(
    closed({
      registrationId: Name,
      relation: Type.Union([Type.Literal("requires"), Type.Literal("optional")]),
    }),
    { maxItems: 256 },
  ),
  unmet: Type.Boolean(),
});
export interface ExtBindingsResult {
  readonly capabilities: readonly CapabilityBinding[];
}
const ExtBindingsResultShape2 = closed({
  capabilities: Type.Array(CapabilityBindingShape, { maxItems: 500 }),
});
export const ExtBindingsResultSchema: TUnsafe<ExtBindingsResult> = Type.Unsafe<ExtBindingsResult>(
  ExtBindingsResultShape2 satisfies SchemaProof<ExtBindingsResult, typeof ExtBindingsResultShape2>,
);

/**
 * `ext.validateComposition`(W-47). 이슈는 `validateComposition`이 돌려주는 `ManifestIssue`다.
 * 소유 트랙은 T-AUTH다. `plugins`는 블록이 속한 플러그인과 대조할 때 쓰는 선언이고 없으면 구조만 검사한다
 */
export interface ExtValidateCompositionParams {
  readonly composition: CompositionDecl;
  readonly plugins?: readonly PluginDecl[];
  readonly threadId?: string;
}
const ExtValidateCompositionParamsShape2 = request({
  composition: CompositionDeclSchema,
  plugins: Type.Optional(Type.Array(PluginDeclSchema, { minItems: 1, maxItems: 16 })),
  threadId: Type.Optional(ThreadRef),
});
export const ExtValidateCompositionParamsSchema: TUnsafe<Req<ExtValidateCompositionParams>> =
  Type.Unsafe<Req<ExtValidateCompositionParams>>(
    ExtValidateCompositionParamsShape2 satisfies SchemaProof<
      Req<ExtValidateCompositionParams>,
      typeof ExtValidateCompositionParamsShape2
    >,
  );
const ManifestIssueShape = closed({
  severity: Type.Union([Type.Literal("error"), Type.Literal("warning")]),
  code: Name,
  path: Type.String({ maxLength: 512 }),
  message: Line,
});
/** `ManifestIssue`와 같되 `code`를 열린 문자열로 받는다(호스트가 `ManifestIssue`를 그대로 돌려준다) */
export interface WireManifestIssue {
  readonly severity: ManifestIssue["severity"];
  readonly code: string;
  readonly path: string;
  readonly message: string;
}
export interface ExtValidateResult {
  readonly issues: readonly WireManifestIssue[];
}
const ExtValidateResultShape = closed({
  issues: Type.Array(ManifestIssueShape, { maxItems: 500 }),
});
export const ExtValidateResultSchema: TUnsafe<ExtValidateResult> = Type.Unsafe<ExtValidateResult>(
  ExtValidateResultShape satisfies SchemaProof<ExtValidateResult, typeof ExtValidateResultShape>,
);
