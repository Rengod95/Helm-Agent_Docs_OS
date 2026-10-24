// @xeon/cap-web 공개 진입점(L2.web). 조립 루트가 쓰는 이름만 내보낸다.
export {
  DEFAULT_WEB_SETTINGS,
  DOMAIN_PATTERN_SOURCE,
  readWebSettings,
  WEB_SETTING_DEFS,
} from "./settings.ts";
export type { WebSettings, WebSettingsSource } from "./settings.ts";
export { normalizeUrl } from "./contract/url.ts";
export type { UrlNormalizeError } from "./contract/url.ts";
export { createSourceIdRegistry, createSourceIdTable } from "./contract/source-ids.ts";
export type { SourceIdError, SourceIdRegistry, SourceIdTable } from "./contract/source-ids.ts";
export { buildMeta, NO_COST, normalizeWarnings } from "./contract/meta.ts";
export type { MetaInput } from "./contract/meta.ts";
export { redactForPersistence } from "./contract/redact.ts";
export type {
  RecordedSource,
  SessionSourcesError,
  WebSessionSourcesPort,
} from "./ports/session-sources.ts";
