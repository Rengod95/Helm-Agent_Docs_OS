import { Nullable, parse } from "@xeon/contracts";
import {
  MODEL_ROLES,
  ModelRefStringSchema,
  THINKING_LEVELS,
  type CacheRetention,
  type ModelRefString,
  type ModelRole,
} from "@xeon/contracts/services";
import type { ModelThinkingLevel } from "@xeon/contracts/conversation";
import { SecretRef, defineSettings, type SettingDef } from "@xeon/contracts/settings";
import { Type } from "typebox";
import type { AccountDef, RateLimitPolicy } from "./accounts.ts";

// L1.models.spec §6, L1.models.plan M-7. M1 키(default, providers, retry)와 M2 키(routing.*, groupRouting,
// thinkingLevel, thinkingBudgets, allowedModels, deniedModels, cacheRetention)를 선언한다.
// accounts·rateLimit은 M3(B2-MDL)에서 더했다. fallbackChains·structuredOutputAttempts는 2차라 아직 선언하지 않는다.

/** 기본값은 이 상수 한 곳에만 둔다(BP-06). 선언의 default와 서비스 설정 기본값이 같은 값을 쓴다 */
export const DEFAULT_RETRY_SETTINGS: RetrySettings = {
  maxRetries: 3,
  baseDelayMs: 2000,
  maxDelayMs: 60_000,
};

export interface RetrySettings {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

/** l1.models.providers의 원소 하나 */
export interface ProviderSetting {
  readonly id: string;
  readonly enabled: boolean;
  readonly apiKeyRef: string | null;
  readonly baseUrl: string | null;
}

/** 레벨별 토큰 예산 키. `off`는 예산이 없다 */
export type BudgetLevel = Exclude<ModelThinkingLevel, "off">;

export type ThinkingBudgetSettings = Readonly<Record<BudgetLevel, number>>;

/** l1.models.thinkingBudgets 기본값(omp 기본, L1.models.spec §6) */
export const DEFAULT_THINKING_BUDGETS: ThinkingBudgetSettings = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16_384,
  xhigh: 32_768,
  max: 32_768,
};

/** l1.models.routing.*. main은 l1.models.default가 맡는다 */
type RoutingSettings = Readonly<Partial<Record<Exclude<ModelRole, "main">, ModelRefString | null>>>;

/** l1.models.groupRouting: scopeId → 역할 → 참조 */
type GroupRoutingSettings = Readonly<
  Record<string, Readonly<Partial<Record<ModelRole, ModelRefString>>>>
>;

/** 서비스가 읽는 설정 값. 값은 설정 서비스가 스키마로 검증해 넘긴다 */
export interface ModelsSettings {
  /** l1.models.default */
  readonly default: ModelRefString | null;
  /** l1.models.providers */
  readonly providers: readonly ProviderSetting[];
  /** l1.models.retry */
  readonly retry: RetrySettings;
  /** l1.models.routing.review 등 */
  readonly routing: RoutingSettings;
  /** l1.models.groupRouting */
  readonly groupRouting: GroupRoutingSettings;
  /** l1.models.thinkingLevel */
  readonly thinkingLevel: ModelThinkingLevel;
  /** l1.models.thinkingBudgets */
  readonly thinkingBudgets: ThinkingBudgetSettings;
  /** l1.models.allowedModels. 비면 전체 허용 */
  readonly allowedModels: readonly string[];
  /** l1.models.deniedModels */
  readonly deniedModels: readonly string[];
  /** l1.models.cacheRetention */
  readonly cacheRetention: CacheRetention;
  /** l1.models.accounts */
  readonly accounts: readonly AccountDef[];
  /** l1.models.rateLimit: provider → 정책 */
  readonly rateLimit: Readonly<Record<string, RateLimitPolicy>>;
  /** `ext.account-rotation.acknowledgeRisk`. 첫 사용 고지에 동의했는가(M3-REQ-85) */
  readonly rotationAcknowledged: boolean;
}

