import { Type } from "typebox";
import { defineSettings, validateSettingValue, type SettingDef } from "@xeon/contracts/settings";
import type { OnUnavailable } from "@xeon/contracts/services";

// L0.sandbox.spec §6. 넓히는 키(enabled, onUnavailable, writeRoots.extra, escapeRetry)는 project 범위를 받지 않는다.
// 네트워크 키(l0.sandbox.network.*)는 M2 단계라 정의하지 않는다.

const UNAVAILABLE_VALUES = ["disable_execute", "ask", "run_unsandboxed"] as const;

const sandboxSettings = defineSettings("l0.sandbox", {
  enabled: {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "permissions",
      widget: "toggle",
      order: 100,
      label: "Sandbox shell commands",
      help: "Turning this off runs shell commands without isolation.",
    },
    since: "0.1.0",
  },
  onUnavailable: {
    type: Type.String({ maxLength: 32 }),
    default: "disable_execute",
    range: { enum: [...UNAVAILABLE_VALUES] },
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "permissions",
      widget: "select",
      order: 101,
      label: "When the sandbox is unavailable",
      help: "run_unsandboxed runs shell commands without isolation.",
    },
    since: "0.1.0",
  },
  "protectedPaths.extra": {
    type: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 256 }),
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user", "project"],
    ui: {
      tab: "permissions",
      widget: "list",
      order: 102,
      label: "Extra protected paths",
      help: "Absolute paths or paths starting with ~/. Default protected paths cannot be removed.",
    },
    since: "0.1.0",
  },
  "writeRoots.extra": {
    type: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 256 }),
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "permissions",
      widget: "list",
      order: 103,
      label: "Extra writable directories",
    },
    since: "0.1.0",
  },
  escapeRetry: {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "permissions",
      widget: "toggle",
      order: 104,
      label: "Allow retry outside the sandbox",
      help: "Every call outside the sandbox still needs approval.",
    },
    since: "0.1.0",
  },
  selfTestIntervalMin: {
    type: Type.Integer(),
    default: 60,
    range: { min: 0, max: 1440 },
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    since: "0.1.0",
  },
});

export const SANDBOX_SETTING_DEFS: readonly SettingDef[] = Object.values(sandboxSettings.defs);

export interface SandboxSettings {
  readonly enabled: boolean;
  readonly onUnavailable: OnUnavailable;
  readonly protectedPathsExtra: readonly string[];
  readonly writeRootsExtra: readonly string[];
  readonly escapeRetry: boolean;
  /** 0이면 시작 때만 자가 시험을 돈다 */
  readonly selfTestIntervalMin: number;
}

export const DEFAULT_SANDBOX_SETTINGS: SandboxSettings = {
  enabled: true,
  onUnavailable: "disable_execute",
  protectedPathsExtra: [],
  writeRootsExtra: [],
  escapeRetry: false,
  selfTestIntervalMin: 60,
};

function isOnUnavailable(value: unknown): value is OnUnavailable {
  return value === "disable_execute" || value === "ask" || value === "run_unsandboxed";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function valid(def: SettingDef, value: unknown): boolean {
  return value !== undefined && validateSettingValue(def, value).ok;
}

/**
 * 유효 설정 값을 읽어 SandboxSettings로 만든다. read는 설정 키의 유효 값을 돌려주는 함수다.
 * 값이 없거나 형식·범위가 틀리면 기본값을 쓴다(격리를 약하게 하는 쪽으로 해석하지 않는다).
 */
export function readSandboxSettings(read: (key: string) => unknown): SandboxSettings {
  const defs = sandboxSettings.defs;
  const enabled = read(defs.enabled.key);
  const onUnavailable = read(defs.onUnavailable.key);
  const protectedExtra = read(defs["protectedPaths.extra"].key);
  const writeExtra = read(defs["writeRoots.extra"].key);
  const escapeRetry = read(defs.escapeRetry.key);
  const interval = read(defs.selfTestIntervalMin.key);
  return {
    enabled:
      valid(defs.enabled, enabled) && typeof enabled === "boolean"
        ? enabled
        : DEFAULT_SANDBOX_SETTINGS.enabled,
    onUnavailable:
      valid(defs.onUnavailable, onUnavailable) && isOnUnavailable(onUnavailable)
        ? onUnavailable
        : DEFAULT_SANDBOX_SETTINGS.onUnavailable,
    protectedPathsExtra:
      valid(defs["protectedPaths.extra"], protectedExtra) && isStringArray(protectedExtra)
        ? protectedExtra
        : DEFAULT_SANDBOX_SETTINGS.protectedPathsExtra,
    writeRootsExtra:
      valid(defs["writeRoots.extra"], writeExtra) && isStringArray(writeExtra)
        ? writeExtra
        : DEFAULT_SANDBOX_SETTINGS.writeRootsExtra,
    escapeRetry:
      valid(defs.escapeRetry, escapeRetry) && typeof escapeRetry === "boolean"
        ? escapeRetry
        : DEFAULT_SANDBOX_SETTINGS.escapeRetry,
    selfTestIntervalMin:
      valid(defs.selfTestIntervalMin, interval) && typeof interval === "number"
        ? interval
        : DEFAULT_SANDBOX_SETTINGS.selfTestIntervalMin,
  };
}
