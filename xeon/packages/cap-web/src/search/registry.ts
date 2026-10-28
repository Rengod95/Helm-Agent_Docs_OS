import { assertNever, attempt, parse, type Clock, type Logger } from "@xeon/contracts";
import {
  WebProviderManifestSchema,
  type CacheUsage,
  type WebFetchProvider,
  type WebSearchProvider,
  webRegistrationCapability,
  type WebProviderRegistration,
} from "@xeon/contracts/capabilities";
import { effectiveCachePolicy } from "../cache/policy.ts";
import { createBoundProviderHttp, type ProviderHttpDeps } from "../policy/guarded-http.ts";
import type { FetchCandidate, SearchCandidate, WebProviderCatalog } from "../ports/providers.ts";

// L2.web.plan B7. 능력별 provider 후보 레지스트리: 플러그인 등록(X가 넘기는 `WebProviderRegistration`)을 provider로 만들고,
// 내장 provider와 함께 `WebProviderCatalog`로 낸다. 후보 등록·조회 API의 이름은 X가 정한다 [가정]. 여기서는 목록 포트를 받는다.

export interface PluginRegistration {
  /** 확장 이름. provider ID는 `plugin:<extension>`이다 */
  readonly extension: string;
  readonly registration: WebProviderRegistration;
}

export interface RegistrationSource {
  list(): readonly PluginRegistration[];
}

export interface ProviderRegistryDeps {
  readonly source: RegistrationSource;
  /** 내장 provider 후보(searxng, builtin-wrapper). 내장 `local`은 후보가 아니라 fetch 파이프라인 자체다 */
  readonly builtin: {
    readonly search: readonly SearchCandidate[];
    readonly fetch: readonly FetchCandidate[];
  };
  readonly http: ProviderHttpDeps;
  readonly clock: Clock;
  readonly logger: Logger;
  /** `ext.<extension>.<key>` 설정 읽기. 비밀 키는 SecretRef 문자열만 보인다 */
  readonly extensionSetting: (extension: string, key: string) => unknown;
}

type Created =
  | { readonly kind: "search"; readonly candidate: SearchCandidate }
  | { readonly kind: "fetch"; readonly candidate: FetchCandidate }
  | { readonly kind: "invalid" };

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : "unknown error";
}

export function createProviderRegistry(deps: ProviderRegistryDeps): WebProviderCatalog {
  const created = new Map<string, Created>();

  function instantiate(entry: PluginRegistration): Created {
    const { extension, registration } = entry;
    const bound = createBoundProviderHttp(deps.http);
    const context = {
      http: bound.http,
      clock: deps.clock,
      setting: (key: string): unknown => deps.extensionSetting(extension, key),
    };
    const reject = (reason: string, detail?: string): Created => {
      deps.logger.warn("web.provider_rejected", {
        extension,
        capability: webRegistrationCapability(registration),
        reason,
        ...(detail === undefined ? {} : { detail: detail.slice(0, 200) }),
      });
      return { kind: "invalid" };
    };
    /** 공통 검증: ID, 매니페스트 스키마, 선언한 서비스. 통과하면 매니페스트를 묶고 유효 cachePolicy를 돌려준다 */
    const check = (
      provider: WebSearchProvider | WebFetchProvider,
      service: "search" | "fetch",
    ): CacheUsage | undefined => {
      if (provider.id !== `plugin:${extension}`) {
        reject("provider_id_mismatch");
        return undefined;
      }
      const manifest = parse(WebProviderManifestSchema, provider.manifest);
      if (!manifest.ok) {
        reject("manifest_invalid");
        return undefined;
      }
      if (!manifest.value.services.includes(service)) {
        reject("service_not_declared");
        return undefined;
      }
      bound.bind(manifest.value);
      const effective = effectiveCachePolicy(manifest.value);
      if (effective.downgraded) {
        deps.logger.warn("web.cache_policy_downgraded", {
          provider: provider.id,
          declared: "persist",
          effective: effective.policy,
          reason: "terms_not_reviewed",
        });
      }
      return effective.policy;
    };
    switch (registration.capability) {
      case "web.search": {
        const made = attempt(() => registration.create(context));
        if (!made.ok) return reject("create_failed", describe(made.error.cause));
        const policy = check(made.value, "search");
        if (policy === undefined) return { kind: "invalid" };
        return {
          kind: "search",
          candidate: { provider: made.value, origin: "plugin", cachePolicy: policy },
        };
      }
      case "web.fetch": {
        const made = attempt(() => registration.create(context));
        if (!made.ok) return reject("create_failed", describe(made.error.cause));
        const policy = check(made.value, "fetch");
        if (policy === undefined) return { kind: "invalid" };
        return {
          kind: "fetch",
          candidate: { provider: made.value, origin: "plugin", cachePolicy: policy },
        };
      }
      case "web.browse":
        // 브라우저 provider는 web.browse(B10)가 들어올 때 연결한다
        return reject("browse_not_supported_yet");
      default:
        return assertNever(registration, "WebProviderRegistration");
    }
  }

  function refresh(): void {
    const present = new Set<string>();
    for (const entry of deps.source.list()) {
      const key = `${entry.extension}:${entry.registration.capability}`;
      present.add(key);
      if (!created.has(key)) created.set(key, instantiate(entry));
    }
    for (const key of created.keys()) {
      if (!present.has(key)) created.delete(key);
    }
  }

  return {
    searchCandidates() {
      refresh();
      const plugin: SearchCandidate[] = [];
      for (const entry of created.values())
        if (entry.kind === "search") plugin.push(entry.candidate);
      const builtin = deps.builtin.search.filter(
        (candidate) => candidate.enabled === undefined || candidate.enabled(),
      );
      return [...builtin, ...plugin];
    },
    fetchCandidates() {
      refresh();
      const plugin: FetchCandidate[] = [];
      for (const entry of created.values())
        if (entry.kind === "fetch") plugin.push(entry.candidate);
      return [...deps.builtin.fetch, ...plugin];
    },
  };
}
