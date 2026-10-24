// @xeon/cap-mcp 공개 진입점(L2.mcp). 조립 루트(HOST.6)가 쓰는 이름만 내보낸다.
// SDK 타입은 어댑터 경계(adapter.ts, transport/, testing/) 밖으로 나가지 않는다.

export { createTransportFactory } from "./transport/factory.ts";
export type {
  DefaultTransportDeps,
  OpenFailure,
  OpenedTransport,
  TransportFactory,
} from "./transport/factory.ts";
export {
  DEFAULT_MCP_SETTINGS,
  MCP_SETTING_DEFS,
  readMcpSettings,
  readSettingsServers,
} from "./settings.ts";
export type { McpSettings, McpSettingsSource, SettingsServers } from "./settings.ts";
export { loadDefinitions } from "./servers/definitions.ts";
export { parseMcpJson, normalizeServerName } from "./servers/loader.ts";
export { buildApprovalRules, evaluateServer, filterTool, toolRuleKey } from "./servers/policy.ts";
export { createProjectTrust } from "./ports/trust.ts";
export { createSecretServiceHeaders } from "./ports/secret-service.ts";
export type { LeasingSecrets } from "./ports/secret-service.ts";
export type { McpProjectTrust, TrustResolverDeps } from "./ports/trust.ts";
export type { McpFileReader } from "./ports/files.ts";
export type { McpChild, McpProcessPort, McpSpawnError, McpSpawnSpec } from "./ports/process.ts";
export type {
  McpHeaderRequest,
  McpHeaderSecrets,
  McpMasker,
  McpSecretError,
} from "./ports/secrets.ts";
export type { McpRulesSink } from "./ports/rules.ts";
export type { BlockedReason, LoaderDiagnostic, ServerDefinition } from "./types.ts";
