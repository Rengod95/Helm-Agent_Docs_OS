import type { Clock, Logger } from "@xeon/contracts";
import type { WebService } from "@xeon/contracts/capabilities";
import type { HostedSearchPort } from "@xeon/contracts/services";
import type { LocalIdFactory, ThreadId } from "@xeon/contracts/conversation";
import { createFetchCache, type FetchCache } from "./cache/fetch-cache.ts";
import { createSourceIdRegistry } from "./contract/source-ids.ts";
import { createSessionLimits } from "./cost/limits.ts";
import { createUsageMeter } from "./cost/meter.ts";
import type { WebDeps } from "./deps.ts";
import { createWorkerConvertRunner, type ConvertRunner } from "./fetch/convert-runner.ts";
import { createRobotsGate } from "./fetch/robots-gate.ts";
import { createAccess } from "./policy/access.ts";
import { createContentHttp } from "./policy/content-http.ts";
import type { ProviderHttpDeps } from "./policy/guarded-http.ts";
import { createSeenUrls } from "./policy/seen-urls.ts";
import type { WebAskPort } from "./ports/ask.ts";
import type {
  BrowseCandidate,
  FetchCandidate,
  SearchCandidate,
  WebProviderCatalog,
} from "./ports/providers.ts";
import type { DnsResolver } from "./ports/resolver.ts";
import type { HeaderSecretSender, OutboundSecretGuard } from "./ports/secrets.ts";
import type { WebSessionSourcesPort } from "./ports/session-sources.ts";
import type { WebStorePort } from "./ports/store.ts";
import type { HttpTransport } from "./ports/transport.ts";
import { createProbeCache, type ProbeCache } from "./search/probe-cache.ts";
import { createBuiltinSearchCandidates } from "./search/providers/builtin.ts";
import { createProviderRegistry, type RegistrationSource } from "./search/registry.ts";
import { createBrowseApi, type BrowseController } from "./browse/service.ts";
import type { BrowseConfirmPort } from "./ports/confirm.ts";
import { createWebService } from "./service.ts";
import type { WebSettings } from "./settings.ts";
import { createHttpTransport } from "./transport/http-transport.ts";
import { createSystemResolver } from "./transport/system-resolver.ts";

// 조립. 포트(저장소, 승인, 세션 이벤트, 비밀 판정, provider 후보 목록)를 받아 `WebService`와 `WebDeps`를 만든다.
// 실제 포트 연결은 HOST 트랙의 조립이 한다(m2-plan HOST.6). 포트를 주지 않은 항목은 안전한 쪽으로 동작한다:
// 저장소가 없으면 디스크 캐시와 rawRef가 없고, 승인 포트가 없으면 ask 판정은 거부한다.

export interface WebRuntimeOptions {
  readonly clock: Clock;
  readonly ids: LocalIdFactory;
  readonly logger: Logger;
  /** 호출 한 번이 읽는 유효 설정. threadId가 있으면 세션 범위를 포함한다 */
  readonly settings: (threadId: ThreadId | undefined) => WebSettings;
  readonly sessionSources: WebSessionSourcesPort;
  /** UA 문자열. 기본 `Xeon/0.1.0` */
  readonly userAgent?: string;
  readonly resolver?: DnsResolver;
  readonly transport?: HttpTransport;
  readonly convert?: ConvertRunner;
  readonly store?: WebStorePort;
  readonly asker?: WebAskPort;
  readonly guard?: OutboundSecretGuard;
  /** 플러그인 provider의 헤더 비밀 통로(L2.web.spec §3.6.1). 조립 쪽이 L0 `withHttp` 경로로 채운다. 없으면 비밀 헤더 provider는 no-key다 */
  readonly headerSecrets?: HeaderSecretSender;
  /** 브라우저 동작의 사람 확인(L2.web.spec §4.10.3). 없으면 확인이 필요한 동작은 거부한다 */
  readonly browseConfirm?: BrowseConfirmPort;
  /** 플러그인 provider 등록 목록(X가 넘긴다). 기본은 비어 있다 */
  readonly registrations?: RegistrationSource;
  /**
   * 모델 provider의 hosted 검색 포트(`ModelService.hostedSearch`). 있으면 내장 검색 래퍼가 후보에 들어간다(L2.web.spec §4.8.4).
   * 없으면 래퍼 없이 SearXNG와 플러그인만 후보다
   */
  readonly hostedSearch?: HostedSearchPort;
  /** false면 내장 검색 provider(searxng, builtin-wrapper)를 후보에 넣지 않는다. 기본 true. 체인을 직접 짜는 시험이 쓴다 */
  readonly builtinSearch?: boolean;
  /** 이 밖에 더하는 내장 provider 후보. 기본은 비어 있다 */
  readonly builtin?: {
    readonly search: readonly SearchCandidate[];
    readonly fetch: readonly FetchCandidate[];
    readonly browse?: readonly BrowseCandidate[];
  };
  /** `ext.<이름>.<키>` 설정 읽기 */
  readonly extensionSetting?: (extension: string, key: string) => unknown;
}

