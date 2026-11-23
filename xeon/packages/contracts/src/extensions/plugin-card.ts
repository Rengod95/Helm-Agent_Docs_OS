import { Type, type TUnsafe } from "typebox";
import type { SchemaProof, SchemaSound } from "../base/schema-proof.ts";
import type { Fold } from "./hooks.ts";
import { INTERNAL_PLUGIN_LAYERS, type InternalPluginLayer } from "./internal-plugins.ts";
import { DependencyKindSchema, type DependencyKind } from "./manifest.ts";
import { CardExternalToolSchema, type CardExternalTool } from "./external-tool.ts";
import { ExtensionNameSchema } from "./name.ts";
import { SCRIPT_LIMITS, type ScriptUse } from "./plugin-script.ts";
import { BRIDGE_CAPABILITIES, UiModeSchema, type BridgeCapability, type UiMode } from "./ui.ts";

// F.extensions.spec §3.1.3 플러그인 카드 [M5c-1]. 정본: docs/xeon/review/m5/profile-project-loader.md §3.1.
// 카드는 플러그인마다 같은 자리에 보이는 공통 스키마 값이다. 모든 값은 폴더와 매니페스트에서 정적으로 얻는다.
// 승인 전에도 코드를 실행하지 않는다(§4.5.5). wire(`wire/plugin.ts`, `wire/plugin-review.ts`)와 검토 항목이 함께 쓴다.

const Id = Type.String({ minLength: 1, maxLength: 128 });
const Text = Type.String({ minLength: 1, maxLength: 512 });
const Count = Type.Integer({ minimum: 0 });
const Iso = Type.String({ minLength: 1, maxLength: 40 });

/** 훅 위치(블록 앞·뒤, 경계, 이벤트, 내부). [미결] 코드에 정의가 없다. F §4.1 HOOK_POSITIONS는 F 문서에 없고 M5e 제안(`docs/xeon/review/m5/hooks-core-boundary.md` §훅 위치)만 있다. 정의가 생기면 그 타입으로 바꾼다 */
type HookPosition = string;
/** 훅이 하는 일(observe·modify·decide·contribute 제안). [미결] 위와 같은 이유로 문자열 자리다 */
type HookPower = string;

export const PLUGIN_ORIGIN_KINDS = ["builtin", "bundled", "user", "project", "managed"] as const;
export type PluginOriginKind = (typeof PLUGIN_ORIGIN_KINDS)[number];
const PluginOriginKindShape = Type.Union(PLUGIN_ORIGIN_KINDS.map((name) => Type.Literal(name)));

const InternalPluginLayerShape = Type.Union(
  INTERNAL_PLUGIN_LAYERS.map((name) => Type.Literal(name)),
);

export const PLUGIN_HEALTH_STATES = ["ok", "idle", "error", "stopped", "integrity"] as const;
export type PluginHealthState = (typeof PLUGIN_HEALTH_STATES)[number];
const PluginHealthStateShape = Type.Union(PLUGIN_HEALTH_STATES.map((name) => Type.Literal(name)));

/** 카드의 검토 칸. 검토 항목의 상태(`ReviewState`)와 다른 집합이다 */
export const CARD_REVIEW_STATES = ["approved", "pending", "draft", "none"] as const;
export type CardReviewState = (typeof CARD_REVIEW_STATES)[number];
const CardReviewStateShape = Type.Union(CARD_REVIEW_STATES.map((name) => Type.Literal(name)));

export const PLUGIN_ENFORCEMENTS = ["advisory", "enforced"] as const;
export type PluginEnforcement = (typeof PLUGIN_ENFORCEMENTS)[number];
const PluginEnforcementShape = Type.Union(PLUGIN_ENFORCEMENTS.map((name) => Type.Literal(name)));

export const UI_MODEL_VISIBILITIES = ["none", "partial", "all"] as const;
export type UiModelVisibility = (typeof UI_MODEL_VISIBILITIES)[number];
const UiModelVisibilityShape = Type.Union(UI_MODEL_VISIBILITIES.map((name) => Type.Literal(name)));

