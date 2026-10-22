import { Type } from "typebox";
import {
  defineSettings,
  SCOPE_PRECEDENCE,
  type ScopeLayer,
  type ScopeStack,
  type SettingDef,
  type SettingScope,
} from "@xeon/contracts/settings";
import { PolicyRuleSchema, type PermissionMode } from "@xeon/contracts/services";

// L1.tools.spec §6. `l1.tools.*` 키 6개를 선언(defineSettings, TL-8)하고 읽는다.
// 읽기는 resolveSetting과 같은 규칙(우선순위, 허용 범위, 값 검사 실패한 층은 건너뜀, 키 단위 교체)을 따른다.
// 기본값과 허용 범위는 아래 TOOLS_SETTING_DEFAULTS·ALL_SCOPES 등 한 곳에서 선언과 읽기가 함께 쓴다.

export const TOOLS_SETTING_KEYS: {
  readonly permissionMode: "l1.tools.permissionMode";
  readonly bypassAllowed: "l1.tools.bypassAllowed";
  readonly rules: "l1.tools.rules";
  readonly outputMaxLines: "l1.tools.output.maxLines";
  readonly outputMaxBytes: "l1.tools.output.maxBytes";
  readonly deferThreshold: "l1.tools.exposure.deferThreshold";
} = {
  permissionMode: "l1.tools.permissionMode",
  bypassAllowed: "l1.tools.bypassAllowed",
  rules: "l1.tools.rules",
  outputMaxLines: "l1.tools.output.maxLines",
  outputMaxBytes: "l1.tools.output.maxBytes",
  deferThreshold: "l1.tools.exposure.deferThreshold",
};

const PERMISSION_MODES: readonly PermissionMode[] = ["default", "acceptEdits", "plan", "bypass"];

export const TOOLS_SETTING_DEFAULTS: {
  readonly permissionMode: PermissionMode;
  readonly bypassAllowed: boolean;
  readonly outputMaxLines: number;
  readonly outputMaxBytes: number;
  readonly deferThreshold: number;
} = {
  permissionMode: "default",
  bypassAllowed: true,
  outputMaxLines: 2000,
  outputMaxBytes: 51_200,
  deferThreshold: 64,
};

const ALL_SCOPES = ["managed", "user", "project", "local", "session"] as const;
const FILE_SCOPES = ["managed", "user", "project", "local"] as const;
const MANAGED_ONLY = ["managed"] as const;

const group = defineSettings("l1.tools", {
  permissionMode: {
    type: Type.String({ maxLength: 16 }),
    default: TOOLS_SETTING_DEFAULTS.permissionMode,
    range: { enum: [...PERMISSION_MODES] },
    runtimeChange: "live",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "permissions", widget: "select", order: 10, label: "권한 모드" },
    since: "0.1.0",
  },
  bypassAllowed: {
    type: Type.Boolean(),
    default: TOOLS_SETTING_DEFAULTS.bypassAllowed,
    runtimeChange: "live",
    allowedScopes: MANAGED_ONLY,
    ui: {
      tab: "permissions",
      widget: "toggle",
      order: 20,
      label: "bypass 모드 허용",
      help: "관리 설정에서만 바꾼다",
    },
    since: "0.1.0",
  },
  rules: {
    type: Type.Array(PolicyRuleSchema, { maxItems: 512 }),
    default: [],
    runtimeChange: "live",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "permissions", widget: "table", order: 30, label: "권한 규칙" },
    since: "0.1.0",
  },
  "output.maxLines": {
    type: Type.Integer(),
    default: TOOLS_SETTING_DEFAULTS.outputMaxLines,
    range: { min: 100, max: 100_000 },
    runtimeChange: "nextTurn",
    allowedScopes: FILE_SCOPES,
    ui: { tab: "tools", widget: "number", order: 10, label: "도구 출력 최대 줄 수", unit: "줄" },
    since: "0.1.0",
  },
  "output.maxBytes": {
    type: Type.Integer(),
    default: TOOLS_SETTING_DEFAULTS.outputMaxBytes,
    range: { min: 1024, max: 1_048_576 },
    runtimeChange: "nextTurn",
    allowedScopes: FILE_SCOPES,
    ui: { tab: "tools", widget: "number", order: 20, label: "도구 출력 최대 바이트", unit: "B" },
    since: "0.1.0",
  },
  "exposure.deferThreshold": {
    type: Type.Integer(),
    default: TOOLS_SETTING_DEFAULTS.deferThreshold,
    range: { min: 0, max: 128 },
    runtimeChange: "nextTurn",
    allowedScopes: FILE_SCOPES,
    ui: {
      tab: "tools",
      widget: "number",
      order: 30,
      label: "도구 지연 노출 기준",
      help: "0이면 auto 도구는 모두 지연 도구다",
      unit: "개",
    },
    since: "0.1.0",
  },
});

/** `l1.tools.*` 선언 전체. 카탈로그 조립(buildCatalog)이 쓴다 */
export const TOOLS_SETTING_DEFS: readonly SettingDef[] = Object.values(group.defs);

/** 설정 층을 돌려준다. 파일 범위(managed, user, project, local)는 조립 루트가 읽어 넘긴다 */
export interface ToolsSettingsSource {
  layers(): ScopeStack;
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return PERMISSION_MODES.some((mode) => mode === value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function integerIn(min: number, max: number): (value: unknown) => value is number {
  return (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** 우선순위가 높은 범위부터 보고, 허용 범위 안에서 값 검사를 통과한 첫 값을 돌려준다 */
function pick<T>(
  layers: ScopeStack,
  key: string,
  allowed: readonly SettingScope[],
  check: (value: unknown) => value is T,
): T | undefined {
  for (const scope of SCOPE_PRECEDENCE) {
    if (!allowed.includes(scope)) continue;
    const layer = layers.find((candidate) => candidate.scope === scope);
    if (layer === undefined || !layer.values.has(key)) continue;
    const value = layer.values.get(key);
    if (check(value)) return value;
  }
  return undefined;
}

/** 층 하나에서 키 값을 꺼낸다. 규칙 수집(범위별)이 쓴다 */
export function layerValue(layer: ScopeLayer, key: string): unknown {
  return layer.values.get(key);
}

export interface ToolsScalarConfig {
  readonly mode: PermissionMode;
  readonly bypassAllowed: boolean;
  readonly output: { readonly maxLines: number; readonly maxBytes: number };
  readonly deferThreshold: number;
}

export function readScalarConfig(layers: ScopeStack): ToolsScalarConfig {
  const defaults = TOOLS_SETTING_DEFAULTS;
  return {
    mode:
      pick(layers, TOOLS_SETTING_KEYS.permissionMode, ALL_SCOPES, isPermissionMode) ??
      defaults.permissionMode,
    bypassAllowed:
      pick(layers, TOOLS_SETTING_KEYS.bypassAllowed, MANAGED_ONLY, isBoolean) ??
      defaults.bypassAllowed,
    output: {
      maxLines:
        pick(layers, TOOLS_SETTING_KEYS.outputMaxLines, FILE_SCOPES, integerIn(100, 100_000)) ??
        defaults.outputMaxLines,
      maxBytes:
        pick(layers, TOOLS_SETTING_KEYS.outputMaxBytes, FILE_SCOPES, integerIn(1024, 1_048_576)) ??
        defaults.outputMaxBytes,
    },
    deferThreshold:
      pick(layers, TOOLS_SETTING_KEYS.deferThreshold, FILE_SCOPES, integerIn(0, 128)) ??
      defaults.deferThreshold,
  };
}
