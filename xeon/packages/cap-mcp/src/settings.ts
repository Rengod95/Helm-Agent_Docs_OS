import { Type } from "typebox";
import { parse } from "@xeon/contracts";
import {
  McpServerDefSchema,
  MCP_SERVER_ID_PATTERN,
  type McpApprovalMode,
} from "@xeon/contracts/capabilities";
import {
  defineSettings,
  resolveSetting,
  SCOPE_PRECEDENCE,
  validateSettingValue,
  type ScopeStack,
  type SettingDef,
  type SettingScope,
} from "@xeon/contracts/settings";
import { asJsonObject } from "./json.ts";
import { checkDefinitionValues } from "./servers/values.ts";
import type { LoaderDiagnostic, ServerDefinition } from "./types.ts";

// L2.mcp.spec §6. 키 문법은 `l2.mcp.<이름>`이고 열다섯 개다(sampling은 지원하지 않아 없다, M3-REQ-97).
// 서버 정의 안의 비밀은 secret:// 참조만 저장하므로 secret 열은 모두 거짓이다.

const ALL = ["managed", "user", "project", "local", "session"] as const;
const NO_SESSION = ["managed", "user", "project", "local"] as const;
const MANAGED_USER_PROJECT = ["managed", "user", "project"] as const;
const MANAGED_USER = ["managed", "user"] as const;

const mcpSettings = defineSettings("l2.mcp", {
  servers: {
    type: Type.Record(Type.String({ pattern: MCP_SERVER_ID_PATTERN }), McpServerDefSchema),
    default: {},
    runtimeChange: "nextTurn",
    allowedScopes: NO_SESSION,
    ui: { tab: "tools", widget: "table", order: 300, label: "MCP 서버" },
    since: "0.1.0",
  },
  importMcpJson: {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "nextTurn",
    allowedScopes: MANAGED_USER_PROJECT,
    ui: { tab: "tools", widget: "toggle", order: 301, label: ".mcp.json 가져오기" },
    since: "0.1.0",
  },
  connectTimeoutMs: {
    type: Type.Integer(),
    default: 30000,
    range: { min: 1000, max: 600000 },
    runtimeChange: "nextTurn",
    allowedScopes: NO_SESSION,
    ui: { tab: "tools", widget: "number", order: 302, label: "MCP 연결 제한 시간", unit: "ms" },
    since: "0.1.0",
  },
  callTimeoutMs: {
    type: Type.Integer(),
    default: 120000,
    range: { min: 1000, max: 3600000 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL,
    ui: { tab: "tools", widget: "number", order: 303, label: "MCP 호출 제한 시간", unit: "ms" },
    since: "0.1.0",
  },
  approvalMode: {
    type: Type.String(),
    default: "prompt",
    range: { enum: ["prompt", "auto", "deny"] },
    runtimeChange: "nextTurn",
    allowedScopes: ALL,
    ui: { tab: "tools", widget: "select", order: 304, label: "MCP 도구 승인 방식" },
    since: "0.1.0",
  },
  allowedServers: {
    type: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { maxItems: 500 }),
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: MANAGED_USER,
    ui: { tab: "tools", widget: "list", order: 305, label: "허용 서버" },
    since: "0.1.0",
  },
  deniedServers: {
    type: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { maxItems: 500 }),
    default: [],
    runtimeChange: "nextTurn",
    allowedScopes: MANAGED_USER_PROJECT,
    ui: { tab: "tools", widget: "list", order: 306, label: "차단 서버" },
    since: "0.1.0",
  },
  managedOnly: {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "restart",
    allowedScopes: ["managed"],
    ui: { tab: "tools", widget: "toggle", order: 307, label: "관리 서버만 허용" },
    since: "0.1.0",
  },
  "sandbox.userSource": {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "nextTurn",
    allowedScopes: MANAGED_USER,
    ui: { tab: "tools", widget: "toggle", order: 308, label: "사용자 설정 stdio 서버 샌드박스" },
    since: "0.1.0",
  },
  "sandbox.projectSource": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "nextTurn",
    allowedScopes: MANAGED_USER,
    ui: {
      tab: "tools",
      widget: "toggle",
      order: 314,
      label: "프로젝트·확장 출처 stdio 서버 샌드박스",
    },
    since: "0.1.0",
  },
  "inputRequired.maxRounds": {
    type: Type.Integer(),
    default: 10,
    range: { min: 1, max: 50 },
    runtimeChange: "nextTurn",
    allowedScopes: MANAGED_USER_PROJECT,
    ui: { tab: "tools", widget: "number", order: 309, label: "추가 입력 요청 라운드 상한" },
    since: "0.1.0",
  },
  "result.maxBytes": {
    type: Type.Integer(),
    default: 51200,
    range: { min: 1024, max: 10485760 },
    runtimeChange: "nextTurn",
    allowedScopes: ALL,
    ui: { tab: "tools", widget: "number", order: 310, label: "MCP 결과 크기 상한", unit: "B" },
    since: "0.1.0",
  },
  "reconnect.maxDelayMs": {
    type: Type.Integer(),
    default: 60000,
    range: { min: 1000, max: 3600000 },
    runtimeChange: "nextTurn",
    allowedScopes: MANAGED_USER,
    ui: { tab: "tools", widget: "number", order: 311, label: "재연결 최대 대기", unit: "ms" },
    since: "0.1.0",
  },
  "reconnect.maxAttempts": {
    type: Type.Integer(),
    default: 5,
    range: { min: 1, max: 100 },
    runtimeChange: "nextTurn",
    allowedScopes: MANAGED_USER,
    ui: { tab: "tools", widget: "number", order: 312, label: "재연결 시도 상한", unit: "회" },
    since: "0.1.0",
  },
  versionNegotiation: {
    type: Type.String(),
    default: "auto",
    range: { enum: ["auto", "legacy", "pin"] },
    runtimeChange: "restart",
    allowedScopes: MANAGED_USER_PROJECT,
    ui: { tab: "tools", widget: "select", order: 313, label: "MCP 사양 버전 협상" },
    since: "0.1.0",
  },
});