/** 카드가 보는 MCP 서버 전송 이름. `capabilities`의 `McpTransport`(설정 객체 형태)와 다른 개념이라 이름을 달리한다 */
export const CARD_MCP_TRANSPORTS = ["stdio", "http"] as const;
export type CardMcpTransport = (typeof CARD_MCP_TRANSPORTS)[number];
const CardMcpTransportShape = Type.Union(CARD_MCP_TRANSPORTS.map((name) => Type.Literal(name)));

/**
 * 승인하면 실행될 명령 한 줄(stdio 서버). 승인 한 번이 확인이라 검토 카드가 이 값을 빠뜨리지 않고 보여 준다
 * (사용자 결정 2026-11-18, AGE-41). 환경 변수는 이름만 싣고 값은 싣지 않는다. [제안] 이름 `launch`
 */
export interface CardMcpLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly envNames: readonly string[];
  readonly cwd: string | null;
}
/** `CardMcpLaunch`의 상한. 카드를 만드는 쪽(호스트 `card.ts`)이 넘지 않게 자르고, 잘랐다는 표시를 남긴다 */
export const CARD_MCP_LAUNCH_LIMITS: {
  readonly command: number;
  readonly arg: number;
  readonly args: number;
  readonly envName: number;
  readonly envNames: number;
  readonly cwd: number;
} = { command: 1024, arg: 1024, args: 128, envName: 128, envNames: 128, cwd: 1024 };
const CardMcpLaunchShape = Type.Object(
  {
    command: Type.String({ minLength: 1, maxLength: CARD_MCP_LAUNCH_LIMITS.command }),
    args: Type.Array(Type.String({ maxLength: CARD_MCP_LAUNCH_LIMITS.arg }), {
      maxItems: CARD_MCP_LAUNCH_LIMITS.args,
    }),
    envNames: Type.Array(Type.String({ maxLength: CARD_MCP_LAUNCH_LIMITS.envName }), {
      maxItems: CARD_MCP_LAUNCH_LIMITS.envNames,
    }),
    cwd: Type.Union([Type.String({ maxLength: CARD_MCP_LAUNCH_LIMITS.cwd }), Type.Null()]),
  },
  { additionalProperties: false },
);

/** 승인하면 실행될 명령 한 줄의 이름. MCP stdio 서버와 스크립트 칸이 같은 모양을 쓴다(설계 B [제안]) */
export type CardLaunch = CardMcpLaunch;

/**
 * 비용 근거의 출처. [로컬 정의] E §3.3(`docs/xeon/review/m5/turn-record-metrics.md`)의 `CostBasis`·`CostFigures`를
 * 최소한으로 옮긴 것이다. E 구현이 `contracts`에 들어오면 그 정의를 import하고 이 블록을 지운다.
 * 카드의 값은 정적이라 `basis`는 `declared`나 `unknown`이다
 */
export const COST_BASES = ["measured", "estimated", "declared", "unknown"] as const;
export type CostBasis = (typeof COST_BASES)[number];
const CostBasisShape = Type.Union(COST_BASES.map((name) => Type.Literal(name)));

export interface CostFigures {
  readonly always: number | null;
  readonly drive: number | null;
  readonly onDemand: number | null;
  readonly toolCount: number | null;
  readonly basis: CostBasis;
}
const CountOrNull = Type.Union([Count, Type.Null()]);
const CostFiguresShape = Type.Object(
  {
    always: CountOrNull,
    drive: CountOrNull,
    onDemand: CountOrNull,
    toolCount: CountOrNull,
    basis: CostBasisShape,
  },
  { additionalProperties: false },
);
export const CostFiguresSchema: TUnsafe<CostFigures> = Type.Unsafe<CostFigures>(
  CostFiguresShape satisfies SchemaProof<CostFigures, typeof CostFiguresShape>,
);

/**
 * 근거 참조. [로컬 정의] E §3.5(`turn-record-metrics.md`)의 `EvidenceRef` 정본을 최소한으로 옮긴 것이다.
 * 검토 증거로 붙는 시험 기록은 대화·턴 참조이고, 지난 턴에 돌려 본 결과는 `backtest` 변형이다. E 구현이 생기면 import로 바꾼다
 */