export interface WebRuntime {
  readonly service: WebService;
  readonly deps: WebDeps;
  readonly catalog: WebProviderCatalog;
  readonly probes: ProbeCache;
  /** 브라우저 세션 제어(대화 종료 때 닫기). 서비스의 `browse` 메서드는 `service.browse`다 */
  readonly browse: BrowseController;
  /** 디스크 캐시가 켜져 있는가(저장소가 없거나 마이그레이션이 실패하면 거짓) */
  readonly cacheEnabled: boolean;
  /** 살아 있지 않은 세션의 session 원문 행을 지운다. 세션 목록은 호출자가 `xeon.session`에서 읽는다 */
  purgeSessionRaw(liveSessions: ReadonlySet<string>): number;
  close(): Promise<void>;
}

const EMPTY_SOURCE: RegistrationSource = { list: () => [] };

export function createWebRuntime(options: WebRuntimeOptions): WebRuntime {
  const userAgent = options.userAgent ?? "Xeon/0.1.0";
  const resolver = options.resolver ?? createSystemResolver();
  const transport = options.transport ?? createHttpTransport({ resolver });
  const convert = options.convert ?? createWorkerConvertRunner();
  const seen = createSeenUrls(options.sessionSources);
  const access = createAccess({
    resolver,
    settings: options.settings,
    seen,
    guard: options.guard,
    asker: options.asker,
  });
  const content = createContentHttp(access, transport);

  let cache: FetchCache | undefined;
  if (options.store !== undefined) {
    const candidate = createFetchCache({ store: options.store, clock: options.clock });
    const migrated = candidate.migrate();
    if (migrated.ok) cache = candidate;
    else options.logger.error("web.cache_migration_failed", { kind: migrated.error.kind });
  }
  const meter =
    cache === undefined || options.store === undefined
      ? undefined
      : createUsageMeter({ store: options.store, clock: options.clock });

  const providerHttp: ProviderHttpDeps = {
    resolver,
    transport,
    secrets: options.headerSecrets,
    guard: options.guard,
  };
  const builtinSearch =
    options.builtinSearch === false
      ? []
      : createBuiltinSearchCandidates({
          http: providerHttp,
          settings: () => options.settings(undefined).search,
          clock: options.clock,
          logger: options.logger,
          hosted: options.hostedSearch,
        });
  const catalog = createProviderRegistry({
    source: options.registrations ?? EMPTY_SOURCE,
    builtin: {
      search: [...builtinSearch, ...(options.builtin?.search ?? [])],
      fetch: options.builtin?.fetch ?? [],
      browse: options.builtin?.browse ?? [],
    },
    http: providerHttp,
    clock: options.clock,
    logger: options.logger,
    extensionSetting: options.extensionSetting ?? (() => undefined),
  });
  const probes = createProbeCache(options.clock);
  const deps: WebDeps = {
    clock: options.clock,
    ids: options.ids,
    logger: options.logger,
    userAgent,
    settings: options.settings,
    access,
    content,
    robots: createRobotsGate({ access, content, clock: options.clock, userAgent }),
    convert,
    cache,
    meter,
    limits: createSessionLimits(),
    seen,
    sourceIds: createSourceIdRegistry(options.sessionSources),
    catalog,
    probes,
  };
  const browse = createBrowseApi(
    deps,
    options.browseConfirm === undefined ? {} : { confirm: options.browseConfirm },
  );
  return {
    service: createWebService(deps, browse),
    browse,
    deps,
    catalog,
    probes,
    cacheEnabled: cache !== undefined,
    purgeSessionRaw(liveSessions) {
      if (cache === undefined) return 0;
      const purged = cache.purgeSessionRaw(liveSessions);
      if (!purged.ok) {
        options.logger.warn("web.session_raw_purge_failed", { kind: purged.error.kind });
        return 0;
      }
      return purged.value.removed;
    },
    async close() {
      await browse.closeAll();
      await convert.close();
    },
  };
}
