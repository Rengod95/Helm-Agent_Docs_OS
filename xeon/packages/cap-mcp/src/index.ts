// @xeon/cap-mcp 공개 진입점(L2.mcp). 조립 루트(HOST.6)가 쓰는 이름만 내보낸다.
// SDK 타입은 어댑터 경계(adapter.ts, transport/, testing/) 밖으로 나가지 않는다.

export { createMcp } from "./client/service.ts";
export type { BoundaryReport, McpDeps, McpRuntime } from "./client/service.ts";
export {
  createToolServiceRegistrar,
  createToolsPortRegistrar,
  type DirectToolHost,
} from "./client/register.ts";
export { mcpToolName } from "./client/dynamic-tools.ts";
export type { McpDynamicTool, McpExecuteContext, McpToolResult } from "./client/dynamic-tools.ts";
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
export { buildQuestions } from "./elicitation/questions.ts";
export { buildInputResponses, checkFormContent } from "./elicitation/responses.ts";
export { roundRequestId } from "./elicitation/rounds.ts";
export {
  askWithApprovals,
  decodeAnswer,
  planQuestionBody,
  uniformAnswer,
} from "./elicitation/approval-adapter.ts";
export type { AskError, AskInput, PlannedQuestions } from "./elicitation/approval-adapter.ts";
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
export type { McpStorePort } from "./ports/store.ts";
export type { McpContinuationSource, McpRegisterError, McpToolRegistrar } from "./ports/tools.ts";
export { CAP_MCP_MIGRATIONS, MCP_STORE_OWNER } from "./client/state-store.ts";
export type { BlockedReason, LoaderDiagnostic, ServerDefinition } from "./types.ts";