export const EVIDENCE_KINDS = ["turn", "call", "hook", "material", "skill"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
const EvidenceKindShape = Type.Union(EVIDENCE_KINDS.map((name) => Type.Literal(name)));

export type EvidenceRef =
  | {
      readonly kind: EvidenceKind;
      readonly threadId: string;
      readonly turnId: string;
      readonly stepIndex?: number;
      readonly toolCallId?: string;
      readonly hookSeq?: number;
    }
  | { readonly kind: "backtest"; readonly backtestRunId: string; readonly toolCallId?: string };
const EvidenceTurnShape = Type.Object(
  {
    kind: EvidenceKindShape,
    threadId: Id,
    turnId: Id,
    stepIndex: Type.Optional(Count),
    toolCallId: Type.Optional(Id),
    hookSeq: Type.Optional(Count),
  },
  { additionalProperties: false },
);
const EvidenceBacktestShape = Type.Object(
  {
    kind: Type.Literal("backtest"),
    backtestRunId: Id,
    toolCallId: Type.Optional(Id),
  },
  { additionalProperties: false },
);
const EvidenceRefShape = Type.Union([EvidenceTurnShape, EvidenceBacktestShape]);
export const EvidenceRefSchema: TUnsafe<EvidenceRef> = Type.Unsafe<EvidenceRef>(
  EvidenceRefShape satisfies SchemaSound<EvidenceRef, typeof EvidenceRefShape>,
);

/** Inject 칸 가운데 항상 싣는 지침 파일 하나(`instructions.md`, `components.instructions`) */
export interface InstructionEntry {
  readonly path: string;
  readonly bytes: number;
}
const InstructionEntryShape = Type.Object(
  { path: Text, bytes: Count },
  { additionalProperties: false },
);

/** Inject 칸의 스킬 하나. 본문은 필요할 때 읽으므로 설명 글자 수만 센다 */
export interface SkillEntry {
  readonly name: string;
  readonly path: string;
  readonly descriptionChars: number;
}
const SkillEntryShape = Type.Object(
  { name: Id, path: Text, descriptionChars: Count },
  { additionalProperties: false },
);

/**
 * 자체 코드(app) 화면의 선언. 매니페스트 `app.reason`(왜 기본 UI로 부족한지)과 `app.capabilities`(다리 권한)를 그대로 싣는다.
 * 리뷰 카드가 이 값을 보여 준다(ADR-0021 §3.4.3)
 */
export interface PluginUiAppDecl {
  readonly reason: string;
  readonly capabilities: readonly BridgeCapability[];
}
const PluginUiAppDeclShape = Type.Object(
  {
    reason: Type.String({ maxLength: 256 }),
    capabilities: Type.Array(Type.Union(BRIDGE_CAPABILITIES.map((name) => Type.Literal(name))), {
      maxItems: BRIDGE_CAPABILITIES.length,
    }),
  },
  { additionalProperties: false },
);

/**
 * 카드가 보는 화면 선언 하나. [이름 변경] `ui.ts`의 `UiDecl`(매니페스트 `ui` 블록)과 이름이 겹쳐 `PluginUiDecl`로 쓴다.
 * 저장 문자열이 아니라 읽기 전용 계산값이다. `mode`와 `app`은 선택 필드라 옛 카드(둘 다 없음)도 파싱된다.
 * `mode`는 그리는 방식(매니페스트 생략은 native, 명령 항목은 화면이 없어 없다)이고, `app`은 mode가 app인 화면에만 있다
 */
export interface PluginUiDecl {
  readonly id: string;
  readonly placement: string;
  readonly readsState: string | null;
  readonly modelVisible: UiModelVisibility;
  readonly mode?: UiMode;
  readonly app?: PluginUiAppDecl;
}
const PluginUiDeclShape = Type.Object(
  {
    id: Id,
    placement: Id,
    readsState: Type.Union([Id, Type.Null()]),
    modelVisible: UiModelVisibilityShape,
    mode: Type.Optional(UiModeSchema),
    app: Type.Optional(PluginUiAppDeclShape),
  },
  { additionalProperties: false },
);
export const PluginUiDeclSchema: TUnsafe<PluginUiDecl> = Type.Unsafe<PluginUiDecl>(
  PluginUiDeclShape satisfies SchemaProof<PluginUiDecl, typeof PluginUiDeclShape>,
);

/**
 * 플러그인 설정 항목 하나(`plugin.get`의 `settingsDefs`). [이름 변경] 설정 카탈로그의 `SettingDef`(`contracts/settings`)와 이름이 겹쳐 `PluginSettingDef`로 쓴다.
 * `default`는 값의 모양을 모르므로 unknown이다
 */
export interface PluginSettingDef {
  readonly key: string;
  readonly label: string;
  readonly default: unknown;
  readonly required: boolean;
  readonly secret: boolean;
}
const PluginSettingDefShape = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 160 }),
    label: Type.String({ minLength: 1, maxLength: 128 }),
    default: Type.Unknown(),
    required: Type.Boolean(),
    secret: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const PluginSettingDefSchema: TUnsafe<PluginSettingDef> = Type.Unsafe<PluginSettingDef>(
  PluginSettingDefShape satisfies SchemaProof<PluginSettingDef, typeof PluginSettingDefShape>,
);

