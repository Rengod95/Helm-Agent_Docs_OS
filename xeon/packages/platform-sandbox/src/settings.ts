import { Type } from "typebox";
import { defineSettings, validateSettingValue, type SettingDef } from "@xeon/contracts/settings";
import type { OnUnavailable } from "@xeon/contracts/services";

// L0.sandbox.spec §6. 넓히는 키(enabled, onUnavailable, writeRoots.extra, escapeRetry)는 project 범위를 받지 않는다.
// 네트워크는 기본 허용이고 차단 도메인만 관리한다(M3-REQ-55). 허용 목록 키(l0.sandbox.network.allowedDomains)는 정의하지 않는다.

const UNAVAILABLE_VALUES = ["disable_execute", "ask", "run_unsandboxed"] as const;

const CREDENTIAL_FILE_VALUES = ["allow", "deny"] as const;
type CredentialFilesMode = (typeof CREDENTIAL_FILE_VALUES)[number];

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
  "network.blockedDomains": {
    type: Type.Array(Type.String({ minLength: 1, maxLength: 253 }), { maxItems: 256 }),
    default: [],
    runtimeChange: "restart",
    allowedScopes: ["managed", "user", "project"],
    ui: {
      tab: "permissions",
      widget: "list",
      order: 105,
      label: "Blocked network domains",
      help: "Shell commands in the sandbox cannot reach these domains. Everything else stays reachable.",
    },
    since: "0.1.0",
  },
  credentialFiles: {
    type: Type.String({ maxLength: 8 }),
    default: "allow",
    range: { enum: [...CREDENTIAL_FILE_VALUES] },
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "permissions",
      widget: "select",
      order: 106,
      label: "Credential files such as ~/.npmrc and ~/.config/gh",
      help: "deny also blocks reading them from sandboxed shell commands.",
    },
    since: "0.1.0",
  },
  nestedNamespaces: {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "permissions",
      widget: "toggle",
      order: 107,
      label: "Allow nested namespaces for browser tools",
      help: "Needed to start a browser inside the sandbox. It weakens isolation, so keep it off otherwise.",
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
  /** 샌드박스 안에서 닿지 못하게 할 도메인(srt deniedDomains). 목록 밖은 모두 허용이다 */
  readonly blockedDomains: readonly string[];
  /** "allow"(기본)면 ~/.npmrc, ~/.config/gh 같은 CLI 인증 파일을 읽을 수 있다. 쓰기는 항상 거부한다 */
  readonly credentialFiles: CredentialFilesMode;
  /** 참이면 중첩 사용자 네임스페이스를 허용한다(브라우저 provider용, M3-REQ-56) */
  readonly nestedNamespaces: boolean;
  /** 0이면 시작 때만 자가 시험을 돈다 */
  readonly selfTestIntervalMin: number;
}

export const DEFAULT_SANDBOX_SETTINGS: SandboxSettings = {
  enabled: true,
  onUnavailable: "disable_execute",
  protectedPathsExtra: [],
  writeRootsExtra: [],
  escapeRetry: false,
  blockedDomains: [],
  credentialFiles: "allow",
  nestedNamespaces: false,
  selfTestIntervalMin: 60,
};

function isCredentialFilesMode(value: unknown): value is CredentialFilesMode {
  return value === "allow" || value === "deny";
}

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
  const blocked = read(defs["network.blockedDomains"].key);
  const credentialFiles = read(defs.credentialFiles.key);
  const nested = read(defs.nestedNamespaces.key);
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
    blockedDomains:
      valid(defs["network.blockedDomains"], blocked) && isStringArray(blocked)
        ? blocked
        : DEFAULT_SANDBOX_SETTINGS.blockedDomains,
    credentialFiles:
      valid(defs.credentialFiles, credentialFiles) && isCredentialFilesMode(credentialFiles)
        ? credentialFiles
        : DEFAULT_SANDBOX_SETTINGS.credentialFiles,
    nestedNamespaces:
      valid(defs.nestedNamespaces, nested) && typeof nested === "boolean"
        ? nested
        : DEFAULT_SANDBOX_SETTINGS.nestedNamespaces,
    selfTestIntervalMin:
      valid(defs.selfTestIntervalMin, interval) && typeof interval === "number"
        ? interval
        : DEFAULT_SANDBOX_SETTINGS.selfTestIntervalMin,
  };
}
