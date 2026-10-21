import {
  SCOPE_PRECEDENCE,
  type ScopeLayer,
  type ScopeStack,
  type SettingScope,
} from "@xeon/contracts/settings";
import type { PermissionMode } from "@xeon/contracts/services";

// L1.tools.spec §6. `l1.tools.*` 키 6개를 읽는다.
// TL-8의 `defineSettings("l1.tools", …)` 선언(settings_defs_pass_checks)은 TypeBox 직접 의존이 필요하다.
// 이 패키지 package.json에 `typebox`가 없어(새 외부 패키지 금지) 선언은 의존이 연결된 뒤로 미룬다.
// 여기서는 같은 키·기본값·허용 범위·값 범위를 코드로 적고 resolveSetting과 같은 규칙(우선순위, 허용 범위, 값 검사
// 실패한 층은 건너뜀, 키 단위 교체)으로 읽는다.

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

const ALL_SCOPES: readonly SettingScope[] = ["managed", "user", "project", "local", "session"];
const FILE_SCOPES: readonly SettingScope[] = ["managed", "user", "project", "local"];
const MANAGED_ONLY: readonly SettingScope[] = ["managed"];

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