/**
 * Inject 칸의 스크립트 한 줄(설계 B [제안]). `launch`는 `command`가 실행기 이름이나 절대 경로, `args`가 상대 `file`을 포함한다.
 * 환경 변수는 이름만 싣는다. `timeoutMs`는 선언의 값이거나 기본값(`SCRIPT_LIMITS.timeoutDefaultMs`)이다
 */
export interface CardScript {
  readonly name: string;
  readonly launch: CardLaunch;
  readonly timeoutMs: number;
  /** 승인하면 이 스크립트가 쓸 수 있는 것(`ScriptCard.uses`와 같은 값). 선택 필드라 없는 옛 카드도 파싱된다. 없으면 화면은 알리지 못한다 */
  readonly uses?: readonly ScriptUse[];
  /**
   * Fresnel에서 만든 스크립트(환경 모드 아님)가 선언했지만 받지 못하는 환경 변수 이름: 허용 목록 밖이거나 토큰·키 이름이다. 없으면 비어 있다(필드 없음).
   * `launch.envNames`는 실제로 넘어가는 이름만 싣는다. 환경 모드 스크립트에는 이 필드가 없다 [결정: 2026-11-22, 사용자, AGE-63]
   */
  readonly envNotPassed?: readonly string[];
  /** 환경 모드(가져온 훅)일 때만. 리뷰 화면은 이것으로 "당신의 셸 명령 그대로 돈다"를 그린다 [제안, AGE-58] */
  readonly env?: CardScriptEnv;
}

/** 가져온 훅의 출처 범위. 사용자 설정(`~/.claude`)에서 옴, 프로젝트 설정(`<프로젝트>/.claude`)에서 옴, 알 수 없음 */
export type ScriptOrigin = "user" | "project" | "unknown";

/** 가져오기 계획이 검토 항목에 남기는 훅 출처(엔진이 정한 값). 카드의 `origin`과 `originLabel`이 된다 */
export interface ImportedHookOrigin {
  readonly kind: "user" | "project";
  readonly label: string | null;
}

/**
 * 환경 모드 카드 칸. `command`는 원문 그대로다(가림 규칙은 호스트가 지난다). `interpreter`는 PATH에서 찾아낸 첫 단어의 위치이고 못 찾았으면 null이다.
 * `refs`의 `hash`가 null이면 지문을 못 냈다. `refsKnown`이 거짓이면 어떤 파일을 읽는지 알 수 없다고 말해야 한다(추측으로 채우지 않는다).
 * `missingTools`는 이 기기에 없는 실행 파일, `versionHints`는 버전의 근거가 되는 글이다(`python3.11` 이름, shebang, 옆의 `.python-version`)
 */
