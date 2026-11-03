import { Type } from "typebox";
import {
  defineSettings,
  SCOPE_PRECEDENCE,
  type ScopeLayer,
  type ScopeStack,
  type SettingDef,
  type SettingScope,
} from "@fresnel/contracts/settings";
import { PolicyRuleSchema, type PermissionMode } from "@fresnel/contracts/services";

// L1.tools.spec §6. `l1.tools.*` 키 8개를 선언(defineSettings, TL-8)하고 읽는다.
// 읽기는 resolveSetting과 같은 규칙(우선순위, 허용 범위, 값 검사 실패한 층은 건너뜀, 키 단위 교체)을 따른다.
// 기본값과 허용 범위는 아래 TOOLS_SETTING_DEFAULTS·ALL_SCOPES 등 한 곳에서 선언과 읽기가 함께 쓴다.

export const TOOLS_SETTING_KEYS: {
  readonly permissionMode: "l1.tools.permissionMode";
  readonly bypassAllowed: "l1.tools.bypassAllowed";
  readonly rules: "l1.tools.rules";
  readonly outputMaxLines: "l1.tools.output.maxLines";
  readonly outputMaxBytes: "l1.tools.output.maxBytes";
  readonly deferThreshold: "l1.tools.exposure.deferThreshold";
  readonly unattendedApproval: "l1.tools.unattended.approval";
  readonly unattendedTimeoutSeconds: "l1.tools.unattended.timeoutSeconds";
} = {
  permissionMode: "l1.tools.permissionMode",
  bypassAllowed: "l1.tools.bypassAllowed",
  rules: "l1.tools.rules",
  outputMaxLines: "l1.tools.output.maxLines",
  outputMaxBytes: "l1.tools.output.maxBytes",
  deferThreshold: "l1.tools.exposure.deferThreshold",
  unattendedApproval: "l1.tools.unattended.approval",
  unattendedTimeoutSeconds: "l1.tools.unattended.timeoutSeconds",
};

/**
 * 무인 실행(사람이 답할 수 없는 주 대화 turn)의 승인 정책 [제안: 키 이름, M3-REQ-73, D-M3-12].
 * `wait`는 응답이 올 때까지 기다리고, `deny`는 바로 거부하고, `expire`는 기다리다 `timeoutSeconds`가 지나면 거부한다
 */
export type UnattendedApproval = "wait" | "deny" | "expire";
const UNATTENDED_APPROVALS: readonly UnattendedApproval[] = ["wait", "deny", "expire"];

const PERMISSION_MODES: readonly PermissionMode[] = ["default", "acceptEdits", "plan", "bypass"];

export const TOOLS_SETTING_DEFAULTS: {
  readonly permissionMode: PermissionMode;
  readonly bypassAllowed: boolean;
  readonly outputMaxLines: number;
  readonly outputMaxBytes: number;
  readonly deferThreshold: number;
  readonly unattendedApproval: UnattendedApproval;
  readonly unattendedTimeoutSeconds: number;
} = {
  permissionMode: "default",
  bypassAllowed: true,
  outputMaxLines: 2000,
  outputMaxBytes: 51_200,
  deferThreshold: 64,
  unattendedApproval: "expire",
  // [제안] 한 시간. 알림을 늦게 봐도 답할 수 있고 실행이 무기한 묶이지 않는 길이다
  unattendedTimeoutSeconds: 3600,
};

/** 설정이 없을 때의 무인 승인 정책 */
export const UNATTENDED_DEFAULTS: ToolsUnattendedConfig = {
  approval: TOOLS_SETTING_DEFAULTS.unattendedApproval,
  timeoutSeconds: TOOLS_SETTING_DEFAULTS.unattendedTimeoutSeconds,
};

const ALL_SCOPES = ["managed", "user", "project", "local", "launch"] as const;
const FILE_SCOPES = ["managed", "user", "project", "local"] as const;
const MANAGED_ONLY = ["managed"] as const;

/**
 * 저장소가 커밋할 수 있는 범위. 여기서 온 규칙과 모드는 사용자가 고른 것이 아니라서 내장 도구 대체를 승인 없이 켜지 못한다
 * (L1.tools.spec §4.13). 출처 문자열의 범위 이름도 이 목록으로 알아본다(tiers.ts `isRepositorySource`)
 */
export const REPOSITORY_SCOPES: readonly SettingScope[] = ["project", "local"];

