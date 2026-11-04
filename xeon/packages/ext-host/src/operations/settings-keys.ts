import {
  defineSettings,
  type SettingDefInput,
  type SettingGroup,
} from "@fresnel/contracts/settings";
import { Type } from "typebox";
import { DEFAULT_AUTO_DISABLE, type AutoDisablePolicy } from "./auto-disable.ts";
import { DEFAULT_BUDGETS_MS, type BudgetTable } from "./budget.ts";
import { DEFAULT_TRACE_SETTINGS, type TraceSettings } from "./trace-buffer.ts";
import { HookDefListSchema } from "./hooks/config.ts";
import type { HookOrderMap } from "./hook-order.ts";

const BUDGET_SCOPES = ["managed", "user", "local", "launch"] as const;
const STARTUP_BUDGET_SCOPES = ["managed", "user", "local"] as const;
/** 안전 모드 키는 저장소 설정이 복구용 시작을 막거나 바꾸지 못하게 managed·user만 받는다 */
const SAFE_MODE_SCOPES = ["managed", "user"] as const;
/** 계측 키는 저장소 설정이 다른 사람의 Turn 기록 방식을 바꾸지 못하게 managed·user만 받는다 [제안] */
const TRACE_SCOPES = ["managed", "user"] as const;
/** 훅 순서 키는 저장소 설정이 다른 기능의 실행 순서를 바꾸지 못하게 managed·user만 받는다 */
const HOOK_ORDER_SCOPES = ["managed", "user"] as const;

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
    readonly "budget.uiMs": SettingDefInput;
    readonly "autoDisable.enabled": SettingDefInput;
    readonly "autoDisable.consecutive": SettingDefInput;
    readonly "autoDisable.windowSize": SettingDefInput;
    readonly "autoDisable.minFailures": SettingDefInput;
    readonly "autoDisable.failureRate": SettingDefInput;
    readonly "safeMode.default": SettingDefInput;
    readonly "safeMode.suggestAfter": SettingDefInput;
    readonly "trace.enabled": SettingDefInput;
    readonly "trace.retentionDays": SettingDefInput;
    readonly "trace.storeRequestBody": SettingDefInput;
    readonly hookOrder: SettingDefInput;
    readonly hookDisabled: SettingDefInput;
    readonly "budget.hookMs": SettingDefInput;
    readonly hookDefs: SettingDefInput;
    readonly hookEnvAllow: SettingDefInput;
  }
