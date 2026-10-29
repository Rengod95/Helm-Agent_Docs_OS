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
export { deniedFailure, guarded, invalidInput, toCapabilityError } from "./errors.ts";
export type { WebFailure } from "./errors.ts";
export { createAskAdapter, webApprovalTitle } from "./ask-adapter.ts";
export { createAccess, hasSecretPattern } from "./policy/access.ts";
export type { Access, AccessContext, AccessDeps, ApprovedTarget } from "./policy/access.ts";
export { classifyAddress } from "./policy/address.ts";
export type { AddressClass } from "./policy/address.ts";
export { createContentHttp } from "./policy/content-http.ts";
export type { ContentHttp, ContentOutcome, ContentRequest } from "./policy/content-http.ts";
export {
  decideDomain,
  isDomainPattern,
  matchDomain,
  mergeDomainRules,
  normalizeHost,
  resolveDomainPolicy,
} from "./policy/domain.ts";
export type { DomainRules, DomainVerdict } from "./policy/domain.ts";
export { createBoundProviderHttp, WebHttpError } from "./policy/guarded-http.ts";
export type {
  BoundProviderHttp,
  ProviderHttpDeps,
  ProviderHttpOptions,
} from "./policy/guarded-http.ts";
export {
  createRobotsChecker,
  parseRobots,
  robotsAllows,
  ROBOTS_USER_AGENT_TOKEN,
  rulesFromResponse,
} from "./policy/robots.ts";
export type { RobotsChecker, RobotsFetcher, RobotsRules } from "./policy/robots.ts";
export { createSeenUrls, extractUrls } from "./policy/seen-urls.ts";
export type { SeenUrls, SeenUrlsError } from "./policy/seen-urls.ts";
export { addressVerdict, checkUrlSyntax, resolvedVerdict } from "./policy/ssrf.ts";
export type { CheckedUrl, UrlRejection } from "./policy/ssrf.ts";
export type { AskReason, WebAskError, WebAskPort, WebAskRequest } from "./ports/ask.ts";
export type { DnsResolver, ResolveError } from "./ports/resolver.ts";
export type {
  HeaderSecretError,
  HeaderSecretSender,
  HeaderSecretTarget,
  HeaderSendResponse,
  OutboundSecretGuard,
  SecretHeader,
} from "./ports/secrets.ts";
export type {
  HttpTransport,
  TransportFailure,
  TransportMode,
  TransportRequest,
  TransportResponse,
} from "./ports/transport.ts";
export { createHttpTransport } from "./transport/http-transport.ts";
export { createSystemResolver } from "./transport/system-resolver.ts";
export { cacheKeyOf, createFetchCache, rawRefOf } from "./cache/fetch-cache.ts";
export type {
  CacheError,
  CachedPage,
  FetchCache,
  RawPage,
  Retention,
  SaveInput,
} from "./cache/fetch-cache.ts";
export { CAP_WEB_MIGRATIONS, WEB_STORE_OWNER } from "./cache/migrations.ts";
export { createSearchMemo, limitBucket, searchMemoKey } from "./cache/search-memo.ts";
export type { MemoHit, SearchMemo, SearchMemoKeyInput } from "./cache/search-memo.ts";
export { createSingleFlight } from "./cache/single-flight.ts";
export type { SingleFlight } from "./cache/single-flight.ts";
export { createSessionLimits } from "./cost/limits.ts";
export type { LimitedKind, SessionLimits } from "./cost/limits.ts";
export { computeCost, createUsageMeter, monthKey } from "./cost/meter.ts";
export type { CostInput, CostResult, MeterError, UsageMeter, UsageUnit } from "./cost/meter.ts";
export {
  auditPricing,
  BUILTIN_PRICING,
  BUILTIN_WRAPPER_PRICING,
  isPricingStale,
  PRICING_STALE_DAYS,
} from "./cost/pricing.ts";
export type { PricingAudit, ProviderPricing } from "./cost/pricing.ts";
export type { WebStorePort } from "./ports/store.ts";
export { createFetchApi } from "./fetch/pipeline.ts";
export type { FetchInternalOptions } from "./fetch/pipeline.ts";
export { createRobotsGate } from "./fetch/robots-gate.ts";
export { createWorkerConvertRunner, directConvertRunner } from "./fetch/convert-runner.ts";
export type { ConvertFailure, ConvertRunner } from "./fetch/convert-runner.ts";
export { convert } from "./fetch/convert/convert.ts";
export type { ConvertInput, ConvertResult, Extractor } from "./fetch/convert/convert.ts";
export { markdownToPlainText, sliceText } from "./fetch/truncate.ts";
export { createProbeCache } from "./search/probe-cache.ts";
export type { ProbeCache } from "./search/probe-cache.ts";
export type {
  BrowseCandidate,
  FetchCandidate,
  SearchCandidate,
  WebProviderCatalog,
} from "./ports/providers.ts";
export type { BrowseConfirmPort, BrowseConfirmRequest } from "./ports/confirm.ts";
export type { WebDeps } from "./deps.ts";
export { failureOfThrown } from "./provider-errors.ts";
export { createWebRuntime } from "./runtime.ts";
export type { WebRuntime, WebRuntimeOptions } from "./runtime.ts";
export { describeWebSettings } from "./status.ts";
export { createWebService } from "./service.ts";
export { WEB_EXTENSION_NAME, webManifest } from "./manifest.ts";
export { effectiveCachePolicy } from "./cache/policy.ts";
export type { EffectiveCachePolicy } from "./cache/policy.ts";
export { createProviderRegistry } from "./search/registry.ts";
export type {
  PluginRegistration,
  ProviderRegistryDeps,
  RegistrationSource,
} from "./search/registry.ts";
export { planChain } from "./search/chain.ts";
export type { ChainPlan } from "./search/chain.ts";
export {
  decideModelSearchTool,
  isWrapperOnlyChain,
  normalizeHostedSearch,
  publishedDateOfPageAge,
} from "./search/model-tool.ts";
export type { ModelSearchSetting, ModelSearchTool, ModelToolInput } from "./search/model-tool.ts";
export { parseSearchQuery, recencyCutoff } from "./search/query.ts";
export type { ParsedQuery } from "./search/query.ts";
export {
  createSearxngProvider,
  SEARXNG_JSON_DISABLED_WARNING,
  SEARXNG_PROVIDER_ID,
  searxngManifest,
} from "./search/providers/searxng.ts";
export type { SearxngDeps } from "./search/providers/searxng.ts";
export {
  BUILTIN_WRAPPER_PROVIDER_ID,
  createWrapperProvider,
  WRAPPER_MAX_OUTPUT_TOKENS,
  WRAPPER_SYSTEM_PROMPT,
  wrapperManifest,
} from "./search/providers/builtin-wrapper.ts";
export type { WrapperDeps } from "./search/providers/builtin-wrapper.ts";
export { createBuiltinSearchCandidates } from "./search/providers/builtin.ts";
export type { BuiltinSearchDeps } from "./search/providers/builtin.ts";
export { renderQueryText } from "./search/providers/query-text.ts";
export type { QueryTextOptions } from "./search/providers/query-text.ts";