/** 계정 회전 플러그인의 첫 사용 고지 동의 키(플러그인 userConfig) */
export const ROTATION_ACK_KEY = "ext.account-rotation.acknowledgeRisk";

export const DEFAULT_MODELS_SETTINGS: ModelsSettings = {
  default: null,
  providers: [],
  retry: DEFAULT_RETRY_SETTINGS,
  routing: {},
  groupRouting: {},
  thinkingLevel: "medium",
  thinkingBudgets: DEFAULT_THINKING_BUDGETS,
  allowedModels: [],
  deniedModels: [],
  cacheRetention: "short",
  accounts: [],
  rateLimit: {},
  rotationAcknowledged: false,
};

const MUPLoS = ["managed", "user", "project", "local", "session"] as const;
const MUPLo = ["managed", "user", "project", "local"] as const;
const MUP = ["managed", "user", "project"] as const;

const routingRef = Nullable(ModelRefStringSchema);

function routingDef(
  order: number,
  label: string,
): {
  readonly type: typeof routingRef;
  readonly default: null;
  readonly runtimeChange: "nextTurn";
  readonly allowedScopes: typeof MUPLoS;
  readonly ui: {
    readonly tab: "models";
    readonly widget: "table";
    readonly order: number;
    readonly label: string;
  };
  readonly since: "0.1.0";
} {
  return {
    type: routingRef,
    default: null,
    runtimeChange: "nextTurn",
    allowedScopes: MUPLoS,
    ui: { tab: "models", widget: "table", order, label },
    since: "0.1.0",
  };
}

const levelNames = [...THINKING_LEVELS];
const budgetInt = Type.Integer({ minimum: 0, maximum: 10_000_000 });

const defaultRefSchema = Nullable(ModelRefStringSchema);
const groupRoutingSchema = Type.Record(
  Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" }),
  Type.Record(Type.String({ pattern: `^(?:${MODEL_ROLES.join("|")})$` }), ModelRefStringSchema, {
    additionalProperties: false,
  }),
  { maxProperties: 64, additionalProperties: false },
);
const budgetsSchema = Type.Object(
  {
    minimal: budgetInt,
    low: budgetInt,
    medium: budgetInt,
    high: budgetInt,
    xhigh: budgetInt,
    max: budgetInt,
  },
  { additionalProperties: false },
);
const modelListSchema = Type.Array(Type.String({ minLength: 1, maxLength: 265 }), {
  maxItems: 256,
});
const providersSchema = Type.Array(
  Type.Object(
    {
      id: Type.String({ pattern: "^[a-z0-9][a-z0-9._-]{0,63}$", maxLength: 64 }),
      enabled: Type.Boolean(),
      // 참조 자체는 비밀이 아니다. 값은 요청 직전에만 해석한다(L1.models.spec §4.7)
      apiKeyRef: Nullable(SecretRef),
      baseUrl: Nullable(Type.String({ minLength: 1, maxLength: 2048 })),
    },
    { additionalProperties: false },
  ),
  { maxItems: 64 },
);
const retrySchema = Type.Object(
  {
    maxRetries: Type.Integer({ minimum: 0, maximum: 10 }),
    baseDelayMs: Type.Integer({ minimum: 0, maximum: 600_000 }),
    maxDelayMs: Type.Integer({ minimum: 0, maximum: 3_600_000 }),
  },
  { additionalProperties: false },
);

const accountsSchema = Type.Array(
  Type.Object(
    {
      provider: Type.String({ pattern: "^[a-z0-9][a-z0-9._-]{0,63}$", maxLength: 64 }),
      accountId: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$", maxLength: 64 }),
      credential: SecretRef,
      priority: Type.Integer({ minimum: 0, maximum: 1000 }),
      reservePct: Type.Integer({ minimum: 0, maximum: 100 }),
    },
    { additionalProperties: false },
  ),
  { maxItems: 64 },
);
const rateLimitSchema = Type.Record(
  Type.String({ pattern: "^[a-z0-9][a-z0-9._-]{0,63}$" }),
  Type.Object(
    {
      minIntervalMs: Type.Integer({ minimum: 0, maximum: 3_600_000 }),
      onLimit: Type.Union([Type.Literal("wait"), Type.Literal("switch"), Type.Literal("fail")]),
      maxWaitMs: Type.Integer({ minimum: 0, maximum: 3_600_000 }),
    },
    { additionalProperties: false },
  ),
  { maxProperties: 64, additionalProperties: false },
);