/** 이 패키지가 선언하는 설정 정의. 조립 루트가 카탈로그에 넣는다 */
export const MCP_SETTING_DEFS: readonly SettingDef[] = Object.values(mcpSettings.defs);

export interface McpSettings {
  readonly importMcpJson: boolean;
  readonly connectTimeoutMs: number;
  readonly callTimeoutMs: number;
  readonly approvalMode: McpApprovalMode;
  /** 관리 범위 값이 있으면 그 값만(낮은 범위가 넓히지 못한다), 없으면 사용자 범위 값 */
  readonly allowedServers: readonly string[];
  /** 모든 범위의 합집합. 차단이 허용보다 우선이다 */
  readonly deniedServers: readonly string[];
  readonly managedOnly: boolean;
  /** 사용자 설정(`settings:user`) 출처 stdio 서버를 샌드박스에 넣는가. 기본 끔 */
  readonly sandboxUserSource: boolean;
  /** 그 밖의 출처(프로젝트 설정, `.mcp.json`, 확장 등록) stdio 서버를 샌드박스에 넣는가. 기본 켬 */
  readonly sandboxProjectSource: boolean;
  readonly maxInputRounds: number;
  readonly resultMaxBytes: number;
  readonly reconnect: { readonly maxDelayMs: number; readonly maxAttempts: number };
  readonly versionNegotiation: "auto" | "legacy" | "pin";
}

export const DEFAULT_MCP_SETTINGS: McpSettings = {
  importMcpJson: true,
  connectTimeoutMs: 30000,
  callTimeoutMs: 120000,
  approvalMode: "prompt",
  allowedServers: [],
  deniedServers: [],
  managedOnly: false,
  sandboxUserSource: false,
  sandboxProjectSource: true,
  maxInputRounds: 10,
  resultMaxBytes: 51200,
  reconnect: { maxDelayMs: 60000, maxAttempts: 5 },
  versionNegotiation: "auto",
};

/** 호출 한 번이 읽는 설정 층. 호출마다 읽으므로 변경이 다음 호출부터 적용된다 */
export interface McpSettingsSource {
  layers(threadId: string | undefined): ScopeStack;
}

type Name = keyof typeof mcpSettings.defs;

function def(key: Name): SettingDef {
  return mcpSettings.defs[key];
}

function effective(key: Name, layers: ScopeStack): unknown {
  return resolveSetting(def(key), layers).setting.value;
}

function integerOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function choice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  for (const candidate of allowed) if (candidate === value) return candidate;
  return fallback;
}

const StringListSchema = Type.Array(Type.String());

function stringList(value: unknown): readonly string[] {
  const parsed = parse(StringListSchema, value);
  return parsed.ok ? parsed.value : [];
}

function layerList(key: Name, layers: ScopeStack, scope: SettingScope): readonly string[] {
  const settingDef = def(key);
  if (!settingDef.allowedScopes.includes(scope)) return [];
  const layer = layers.find((candidate) => candidate.scope === scope);
  if (layer === undefined || !layer.values.has(settingDef.key)) return [];
  const value = layer.values.get(settingDef.key);
  return validateSettingValue(settingDef, value).ok ? stringList(value) : [];
}

function unionOfScopes(key: Name, layers: ScopeStack): readonly string[] {
  const out = new Set<string>();
  const scopes: readonly SettingScope[] = SCOPE_PRECEDENCE;
  for (const scope of scopes) for (const item of layerList(key, layers, scope)) out.add(item);
  return [...out];
}

