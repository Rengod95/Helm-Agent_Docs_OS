// @xeon/core-persistence 공개 진입점(L1.persistence.plan §2). 서비스 xeon.session의 구현을 만든다.
export { createSessionService, type SessionStartError } from "./service.ts";
export {
  itemPagesOf,
  type ItemPage,
  type ItemPageFailure,
  type ItemPageRequest,
  type ItemPages,
} from "./item-pages.ts";
export { type RetentionApi } from "./retention.ts";
export {
  createSessionPoints,
  NO_SESSION_POINTS,
  type SessionDispatcher,
  type SessionPoints,
} from "./points.ts";
export {
  SESSION_EXTENSION_NAME,
  sessionManifest,
  sessionPlugin,
  type SessionPluginOptions,
} from "./plugin.ts";
export {
  DEFAULT_PERSISTENCE_SETTINGS,
  type PersistenceSettings,
  type SessionDeps,
} from "./deps.ts";
export {
  PERSISTENCE_SETTING_DEFS,
  resolvePersistenceSettings,
  type PersistenceSettingIssue,
} from "./settings.ts";
export { decideOpenEffect, type OpenEffectInput } from "./recovery.ts";
export { SESSION_MIGRATION_OWNER, SESSION_MIGRATION_SET } from "./schema/migrations.ts";
export { SESSION_TABLE_COLUMNS } from "./schema/ddl.ts";
export { CORE_PROJECTOR_TABLES, CORE_PROJECTOR_VERSION } from "./projector/core.ts";
export {
  createReplayResolver,
  type ReplayFrom,
  type ReplayFromError,
  type ReplayResolver,
  type ReplayResolverDeps,
  type ReplayStart,
} from "./replay.ts";
export {
  MODEL_REQUEST_RESEND_POLICY,
  modelRequestResendOf,
  type ModelRequestResend,
} from "./resend.ts";
