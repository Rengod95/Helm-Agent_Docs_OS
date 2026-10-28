import { assertNever } from "@xeon/contracts";
import type { McpApprovalMode, McpServerDef } from "@xeon/contracts/capabilities";
import type { PolicyRule } from "@xeon/contracts/services";
import type { McpSettings } from "../settings.ts";
import type { BlockedReason, ServerDefinition } from "../types.ts";

// L2.mcp.spec §4.4. 서버 수준 허용·차단, 도구 수준 노출 거르기, 승인 모드 → L1.tools 권한 규칙.

/** 목록 항목 형식(§4.4 [제안]): `id:<서버 id>`, `command:<실행 파일 이름>`, `url:<URL 접두>`. 접두 없는 항목은 서버 id로 본다 */
function entryMatches(entry: string, definition: ServerDefinition): boolean {
  const colon = entry.indexOf(":");
  const kind = colon < 0 ? "id" : entry.slice(0, colon);
  const value = colon < 0 ? entry : entry.slice(colon + 1);
  const transport = definition.def.transport;
  if (kind === "id") return definition.id === value;
  if (kind === "command") {
    if (transport.type !== "stdio") return false;
    const base = transport.command.split(/[\\/]/).pop() ?? transport.command;
    return base === value || transport.command === value;
  }
  if (kind === "url") return transport.type !== "stdio" && transport.url.startsWith(value);
  // 알 수 없는 접두는 서버 id 전체 문자열로 본다(콜론이 든 id는 없으므로 일치하지 않는다)
  return definition.id === entry;
}

function anyMatches(entries: readonly string[], definition: ServerDefinition): boolean {
  return entries.some((entry) => entryMatches(entry, definition));
}

export type ServerVerdict =
  | { readonly blocked: false }
  | { readonly blocked: true; readonly reason: BlockedReason };

/** 서버 수준 판정. 차단이 허용보다 우선이고, 신뢰되지 않은 프로젝트 출처는 가장 먼저 막는다 */
export function evaluateServer(
  definition: ServerDefinition,
  settings: Pick<McpSettings, "allowedServers" | "deniedServers" | "managedOnly">,
  projectTrusted: boolean,
): ServerVerdict {
  if (definition.requiresTrust && !projectTrusted) {
    return { blocked: true, reason: "untrusted_project" };
  }
  if (anyMatches(settings.deniedServers, definition)) {
    return { blocked: true, reason: "denied_by_policy" };
  }
  if (settings.allowedServers.length > 0 && !anyMatches(settings.allowedServers, definition)) {
    return { blocked: true, reason: "not_in_allowlist" };
  }
  if (settings.managedOnly && !definition.managed) {
    return { blocked: true, reason: "managed_only" };
  }
  return { blocked: false };
}

export type ToolFilterVerdict =
  | { readonly exposed: true }
  | { readonly exposed: false; readonly reason: "denied" | "not_allowed" };

/** 도구 수준 거르기: `tools.deny`가 `tools.allow`보다 우선이다. 걸러진 도구는 시야에서만 빠진다 */
export function filterTool(def: McpServerDef, toolName: string): ToolFilterVerdict {
  const tools = def.tools;
  if (tools?.deny?.includes(toolName) === true) return { exposed: false, reason: "denied" };
  if (tools?.allow !== undefined && !tools.allow.includes(toolName)) {
    return { exposed: false, reason: "not_allowed" };
  }
  return { exposed: true };
}

/** 권한 규칙 키(§4.4). 도구 기계 이름과 별개다 */
export function toolRuleKey(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

function effectOf(mode: McpApprovalMode): "allow" | "ask" | "deny" {
  switch (mode) {
    case "auto":
      return "allow";
    case "deny":
      return "deny";
    case "prompt":
      return "ask";
    default:
      return assertNever(mode, "effectOf");
  }
}

/** 규칙 하나를 만들 때의 우선순위: 서버 전체 규칙보다 도구 규칙이 앞선다 */
const SERVER_PRIORITY = 400;
const TOOL_PRIORITY = 600;

export interface ApprovalRuleSet {
  readonly rules: readonly PolicyRule[];
  /** 규칙 id → 권한 규칙 키. 화면과 진단이 키를 보이는 데 쓴다 */
  readonly keys: ReadonlyMap<string, string>;
}

export interface RuleTool {
  readonly server: string;
  /** 서버가 광고한 원래 이름 */
  readonly name: string;
  /** Xeon 기계 이름. 노출하지 않는 도구는 null */
  readonly machineName: string | null;
}

/**
 * 승인 모드를 L1.tools 규칙으로 만든다. `l2.mcp.approvalMode`는 모든 MCP 서버에 걸리는 기본 규칙 하나이고,
 * 서버 정의 `tools.approval`이 도구마다 덮는다(§4.4). 기본 규칙과 같은 효과인 도구 규칙은 만들지 않는다.
 */
export function buildApprovalRules(
  servers: readonly ServerDefinition[],
  tools: readonly RuleTool[],
  fallback: McpApprovalMode,
): ApprovalRuleSet {
  const rules: PolicyRule[] = [];
  const keys = new Map<string, string>();
  const defaultId = "mcp.default";
  rules.push({
    id: defaultId,
    action: "tool.call",
    resource: { mcpServer: "*" },
    effect: effectOf(fallback),
    priority: SERVER_PRIORITY - 100,
    description: "l2.mcp.approvalMode",
  });
  keys.set(defaultId, "mcp__*");
  for (const server of servers) {
    const overrides = server.def.tools?.approval;
    if (overrides === undefined) continue;
    for (const [tool, mode] of Object.entries(overrides)) {
      if (mode === fallback) continue;
      const id = `mcp.${server.id}.${tool}`;
      const machine = tools.find((t) => t.server === server.id && t.name === tool)?.machineName;
      // 기계 이름을 모르는 도구(숨김, 아직 목록에 없음)의 규칙은 서버 전체에 걸리므로 만들지 않는다
      if (machine === null || machine === undefined) continue;
      rules.push({
        id,
        action: "tool.call",
        resource: { mcpServer: server.id, tool: machine },
        effect: effectOf(mode),
        priority: TOOL_PRIORITY,
        description: toolRuleKey(server.id, tool),
      });
      keys.set(id, toolRuleKey(server.id, tool));
    }
  }
  return { rules, keys };
}
