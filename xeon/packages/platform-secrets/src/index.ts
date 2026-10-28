// platform-secrets 공개 진입점(L0.secrets.plan SC-12).
// plan은 `secretsPlugin`(ExtHost.registerPlatform의 PlatformModule)만 내보내라고 하지만 @xeon/ext-host가
// 아직 registerPlatform을 내지 않아(src/index.ts가 비어 있다) 서비스 팩토리를 내보낸다.
export {
  createSecretService,
  createSecretsRuntime,
  type SecretsOs,
  type SecretsRuntime,
  type SecretsRuntimeDeps,
} from "./assemble.ts";
export { type ChildRequest, type ChildResult, type ChildRunner } from "./admin.ts";
export {
  DEFAULT_SECRETS_CONFIG,
  DEFAULT_SOPS_ENV,
  defaultSopsFile,
  SOPS_MIN_VERSION,
  withDefaultSopsFile,
  type SecretsConfig,
  type SecretsSopsFile,
} from "./config.ts";
export {
  selectOsAuth,
  type OsAuthError,
  type OsAuthProvider,
  type OsAuthSelectInput,
} from "./os-auth.ts";
export {
  createMcpStartApprovals,
  mcpDefinitionHash,
  mcpStartContext,
  type McpStartApprovals,
  type McpStartDefinition,
} from "./mcp-start.ts";
export {
  createPostHocRedaction,
  type PostHocRedaction,
  type PostHocResult,
  type PostHocStage,
  type RotateKeyAdvice,
} from "./post-redact.ts";
export {
  createPluginHttp,
  type PluginHttp,
  type PluginHttpCall,
  type PluginHttpOptions,
} from "./plugin-http.ts";
export { SECRETS_SETTING_DEFS } from "./settings.ts";
export {
  createSecretServiceCore,
  type SecretServiceCore,
  type SecretServiceInternal,
  type SecretServiceRuntime,
} from "./service.ts";
export {
  bunRunner,
  type ProcessRunner,
  type RunOutput,
  type RunRequest,
} from "./providers/sops.ts";
export { type SecretFileLock, type SecretFileLockError } from "./providers/lock.ts";
export { checkSecretArgument, checkSettingRef } from "./ref.ts";