const group = defineSettings("l1.models", {
  default: {
    type: defaultRefSchema,
    default: null,
    runtimeChange: "nextTurn",
    allowedScopes: MUPLoS,
    ui: {
      tab: "models",
      widget: "text",
      order: 10,
      label: "기본 모델",
      help: "provider/modelId[:추론레벨] 형식",
    },
    since: "0.1.0",
  },
  "routing.review": routingDef(20, "검토 모델"),
  "routing.summary": routingDef(21, "요약 모델"),
  "routing.subagent": routingDef(22, "서브에이전트 모델"),
  "routing.judge": routingDef(23, "판정 모델"),
  "routing.search": routingDef(24, "검색 모델"),
  groupRouting: {
    type: groupRoutingSchema,
    default: {},
    runtimeChange: "nextTurn",
    allowedScopes: MUPLo,
    ui: {
      tab: "models",
      widget: "table",
      order: 30,
      label: "그룹별 모델",
      help: "scope id → 역할 → provider/modelId[:추론레벨]",
    },
    since: "0.1.0",
  },
  thinkingLevel: {
    type: Type.String({ maxLength: 8 }),
    default: DEFAULT_MODELS_SETTINGS.thinkingLevel,
    range: { enum: levelNames },
    runtimeChange: "nextTurn",
    allowedScopes: MUPLoS,
    ui: { tab: "models", widget: "select", order: 40, label: "추론 레벨" },
    since: "0.1.0",
  },
  thinkingBudgets: {
    type: budgetsSchema,
    default: { ...DEFAULT_THINKING_BUDGETS },
    runtimeChange: "nextTurn",
    allowedScopes: MUP,
    ui: {
      tab: "models",
      widget: "table",
      order: 50,
      label: "추론 레벨별 토큰 예산",
      unit: "토큰",
    },
    since: "0.1.0",
  },
  allowedModels: {
    type: modelListSchema,
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: MUP,
    ui: {
      tab: "models",
      widget: "list",
      order: 60,
      label: "허용 모델",
      help: "provider/modelId 또는 provider/*. 비우면 전체 허용",
    },
    since: "0.1.0",
  },
  deniedModels: {
    type: modelListSchema,
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: MUP,
    ui: {
      tab: "models",
      widget: "list",
      order: 61,
      label: "차단 모델",
      help: "provider/modelId 또는 provider/*",
    },
    since: "0.1.0",
  },
  providers: {
    type: providersSchema,
    default: [],
    runtimeChange: "live",
    allowedScopes: MUPLo,
    ui: {
      tab: "providers",
      widget: "table",
      order: 10,
      label: "provider",
      help: "키는 secret:// 참조만 저장한다",
    },
    since: "0.1.0",
  },
  accounts: {
    type: accountsSchema,
    default: [],
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "providers",
      widget: "table",
      order: 20,
      label: "모델 계정",
      help: "같은 provider의 계정 목록. 키는 secret:// 참조만 저장한다. 계정 회전 플러그인을 켜야 쓴다",
    },
    since: "0.1.0",
  },
  rateLimit: {
    type: rateLimitSchema,
    default: {},
    runtimeChange: "live",
    allowedScopes: MUP,
    ui: {
      tab: "budgets",
      widget: "table",
      order: 10,
      label: "레이트 리밋",
      help: "provider → { minIntervalMs, onLimit(wait|switch|fail), maxWaitMs }",
    },
    since: "0.1.0",
  },
  cacheRetention: {
    type: Type.String({ maxLength: 8 }),
    default: DEFAULT_MODELS_SETTINGS.cacheRetention,
    range: { enum: ["none", "short", "long"] },
    runtimeChange: "nextTurn",
    allowedScopes: MUP,
    ui: { tab: "advanced", widget: "select", order: 5, label: "프롬프트 캐시 보존" },
    since: "0.1.0",
  },
  retry: {
    type: retrySchema,
    default: { ...DEFAULT_RETRY_SETTINGS },
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user"],
    ui: { tab: "advanced", widget: "table", order: 10, label: "모델 요청 재시도" },
    since: "0.1.0",
  },
});

