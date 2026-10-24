import { Nullable } from "@xeon/contracts";
import { ModelRefStringSchema } from "@xeon/contracts/services";
import { SecretRef, defineSettings, type SettingDef } from "@xeon/contracts/settings";
import { Type } from "typebox";

// L1.models.spec §6, L1.models.plan M-7. M1 키 셋은 default, providers, retry 셋이다.
// routing.*, groupRouting, thinkingLevel, thinkingBudgets, allowedModels, deniedModels, cacheRetention은 M2,
// accounts·rateLimit은 M3, fallbackChains·structuredOutputAttempts는 2차라 아직 선언하지 않는다.

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

const group = defineSettings("l1.models", {
  default: {
    type: Nullable(ModelRefStringSchema),
    default: null,
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user", "project", "local", "session"],
    ui: {
      tab: "models",
      widget: "text",
      order: 10,
      label: "기본 모델",
      help: "provider/modelId[:추론레벨] 형식",
    },
    since: "0.1.0",
  },
  providers: {
    type: Type.Array(
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
    ),
    default: [],
    runtimeChange: "live",
    allowedScopes: ["managed", "user", "project", "local"],
    ui: {
      tab: "providers",
      widget: "table",
      order: 10,
      label: "provider",
      help: "키는 secret:// 참조만 저장한다",
    },
    since: "0.1.0",
  },
  retry: {
    type: Type.Object(
      {
        maxRetries: Type.Integer({ minimum: 0, maximum: 10 }),
        baseDelayMs: Type.Integer({ minimum: 0, maximum: 600_000 }),
        maxDelayMs: Type.Integer({ minimum: 0, maximum: 3_600_000 }),
      },
      { additionalProperties: false },
    ),
    default: { ...DEFAULT_RETRY_SETTINGS },
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user"],
    ui: { tab: "advanced", widget: "table", order: 10, label: "모델 요청 재시도" },
    since: "0.1.0",
  },
});

/** `l1.models.*` M1 선언 전체. 카탈로그 조립(buildCatalog)이 쓴다 */
export const MODELS_SETTING_DEFS: readonly SettingDef[] = Object.values(group.defs);