> = defineSettings("x.operations", {
  "budget.firstMs": budgetKey(
    "first handler time budget",
    DEFAULT_BUDGETS_MS.first,
    100,
    600_000,
    200,
    true,
    BUDGET_SCOPES,
  ),
  "budget.chainMs": budgetKey(
    "chain handler time budget",
    DEFAULT_BUDGETS_MS.chain,
    100,
    600_000,
    210,
    true,
    BUDGET_SCOPES,
  ),
  "budget.tapMs": budgetKey(
    "tap handler time budget",
    DEFAULT_BUDGETS_MS.tap,
    100,
    600_000,
    220,
    true,
    BUDGET_SCOPES,
  ),
  "budget.streamTapMs": budgetKey(
    "stream tap handler time budget",
    DEFAULT_BUDGETS_MS.streamTap,
    50,
    60_000,
    230,
    true,
    BUDGET_SCOPES,
  ),
  "budget.shutdownMs": budgetKey(
    "shutdown handler time budget",
    DEFAULT_BUDGETS_MS.shutdown,
    100,
    30_000,
    240,
    true,
    STARTUP_BUDGET_SCOPES,
  ),
  "budget.setupMs": budgetKey(
    "scope setup time budget",
    DEFAULT_BUDGETS_MS.setup,
    100,
    600_000,
    250,
    false,
    STARTUP_BUDGET_SCOPES,
  ),
  "budget.uiMs": budgetKey(
    "extension method call time budget",
    DEFAULT_BUDGETS_MS.ui,
    100,
    600_000,
    260,
    true,
    BUDGET_SCOPES,
  ),
  "autoDisable.enabled": autoKey(Type.Boolean(), "Auto-disable", DEFAULT_AUTO_DISABLE.enabled, 300),
  "autoDisable.consecutive": autoKey(
    Type.Integer(),
    "Consecutive failure threshold",
    DEFAULT_AUTO_DISABLE.consecutive,
    310,
    { min: 1, max: 1000 },
  ),
  "autoDisable.windowSize": autoKey(
    Type.Integer(),
    "Recent call window size",
    DEFAULT_AUTO_DISABLE.windowSize,
    320,
    { min: 5, max: 10_000 },
  ),
  "autoDisable.minFailures": autoKey(
    Type.Integer(),
    "Minimum failures before failure rate applies",
    DEFAULT_AUTO_DISABLE.minFailures,
    330,
    { min: 1, max: 10_000 },
  ),
  "autoDisable.failureRate": autoKey(
    Type.Number(),
    "Failure rate threshold",
    DEFAULT_AUTO_DISABLE.failureRate,
    340,
    { min: 0.05, max: 1 },
  ),
  "safeMode.default": {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "restart",
    allowedScopes: SAFE_MODE_SCOPES,
    ui: { tab: "plugins", widget: "toggle", order: 400, label: "Start in safe mode" },
    since: "0.1.0",
  },
  "safeMode.suggestAfter": {
    type: Type.Integer(),
    default: 3,
    range: { min: 1, max: 100 },
    runtimeChange: "restart",
    allowedScopes: SAFE_MODE_SCOPES,
    ui: {
      tab: "plugins",
      widget: "number",
      order: 410,
      label: "Safe mode suggestion threshold (consecutive failures)",
    },
    since: "0.1.0",
  },
  "trace.enabled": {
    type: Type.Boolean(),
    default: DEFAULT_TRACE_SETTINGS.enabled,
    runtimeChange: "nextTurn",
    allowedScopes: TRACE_SCOPES,
    ui: { tab: "plugins", widget: "toggle", order: 500, label: "Enable handler tracing" },
    since: "0.1.0",
  },
  // 측정 저장소(T-MEAS-STORE)가 읽는다. 원본 보관 기본 30일, 요청 본문 저장 기본 끔 [결정: 2026-11-03 사용자]. 키 이름은 [제안]
  "trace.retentionDays": {
    type: Type.Integer(),
    default: 30,
    range: { min: 1, max: 3650 },
    runtimeChange: "live",
    allowedScopes: TRACE_SCOPES,
    ui: {
      tab: "plugins",
      widget: "number",
      order: 520,
      label: "Measurement raw data retention",
      help: "Older raw data is deleted; daily summaries stay",
      unit: "days",
    },
    since: "0.1.0",
  },
  "trace.storeRequestBody": {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "live",
    allowedScopes: TRACE_SCOPES,
    ui: {
      tab: "plugins",
      widget: "toggle",
      order: 530,
      label: "Store model request bodies",
      help: "When on, requests sent to the model are stored with secret values masked, for the raw data retention period",
    },
    since: "0.1.0",
  },
  hookOrder: {
    type: Type.Record(Type.String(), Type.Array(Type.String())),
    default: {},
    runtimeChange: "nextTurn",
    allowedScopes: HOOK_ORDER_SCOPES,
    ui: {
      tab: "plugins",
      widget: "table",
      order: 600,
      label: "Handler order",
      help: "Users set the order in which handlers (Registration id) run for each hook. The order applies when a new stage starts. Guard-tier handlers can also be moved, and moving one may let it be skipped. Permission checks and the sandbox always run regardless of order.",
    },
    since: "0.1.0",
  },
  hookDisabled: {
    type: Type.Array(Type.String()),
    default: [],
    runtimeChange: "live",
    allowedScopes: HOOK_ORDER_SCOPES,
    ui: {
      tab: "plugins",
      widget: "list",
      order: 610,
      label: "Turned-off external hooks",
      help: "Ids of external hooks that were turned off, by you or after repeated failures. They stay off after a restart until you turn them back on.",
    },
    since: "0.1.0",
  },
  "budget.hookMs": budgetKey(
    "external hook time budget",
    DEFAULT_BUDGETS_MS.hook,
    100,
    600_000,
    620,
    true,
    BUDGET_SCOPES,
  ),
  hookDefs: {
    type: HookDefListSchema,
    default: [],
    runtimeChange: "live",
    allowedScopes: ["managed", "user", "project", "local"],
    ui: {
      tab: "plugins",
      widget: "table",
      order: 630,
      label: "External hooks",
      help: "Each row runs a command on this computer when its hook fires. The command receives the event as JSON on stdin and runs with your user permissions. Only add commands you trust. Hooks written in a work folder run only after that folder is trusted.",
    },
    since: "0.1.0",
  },
  hookEnvAllow: {
    type: Type.Array(Type.String()),
    default: [],
    runtimeChange: "live",
    allowedScopes: HOOK_ORDER_SCOPES,
    ui: {
      tab: "plugins",
      widget: "list",
      order: 640,
      label: "Environment variables external hooks may receive",
      help: "A hook can receive a variable only if its definition asks for it and it is listed here. Names containing KEY, TOKEN, SECRET, PASSWORD, CREDENTIAL or AUTH are never passed.",
    },
    since: "0.1.0",
  },
});

/** 유효 설정 값 읽기. 조립 루트(L4 host)가 설정 서비스에 연결해 넘긴다 */
export interface OperationsSettingsSource {
  budgets(): BudgetTable;
  autoDisable(): AutoDisablePolicy;
  /** x.operations.trace.* 유효 값(X.operations §3.9). 없으면 기본값이다 */
  trace?(): TraceSettings;
  /** x.operations.hookOrder 유효 값(훅별 핸들러 순서). 없으면 빈 순서다 */
  hookOrder?(): HookOrderMap;
}

export interface StaticOperationsSettings {
  readonly budgets?: Partial<BudgetTable>;
  readonly autoDisable?: Partial<AutoDisablePolicy>;
  readonly trace?: Partial<TraceSettings>;
  readonly hookOrder?: HookOrderMap;
}

/** 값이 정해진 설정 읽기. 없는 값은 문서의 기본값이다 */
export function createStaticOperationsSettings(
  values: StaticOperationsSettings = {},
): OperationsSettingsSource {
  return {
    budgets: () => ({ ...DEFAULT_BUDGETS_MS, ...values.budgets }),
    autoDisable: () => ({ ...DEFAULT_AUTO_DISABLE, ...values.autoDisable }),
    trace: () => ({ ...DEFAULT_TRACE_SETTINGS, ...values.trace }),
    hookOrder: () => values.hookOrder ?? new Map(),
  };
}