/** `l1.models.*` M1·M2 선언 전체. 카탈로그 조립(buildCatalog)이 쓴다 */
export const MODELS_SETTING_DEFS: readonly SettingDef[] = Object.values(group.defs);

/** 유효 설정 값 하나를 읽는 함수. 키는 `l1.models.<이름>` 전체 키다. 값은 아직 검증 전이다 */
export type ModelsSettingReader = (key: string) => unknown;

function isLevel(value: unknown): value is ModelThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.some((level) => level === value);
}

function isRetention(value: unknown): value is CacheRetention {
  return value === "none" || value === "short" || value === "long";
}

/**
 * 설정 읽기 함수로 ModelsSettings를 만든다. 조립 루트의 `ModelsSettingsSource`가 호출 때마다 부른다.
 * 값은 선언한 스키마로 다시 검사하고, 맞지 않으면 그 키만 기본값을 쓴다
 * (설정 서비스가 쓰기 때 이미 검사하므로 손으로 고친 파일이 아니면 일어나지 않는다)
 */
export function modelsSettingsOf(read: ModelsSettingReader): ModelsSettings {
  const d = DEFAULT_MODELS_SETTINGS;
  const defaultRef = parse(defaultRefSchema, read("l1.models.default"));
  const providers = parse(providersSchema, read("l1.models.providers"));
  const retry = parse(retrySchema, read("l1.models.retry"));
  const groupRouting = parse(groupRoutingSchema, read("l1.models.groupRouting"));
  const budgets = parse(budgetsSchema, read("l1.models.thinkingBudgets"));
  const allowed = parse(modelListSchema, read("l1.models.allowedModels"));
  const denied = parse(modelListSchema, read("l1.models.deniedModels"));
  const accounts = parse(accountsSchema, read("l1.models.accounts"));
  const rateLimit = parse(rateLimitSchema, read("l1.models.rateLimit"));
  const level = read("l1.models.thinkingLevel");
  const retention = read("l1.models.cacheRetention");

  const routing: Partial<Record<Exclude<ModelRole, "main">, ModelRefString | null>> = {};
  for (const role of ["review", "summary", "subagent", "judge", "search"] as const) {
    const key = `l1.models.routing.${role}`;
    const ref = parse(routingRef, read(key));
    if (ref.ok) routing[role] = ref.value;
  }

  return {
    default: defaultRef.ok ? defaultRef.value : d.default,
    providers: providers.ok ? providers.value : d.providers,
    retry: retry.ok ? retry.value : d.retry,
    routing,
    groupRouting: groupRouting.ok ? groupRouting.value : d.groupRouting,
    thinkingLevel: isLevel(level) ? level : d.thinkingLevel,
    thinkingBudgets: budgets.ok ? budgets.value : d.thinkingBudgets,
    allowedModels: allowed.ok ? allowed.value : d.allowedModels,
    deniedModels: denied.ok ? denied.value : d.deniedModels,
    cacheRetention: isRetention(retention) ? retention : d.cacheRetention,
    accounts: accounts.ok ? accounts.value : d.accounts,
    rateLimit: rateLimit.ok ? rateLimit.value : d.rateLimit,
    rotationAcknowledged: read(ROTATION_ACK_KEY) === true,
  };
}
