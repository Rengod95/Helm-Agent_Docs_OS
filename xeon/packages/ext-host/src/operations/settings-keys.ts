import { defineSettings, type SettingDefInput, type SettingGroup } from "@xeon/contracts/settings";
import { Type } from "typebox";
import { DEFAULT_AUTO_DISABLE, type AutoDisablePolicy } from "./auto-disable.ts";
import { DEFAULT_BUDGETS_MS, type BudgetTable } from "./budget.ts";

const BUDGET_SCOPES = ["managed", "user", "local", "session"] as const;
const STARTUP_BUDGET_SCOPES = ["managed", "user", "local"] as const;
/** 안전 모드 키는 저장소 설정이 복구용 시작을 막거나 바꾸지 못하게 managed·user만 받는다 */
const SAFE_MODE_SCOPES = ["managed", "user"] as const;

function budgetKey(
  label: string,
  defaultMs: number,
  min: number,
  max: number,
  order: number,
  live: boolean,
  scopes: SettingDefInput["allowedScopes"],
): SettingDefInput {
  return {
    type: Type.Integer(),
    default: defaultMs,
    range: { min, max },
    runtimeChange: live ? "live" : "restart",
    allowedScopes: scopes,
    ui: { tab: "plugins", widget: "number", order, label, unit: "ms" },
    since: "0.1.0",
  };
}

function autoKey(
  type: SettingDefInput["type"],
  label: string,
  defaultValue: boolean | number,
  order: number,
  range?: { readonly min: number; readonly max: number },
): SettingDefInput {
  return {
    type,
    default: defaultValue,
    ...(range === undefined ? {} : { range }),
    runtimeChange: "live",
    allowedScopes: STARTUP_BUDGET_SCOPES,
    ui: {
      tab: "plugins",
      widget: typeof defaultValue === "boolean" ? "toggle" : "number",
      order,
      label,
    },
    since: "0.1.0",
  };
}

/**
 * x.operations.* 1차 키(X.operations.spec §6). 안전 모드 키 둘을 더했다. 외부 훅 키(M4)는 아직 없다.
 * 예산과 자동 끄기 키는 project 범위를 받지 않는다 [제안]
 */
export const operationsSettings: SettingGroup<
  "x.operations",
  {
    readonly "budget.firstMs": SettingDefInput;
    readonly "budget.chainMs": SettingDefInput;
    readonly "budget.tapMs": SettingDefInput;
    readonly "budget.streamTapMs": SettingDefInput;
    readonly "budget.shutdownMs": SettingDefInput;
    readonly "budget.setupMs": SettingDefInput;
    readonly "autoDisable.enabled": SettingDefInput;
    readonly "autoDisable.consecutive": SettingDefInput;
    readonly "autoDisable.windowSize": SettingDefInput;
    readonly "autoDisable.minFailures": SettingDefInput;
    readonly "autoDisable.failureRate": SettingDefInput;
    readonly "safeMode.default": SettingDefInput;
    readonly "safeMode.suggestAfter": SettingDefInput;
  }
> = defineSettings("x.operations", {
  "budget.firstMs": budgetKey(
    "first 핸들러 시간 예산",
    DEFAULT_BUDGETS_MS.first,
    100,
    600_000,
    200,
    true,
    BUDGET_SCOPES,
  ),
  "budget.chainMs": budgetKey(
    "chain 핸들러 시간 예산",
    DEFAULT_BUDGETS_MS.chain,
    100,
    600_000,
    210,
    true,
    BUDGET_SCOPES,
  ),
  "budget.tapMs": budgetKey(
    "tap 핸들러 시간 예산",
    DEFAULT_BUDGETS_MS.tap,
    100,
    600_000,
    220,
    true,
    BUDGET_SCOPES,
  ),
  "budget.streamTapMs": budgetKey(
    "스트림 tap 핸들러 시간 예산",
    DEFAULT_BUDGETS_MS.streamTap,
    50,
    60_000,
    230,
    true,
    BUDGET_SCOPES,
  ),
  "budget.shutdownMs": budgetKey(
    "종료 핸들러 시간 예산",
    DEFAULT_BUDGETS_MS.shutdown,
    100,
    30_000,
    240,
    true,
    STARTUP_BUDGET_SCOPES,
  ),
  "budget.setupMs": budgetKey(
    "scope setup 시간 예산",
    DEFAULT_BUDGETS_MS.setup,
    100,
    600_000,
    250,
    false,
    STARTUP_BUDGET_SCOPES,
  ),
  "autoDisable.enabled": autoKey(Type.Boolean(), "자동 끄기", DEFAULT_AUTO_DISABLE.enabled, 300),
  "autoDisable.consecutive": autoKey(
    Type.Integer(),
    "연속 실패 기준",
    DEFAULT_AUTO_DISABLE.consecutive,
    310,
    { min: 1, max: 1000 },
  ),
  "autoDisable.windowSize": autoKey(
    Type.Integer(),
    "최근 호출 창 크기",
    DEFAULT_AUTO_DISABLE.windowSize,
    320,
    { min: 5, max: 10_000 },
  ),
  "autoDisable.minFailures": autoKey(
    Type.Integer(),
    "실패율 적용 최소 실패 수",
    DEFAULT_AUTO_DISABLE.minFailures,
    330,
    { min: 1, max: 10_000 },
  ),
  "autoDisable.failureRate": autoKey(
    Type.Number(),
    "실패율 기준",
    DEFAULT_AUTO_DISABLE.failureRate,
    340,
    { min: 0.05, max: 1 },
  ),
  "safeMode.default": {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "restart",
    allowedScopes: SAFE_MODE_SCOPES,
    ui: { tab: "plugins", widget: "toggle", order: 400, label: "안전 모드로 시작" },
    since: "0.1.0",
  },
  "safeMode.suggestAfter": {
    type: Type.Integer(),
    default: 3,
    range: { min: 1, max: 100 },
    runtimeChange: "restart",
    allowedScopes: SAFE_MODE_SCOPES,
    ui: { tab: "plugins", widget: "number", order: 410, label: "안전 모드 제안 기준(연속 실패)" },
    since: "0.1.0",
  },
});

/** 유효 설정 값 읽기. 조립 루트(L4 host)가 설정 서비스에 연결해 넘긴다 */
export interface OperationsSettingsSource {
  budgets(): BudgetTable;
  autoDisable(): AutoDisablePolicy;
}

export interface StaticOperationsSettings {
  readonly budgets?: Partial<BudgetTable>;
  readonly autoDisable?: Partial<AutoDisablePolicy>;
}

/** 값이 정해진 설정 읽기. 없는 값은 문서의 기본값이다 */
export function createStaticOperationsSettings(
  values: StaticOperationsSettings = {},
): OperationsSettingsSource {
  return {
    budgets: () => ({ ...DEFAULT_BUDGETS_MS, ...values.budgets }),
    autoDisable: () => ({ ...DEFAULT_AUTO_DISABLE, ...values.autoDisable }),
  };
}