/** 유효 값을 읽는다. 형식이나 범위가 틀린 층은 `resolveSetting`이 건너뛰고, 값이 없으면 기본값이다 */
export function readMcpSettings(layers: ScopeStack): McpSettings {
  const fallback = DEFAULT_MCP_SETTINGS;
  const managedAllowed = layerList("allowedServers", layers, "managed");
  return {
    importMcpJson: booleanOr(effective("importMcpJson", layers), fallback.importMcpJson),
    connectTimeoutMs: integerOr(effective("connectTimeoutMs", layers), fallback.connectTimeoutMs),
    callTimeoutMs: integerOr(effective("callTimeoutMs", layers), fallback.callTimeoutMs),
    approvalMode: choice(
      effective("approvalMode", layers),
      ["prompt", "auto", "deny"],
      fallback.approvalMode,
    ),
    allowedServers:
      managedAllowed.length > 0 ? managedAllowed : layerList("allowedServers", layers, "user"),
    deniedServers: unionOfScopes("deniedServers", layers),
    managedOnly: booleanOr(effective("managedOnly", layers), fallback.managedOnly),
    sandboxUserSource: booleanOr(
      effective("sandbox.userSource", layers),
      fallback.sandboxUserSource,
    ),
    sandboxProjectSource: booleanOr(
      effective("sandbox.projectSource", layers),
      fallback.sandboxProjectSource,
    ),
    maxInputRounds: integerOr(
      effective("inputRequired.maxRounds", layers),
      fallback.maxInputRounds,
    ),
    resultMaxBytes: integerOr(effective("result.maxBytes", layers), fallback.resultMaxBytes),
    reconnect: {
      maxDelayMs: integerOr(
        effective("reconnect.maxDelayMs", layers),
        fallback.reconnect.maxDelayMs,
      ),
      maxAttempts: integerOr(
        effective("reconnect.maxAttempts", layers),
        fallback.reconnect.maxAttempts,
      ),
    },
    versionNegotiation: choice(
      effective("versionNegotiation", layers),
      ["auto", "legacy", "pin"],
      fallback.versionNegotiation,
    ),
  };
}

export interface SettingsServers {
  readonly servers: readonly ServerDefinition[];
  readonly diagnostics: readonly LoaderDiagnostic[];
}

const ID_REGEX = new RegExp(MCP_SERVER_ID_PATTERN);

/**
 * `l2.mcp.servers`를 범위별로 읽어 합친다(§4.2 1번). 같은 id는 우선순위가 높은 범위가 이긴다. 서버 하나가 틀려도
 * 나머지는 읽는다. project 범위 정의는 신뢰가 있어야 켜진다(`requiresTrust`).
 */
export function readSettingsServers(layers: ScopeStack): SettingsServers {
  const key = def("servers");
  const byId = new Map<string, ServerDefinition>();
  const diagnostics: LoaderDiagnostic[] = [];
  const scopes: readonly SettingScope[] = SCOPE_PRECEDENCE;
  for (const scope of scopes) {
    if (!key.allowedScopes.includes(scope)) continue;
    const layer = layers.find((candidate) => candidate.scope === scope);
    if (layer === undefined || !layer.values.has(key.key)) continue;
    const table = asJsonObject(layer.values.get(key.key));
    const source = `settings:${scope}`;
    if (table === undefined) {
      diagnostics.push({
        code: "invalid_definition",
        source,
        message: "l2.mcp.servers is not an object",
      });
      continue;
    }
    for (const [id, raw] of Object.entries(table)) {
      if (!ID_REGEX.test(id)) {
        diagnostics.push({ code: "invalid_name", source, server: id, message: "server id format" });
        continue;
      }
      const parsed = parse(McpServerDefSchema, raw);
      if (!parsed.ok) {
        diagnostics.push({
          code: "invalid_definition",
          source,
          server: id,
          message: parsed.error.issues.map((issue) => `${issue.path} ${issue.message}`).join("; "),
        });
        continue;
      }
      const issue = checkDefinitionValues(parsed.value);
      if (issue !== undefined) {
        diagnostics.push({ code: issue.code, source, server: id, message: issue.message });
        continue;
      }
      // SCOPE_PRECEDENCE는 높은 우선순위가 앞이므로 먼저 들어온 정의가 이긴다
      if (byId.has(id)) continue;
      byId.set(id, {
        id,
        def: parsed.value,
        source,
        managed: scope === "managed",
        requiresTrust: scope === "project",
      });
    }
  }
  return { servers: [...byId.values()], diagnostics };
}

/**
 * stdio 서버를 샌드박스에 넣을지 정한다(L2.mcp.spec §4.3 [결정: M3-REQ-97, D-M3-19 행 1]). 서버별 `sandbox`가 있으면 그 값이고,
 * 없으면 출처별 키다: 사용자 설정(`settings:user`)은 `sandbox.userSource`(기본 끔), 그 밖의 출처는 `sandbox.projectSource`(기본 켬).
 */
export function sandboxOf(server: ServerDefinition, settings: McpSettings): boolean {
  if (server.def.sandbox !== undefined) return server.def.sandbox;
  return server.source === "settings:user"
    ? settings.sandboxUserSource
    : settings.sandboxProjectSource;
}