export interface CardScriptEnv {
  readonly command: string;
  readonly shell: "sh" | "bash";
  readonly interpreter: string | null;
  readonly refs: readonly { readonly path: string; readonly hash: string | null }[];
  readonly refsKnown: boolean;
  readonly missingTools: readonly string[];
  readonly versionHints: readonly string[];
  /**
   * 훅이 어디서 왔는가 [제안, enFp]. 값은 가져오기가 실제로 읽은 설정 파일의 자리에서 엔진이 정하고 검토 항목에 기록한다.
   * 매니페스트에서는 읽지 않는다(손으로 고쳐도 바뀌지 않는다). 기록이 없으면 `unknown`이다
   */
  readonly origin: ScriptOrigin;
  /**
   * `origin`이 `project`일 때 그 프로젝트 폴더의 사람이 읽는 표시(홈은 `~`로 줄인다). 그 밖에는 null이다
   */
  readonly originLabel: string | null;
  /** 프로젝트가 싣고 온 훅인가. `origin`이 `project`이거나 플러그인 자체가 프로젝트 폴더 출처이면 참이다("프로젝트가 싣고 옴" 하나로 쓴다) */
  readonly fromProject: boolean;
}
const CardScriptEnvShape = Type.Object(
  {
    command: Type.String({ maxLength: 4096 }),
    shell: Type.Union([Type.Literal("sh"), Type.Literal("bash")]),
    interpreter: Type.Union([Type.String({ maxLength: 1024 }), Type.Null()]),
    refs: Type.Array(
      Type.Object(
        {
          path: Type.String({ maxLength: 1024 }),
          hash: Type.Union([Type.String({ maxLength: 100 }), Type.Null()]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 16 },
    ),
    refsKnown: Type.Boolean(),
    missingTools: Type.Array(Type.String({ maxLength: 128 }), { maxItems: 16 }),
    versionHints: Type.Array(Type.String({ maxLength: 256 }), { maxItems: 16 }),
    origin: Type.Union([Type.Literal("user"), Type.Literal("project"), Type.Literal("unknown")]),
    originLabel: Type.Union([Type.String({ maxLength: 1024 }), Type.Null()]),
    fromProject: Type.Boolean(),
  },
  { additionalProperties: false },
);
const CardScriptShape = Type.Object(
  {
    name: Id,
    launch: CardMcpLaunchShape,
    timeoutMs: Type.Integer({ minimum: 1, maximum: SCRIPT_LIMITS.timeoutMaxMs }),
    uses: Type.Optional(
      Type.Array(
        Type.Union([
          Type.Literal("sandbox_full_access"),
          Type.Literal("system_tools"),
          Type.Literal("network"),
          Type.Literal("user_environment"),
          Type.Literal("user_full_access"),
          Type.Literal("read_wide"),
          Type.Literal("write_project"),
        ]),
        { maxItems: 6 },
      ),
    ),
    envNotPassed: Type.Optional(
      Type.Array(Type.String({ maxLength: CARD_MCP_LAUNCH_LIMITS.envName }), {
        maxItems: CARD_MCP_LAUNCH_LIMITS.envNames,
      }),
    ),
    env: Type.Optional(CardScriptEnvShape),
  },
  { additionalProperties: false },
);

/** Inject 칸의 재료 목록. 항목마다 파일 경로나 이름만 두고 본문은 싣지 않는다 */
export interface InjectInventory {
  readonly instructions: {
    readonly always: readonly InstructionEntry[];
    readonly skills: readonly SkillEntry[];
  };
  readonly tools: readonly { readonly name: string; readonly description: string | null }[];
  /** `launch`는 stdio 서버만 값이 있고 http는 null이다. 선택 필드라 `launch`가 없는 옛 카드도 파싱된다 */
  readonly mcpServers: readonly {
    readonly name: string;
    readonly transport: CardMcpTransport;
    readonly launch?: CardMcpLaunch | null;
  }[];
  readonly agents: readonly string[];
  readonly providers: readonly string[];
  readonly commands: readonly string[];
  readonly ui: readonly PluginUiDecl[];
  readonly replaces: readonly string[];
  /** 매니페스트 `scripts`의 스크립트 칸(설계 B [제안]). 선택 필드라 `scripts`가 없는 옛 카드도 파싱된다. 검토 카드는 "승인하면 실행될 명령"으로 보인다 */
  readonly scripts?: readonly CardScript[];
  /**
   * 플러그인이 "자기 데이터만 바꿈"(`ExtMethodDecl.ownDataOnly`)이라 밝힌 쓰기 메서드. 화면이 부를 때 확인 줄이 뜨지 않으므로 사람이 승인 전에 본다.
   * 선택 필드라 없는 옛 카드도 파싱된다. 없거나 비어 있으면 모든 쓰기가 매번 확인을 받는다 [결정: 2026-11-23 사용자, AGE-78 질문 5]
   */
  readonly ownDataMethods?: readonly { readonly verb: string; readonly label: string | null }[];
}
const InjectInventoryShape = Type.Object(
  {
    instructions: Type.Object(
      {
        always: Type.Array(InstructionEntryShape, { maxItems: 256 }),
        skills: Type.Array(SkillEntryShape, { maxItems: 512 }),
      },
      { additionalProperties: false },
    ),
    tools: Type.Array(
      Type.Object(
        { name: Id, description: Type.Union([Type.String({ maxLength: 512 }), Type.Null()]) },
        { additionalProperties: false },
      ),
      { maxItems: 512 },
    ),
    mcpServers: Type.Array(
      Type.Object(
        {
          name: Id,
          transport: CardMcpTransportShape,
          launch: Type.Optional(Type.Union([CardMcpLaunchShape, Type.Null()])),
        },
        { additionalProperties: false },
      ),
      { maxItems: 64 },
    ),
    agents: Type.Array(Id, { maxItems: 256 }),
    providers: Type.Array(Id, { maxItems: 256 }),
    commands: Type.Array(Id, { maxItems: 256 }),
    ui: Type.Array(PluginUiDeclShape, { maxItems: 64 }),
    replaces: Type.Array(Id, { maxItems: 16 }),
    scripts: Type.Optional(Type.Array(CardScriptShape, { maxItems: 64 })),
    ownDataMethods: Type.Optional(
      Type.Array(
        Type.Object(
          { verb: Id, label: Type.Union([Type.String({ maxLength: 48 }), Type.Null()]) },
          { additionalProperties: false },
        ),
        { maxItems: 64 },
      ),
    ),
  },
  { additionalProperties: false },
);
export const InjectInventorySchema: TUnsafe<InjectInventory> = Type.Unsafe<InjectInventory>(
  InjectInventoryShape satisfies SchemaProof<InjectInventory, typeof InjectInventoryShape>,
);

/** 카드의 Hook 칸: 훅 하나마다 이름, fold(`chain`·`tap`·`first`·`collect`는 `hooks.ts`의 `Fold`를 쓴다), 위치, 하는 일 */
export interface CardHook {
  readonly name: string;
  readonly fold: Fold;
  readonly position: HookPosition;
  readonly powers: readonly HookPower[];
}
const FoldShape = Type.Union([
  Type.Literal("tap"),
  Type.Literal("first"),
  Type.Literal("chain"),
  Type.Literal("collect"),
]);
const CardHookShape = Type.Object(
  {
    name: Id,
    fold: FoldShape,
    position: Id,
    powers: Type.Array(Id, { maxItems: 8 }),
  },
  { additionalProperties: false },
);

/**
 * 카드의 의존 한 줄(AGE-33). `from`은 선언한 Registration id, `target`은 가리키는 id(확장 이름 또는 `이름/id`)다.
 * `problem`은 설치된 집합에서 본 값이다. 매니페스트만 읽은 카드는 null이다. `target_disabled`는 프로필 사정이라 카드가 싣지 않는다
 */
export const CARD_DEPENDENCY_PROBLEMS = [
  "target_missing",
  "member_missing",
  "range_unmet",
] as const;
export type CardDependencyProblem = (typeof CARD_DEPENDENCY_PROBLEMS)[number];
const CardDependencyProblemShape = Type.Union(
  CARD_DEPENDENCY_PROBLEMS.map((name) => Type.Literal(name)),
);

export interface CardDependency {
  readonly from: string;
  readonly target: string;
  readonly kind: DependencyKind;
  readonly range: string | null;
  readonly problem: CardDependencyProblem | null;
}
const CardDependencyShape = Type.Object(
  {
    from: Type.String({ minLength: 1, maxLength: 256 }),
    target: Type.String({ minLength: 1, maxLength: 256 }),
    kind: DependencyKindSchema,
    range: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
    problem: Type.Union([CardDependencyProblemShape, Type.Null()]),
  },
  { additionalProperties: false },
);

/** 카드의 의존 칸. `dependsOn`은 이 플러그인이 기대는 것, `dependents`는 이 플러그인에 기대는 쪽이다(`problem`은 null) */
export interface CardDependencies {
  readonly dependsOn: readonly CardDependency[];
  readonly dependents: readonly CardDependency[];
}
const CardDependenciesShape = Type.Object(
  {
    dependsOn: Type.Array(CardDependencyShape, { maxItems: 256 }),
    dependents: Type.Array(CardDependencyShape, { maxItems: 256 }),
  },
  { additionalProperties: false },
);

/**
 * 카드 한 장. 칸마다 값이 있으면 그 종류의 재료가 있다는 뜻이다. `does`의 세 칸은 종류이고 나머지는 층 2·3(실행과 사용처)이다.
 * `origin`과 `review`는 호스트 기록이고 `health`는 `ext.health`의 값이다
 */
export interface PluginCard {
  readonly name: string;
  readonly displayName: string;
  /** 매니페스트의 버전(SemVer). 매니페스트를 읽을 수 없는 카드(내장 따위)에는 없다 [제안] 이름 `version` */
  readonly version?: string;
  /** 목적 한 문장. 없으면 검토에서 승인할 수 없다(`pluginReview.purposeRequired`) */
  readonly purpose: string | null;
  /**
   * 하는 일을 사용자 눈높이로 적은 설명(매니페스트 `description`, 앞뒤 공백을 뗀 값). 캔버스 판의 안쪽 면 글이다.
   * 없으면 검토에서 승인할 수 없다(`pluginReview.descriptionRequired`). 선택 필드라 없는 옛 카드도 파싱되고, 화면은 없으면 "설명이 없어요"를 보인다
   * [결정: 2026-11-23 사용자, AGE-31 "설명과 목적 등을 필수값으로"] 이름 `description`은 매니페스트 필드 그대로다
   */
  readonly description?: string;
  readonly does: {
    readonly inject: InjectInventory | null;
    readonly hook: { readonly hooks: readonly CardHook[] } | null;
    readonly drive: { readonly start: boolean; readonly commands: readonly string[] } | null;
  };
  readonly enforcement: PluginEnforcement;
  /**
   * `code`는 `entry`(격리 플러그인 프로세스)가 있는가다. `isolated`는 코드가 샌드박스 안에서 도는가다: `true`면 Fresnel의 샌드박스 하나(열린 정책, 막는 것은
   * 사용자가 막은 경로, Fresnel 자신의 비밀·데이터·설정, 차단 도메인)다. 엔진 안에서 도는 내장 패키지만 `false`다. 코드가 없으면 `null`이다 [결정: 2026-11-21, AGE-63]
   */
  readonly runs: {
    readonly code: boolean;
    readonly isolated: boolean | null;
    /**
     * 참일 때만 있다. 설정 `l0.sandbox.narrowDrafts`가 켜져 있어, 이 플러그인이 승인되기 전(드래프트)에는 코드(격리 프로세스)와 Fresnel에서 만든 스크립트(코드 없이 스크립트만 있어도)가 좁은 샌드박스
     * (자기 폴더만 읽고 쓰지 못함, 환경 변수는 허용 목록만)에서 돈다는 뜻이다. 승인된 뒤에는 `isolated`가 말하는 열린 샌드박스다. 없으면 승인 전에도 같다
     * [결정: 2026-11-22, 사용자, AGE-63]
     */
    readonly narrowBeforeApproval?: true;
  };
  readonly cost: CostFigures;
  readonly health: {
    readonly state: PluginHealthState;
    readonly lastActiveAt: string | null;
    readonly lastError: string | null;
  };
  readonly origin: {
    readonly kind: PluginOriginKind;
    readonly projectId?: string;
    readonly createdIn?: { readonly threadId: string };
  };
  /**
   * 내부 부품 여부: 엔진이 스스로 싣고 사용자가 켜고 끌 수 없으면 참이다(`origin.kind`가 `builtin`이고 매니페스트에 `group` 블록이 없다).
   * 내장이어도 대화마다 켜고 끌 수 있는 그룹(`authoring`, `guide`)은 거짓이다. 선택 필드라 없는 옛 카드(검토본 메타)도 파싱되고, 화면은 없으면 거짓으로 읽는다.
   * [제안] 이름 `internal` (AGE-33, enIn)
   */
  readonly internal?: boolean;
  /**
   * 내부 부품의 층 값. 목록 화면이 내부 부품을 코어와 기능으로 나눠 보이는 데 쓴다. `internal`이 참인 카드에만 있다
   * [결정: 2026-11-20, 사용자, AGE-33] 이름 `internalLayer`는 [제안]
   */
  readonly internalLayer?: InternalPluginLayer;
  readonly review: {
    readonly state: CardReviewState;
    readonly currentHash: string | null;
    readonly pendingItemId: string | null;
    readonly approvedAt: string | null;
  };
  /** 이 플러그인을 쓰는 프로필 id. 공통 묶음은 `"common"` */
  readonly usedBy: readonly string[];
  /**
   * 의존 칸(AGE-33). 선택 필드라 없는 옛 카드도 파싱된다. `buildPluginCard`는 매니페스트만 알아 `dependsOn`(problem null)까지만 싣고 `dependents`는 비운다.
   * 검토 서비스가 목록과 항목을 줄 때 설치된 사실로 다시 채운다(저장된 항목은 바꾸지 않는다)
   */
  readonly dependencies?: CardDependencies;
  /**
   * 엔진이 아직 필요로 하는 단위의 표시(M5c §4.1.17, AGE-33 enDep 10). 이 단위에 기대는 코어 부분의 코드 이름이다. 값이 있을 때만 싣는다(없으면 키가 없다).
   * 프로필 화면이 미리 잠그는 데 쓴다. 저장된 카드가 아니라 응답 값이다
   */
  readonly requiredByCore?: readonly string[];
  /**
   * 도구 종류 플러그인의 칸(AGE-76 질문 2): 매니페스트 `externalTool` 선언이 있는 카드에만 있다(캔버스 종류 `tool`의 근거).
   * 선언은 저장된 카드가 가지고 `status`는 응답 값이다(엔진이 점검한 내장 도구 플러그인만). 선택 필드라 없는 옛 카드도 파싱된다
   */
  readonly externalTool?: CardExternalTool;
}
const PluginCardShape = Type.Object(
  {
    name: ExtensionNameSchema,
    displayName: Type.String({ minLength: 1, maxLength: 64 }),
    version: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    purpose: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
    does: Type.Object(
      {
        inject: Type.Union([InjectInventoryShape, Type.Null()]),
        hook: Type.Union([
          Type.Object(
            { hooks: Type.Array(CardHookShape, { maxItems: 64 }) },
            { additionalProperties: false },
          ),
          Type.Null(),
        ]),
        drive: Type.Union([
          Type.Object(
            {
              start: Type.Boolean(),
              commands: Type.Array(Id, { maxItems: 64 }),
            },
            { additionalProperties: false },
          ),
          Type.Null(),
        ]),
      },
      { additionalProperties: false },
    ),
    enforcement: PluginEnforcementShape,
    runs: Type.Object(
      {
        code: Type.Boolean(),
        isolated: Type.Union([Type.Boolean(), Type.Null()]),
        narrowBeforeApproval: Type.Optional(Type.Literal(true)),
      },
      { additionalProperties: false },
    ),
    cost: CostFiguresShape,
    health: Type.Object(
      {
        state: PluginHealthStateShape,
        lastActiveAt: Type.Union([Iso, Type.Null()]),
        lastError: Type.Union([Type.String({ maxLength: 512 }), Type.Null()]),
      },
      { additionalProperties: false },
    ),
    origin: Type.Object(
      {
        kind: PluginOriginKindShape,
        projectId: Type.Optional(Id),
        createdIn: Type.Optional(Type.Object({ threadId: Id }, { additionalProperties: false })),
      },
      { additionalProperties: false },
    ),
    internal: Type.Optional(Type.Boolean()),
    internalLayer: Type.Optional(InternalPluginLayerShape),
    review: Type.Object(
      {
        state: CardReviewStateShape,
        currentHash: Type.Union([Type.String({ maxLength: 200 }), Type.Null()]),
        pendingItemId: Type.Union([Id, Type.Null()]),
        approvedAt: Type.Union([Iso, Type.Null()]),
      },
      { additionalProperties: false },
    ),
    usedBy: Type.Array(Id, { maxItems: 256 }),
    dependencies: Type.Optional(CardDependenciesShape),
    requiredByCore: Type.Optional(Type.Array(Type.String({ maxLength: 128 }), { maxItems: 16 })),
    externalTool: Type.Optional(CardExternalToolSchema),
  },
  { additionalProperties: false },
);
export const PluginCardSchema: TUnsafe<PluginCard> = Type.Unsafe<PluginCard>(
  PluginCardShape satisfies SchemaProof<PluginCard, typeof PluginCardShape>,
);