const group = defineSettings("l1.tools", {
  permissionMode: {
    type: Type.String({ maxLength: 16 }),
    default: TOOLS_SETTING_DEFAULTS.permissionMode,
    range: { enum: [...PERMISSION_MODES] },
    runtimeChange: "live",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "permissions", widget: "select", order: 10, label: "Permission mode" },
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
      label: "Allow bypass mode",
      help: "Change only in managed settings",
    },
    since: "0.1.0",
  },
  rules: {
    type: Type.Array(PolicyRuleSchema, { maxItems: 512 }),
    default: [],
    runtimeChange: "live",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "permissions", widget: "table", order: 30, label: "Permission rules" },
    since: "0.1.0",
  },
  "output.maxLines": {
    type: Type.Integer(),
    default: TOOLS_SETTING_DEFAULTS.outputMaxLines,
    range: { min: 100, max: 100_000 },
    runtimeChange: "nextTurn",
    allowedScopes: FILE_SCOPES,
    ui: {
      tab: "tools",
      widget: "number",
      order: 10,
      label: "Max tool output lines",
      unit: "lines",
    },
    since: "0.1.0",
  },
  "output.maxBytes": {
    type: Type.Integer(),
    default: TOOLS_SETTING_DEFAULTS.outputMaxBytes,
    range: { min: 1024, max: 1_048_576 },
    runtimeChange: "nextTurn",
    allowedScopes: FILE_SCOPES,
    ui: { tab: "tools", widget: "number", order: 20, label: "Max tool output bytes", unit: "B" },
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
      label: "Tool deferral threshold",
      help: "At 0, all auto tools are deferred",
      unit: "items",
    },
    since: "0.1.0",
  },
  "unattended.approval": {
    type: Type.String({ maxLength: 16 }),
    default: TOOLS_SETTING_DEFAULTS.unattendedApproval,
    range: { enum: [...UNATTENDED_APPROVALS] },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "permissions",
      widget: "select",
      order: 40,
      label: "Approval requests when unattended",
      help: "wait waits for a reply, deny rejects at once, and expire waits and then rejects once the time limit passes",
    },
    since: "0.1.0",
  },
  "unattended.timeoutSeconds": {
    type: Type.Integer(),
    default: TOOLS_SETTING_DEFAULTS.unattendedTimeoutSeconds,
    range: { min: 1, max: 604_800 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "permissions",
      widget: "number",
      order: 50,
      label: "Approval time limit when unattended",
      help: "With expire, the request is rejected once this time passes",
      unit: "s",
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

function isUnattendedApproval(value: unknown): value is UnattendedApproval {
  return UNATTENDED_APPROVALS.some((approval) => approval === value);
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
  /** 모드 `bypass`를 정한 범위가 저장소(`REPOSITORY_SCOPES`)면 참이다. 대체 항목에는 bypass를 허용하지 않는다 */
  readonly modeFromRepository: boolean;
  readonly bypassAllowed: boolean;
  readonly output: { readonly maxLines: number; readonly maxBytes: number };
  readonly deferThreshold: number;
  readonly unattended: ToolsUnattendedConfig;
}

export interface ToolsUnattendedConfig {
  readonly approval: UnattendedApproval;
  readonly timeoutSeconds: number;
}

/** 권한 모드와 그 값을 정한 범위. `pick`과 같은 순서와 검사를 쓰되 범위를 함께 돌려준다 */
function pickMode(layers: ScopeStack): {
  readonly mode: PermissionMode;
  readonly fromRepository: boolean;
} {
  for (const scope of SCOPE_PRECEDENCE) {
    if (!ALL_SCOPES.some((allowed) => allowed === scope)) continue;
    const layer = layers.find((candidate) => candidate.scope === scope);
    if (layer === undefined || !layer.values.has(TOOLS_SETTING_KEYS.permissionMode)) continue;
    const value = layer.values.get(TOOLS_SETTING_KEYS.permissionMode);
    if (isPermissionMode(value)) {
      return { mode: value, fromRepository: REPOSITORY_SCOPES.some((repo) => repo === scope) };
    }
  }
  return { mode: TOOLS_SETTING_DEFAULTS.permissionMode, fromRepository: false };
}

export function readScalarConfig(layers: ScopeStack): ToolsScalarConfig {
  const defaults = TOOLS_SETTING_DEFAULTS;
  const mode = pickMode(layers);
  return {
    mode: mode.mode,
    modeFromRepository: mode.fromRepository,
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
    unattended: {
      approval:
        pick(layers, TOOLS_SETTING_KEYS.unattendedApproval, ALL_SCOPES, isUnattendedApproval) ??
        defaults.unattendedApproval,
      timeoutSeconds:
        pick(
          layers,
          TOOLS_SETTING_KEYS.unattendedTimeoutSeconds,
          ALL_SCOPES,
          integerIn(1, 604_800),
        ) ?? defaults.unattendedTimeoutSeconds,
    },
  };
}
