import type {
  ProviderAvailabilityWeb,
  ProviderFetchRequest,
  ProviderFetchResult,
  ProviderSearchRequest,
  ProviderSearchResult,
  WebFetchProvider,
  WebProviderManifest,
  WebSearchProvider,
} from "@xeon/contracts/capabilities";
import type {
  BrowseCandidate,
  FetchCandidate,
  SearchCandidate,
  WebProviderCatalog,
} from "../ports/providers.ts";

// 매니페스트를 받는 가짜 검색·fetch provider와 후보 목록(L2.web.plan §2 testing/fake-providers.ts).

export function fakeManifest(
  name: string,
  overrides: Partial<WebProviderManifest> = {},
): WebProviderManifest {
  return {
    name,
    displayName: name,
    services: ["search", "fetch"],
    endpoints: [`api.${name}.example`],
    auth: { kind: "none", secrets: [] },
    pricing: {
      asOf: "2026-10-20",
      sourceUrl: `https://${name}.example/pricing`,
      currency: "USD",
      units: { search: 0.005, page_content: 0.002 },
    },
    termsFlags: {
      cachePolicy: "session",
      mayTrainOn: "unknown",
      redistribution: "unknown",
      reviewedAt: "2026-10-01",
    },
    privacy: { zdr: "unknown", sendsTelemetry: false },
    limits: {},
    ...overrides,
  };
}

export interface FakeSearchProvider extends WebSearchProvider {
  readonly searches: ProviderSearchRequest[];
  readonly probes: () => number;
  setAvailability(next: ProviderAvailabilityWeb): void;
  /** 다음 호출부터 던질 오류. undefined면 정상 응답 */
  failWith(thrown: Error | undefined): void;
  /** 응답 전에 풀어 줄 때까지 기다린다(single-flight 시험) */
  hold(): { release(): void };
}

export interface FakeSearchOptions {
  readonly manifest?: WebProviderManifest;
  readonly availability?: ProviderAvailabilityWeb;
  readonly result?: (request: ProviderSearchRequest) => ProviderSearchResult;
}

function defaultSearchResult(id: string): (request: ProviderSearchRequest) => ProviderSearchResult {
  return (request) => ({
    items: Array.from({ length: Math.min(request.limit, 3) }, (_, index) => ({
      url: `https://${id.replace(/[^a-z0-9]/g, "")}.example/${encodeURIComponent(request.terms)}/${index + 1}`,
      title: `${request.terms} result ${index + 1}`,
      passages: [{ text: `snippet ${index + 1} for ${request.terms}`, kind: "snippet" }],
    })),
    appliedNatively: [
      "recency",
      "domains",
      "site",
      "filetype",
      "intitle",
      "phrase",
      "exclude",
      "date",
    ],
    warnings: [],
  });
}

export function fakeSearchProvider(
  id: string,
  options: FakeSearchOptions = {},
): FakeSearchProvider {
  const searches: ProviderSearchRequest[] = [];
  let availability: ProviderAvailabilityWeb = options.availability ?? { ok: true };
  let thrown: Error | undefined;
  let gate: Promise<void> | undefined;
  let probeCount = 0;
  const respond = options.result ?? defaultSearchResult(id);
  return {
    id,
    manifest:
      options.manifest ?? fakeManifest(id.replace(/^plugin:/, ""), { services: ["search"] }),
    searches,
    probes: () => probeCount,
    setAvailability(next) {
      availability = next;
    },
    failWith(value) {
      thrown = value;
    },
    hold() {
      const slot: { release?: () => void } = {};
      gate = new Promise<void>((resolve) => {
        slot.release = resolve;
      });
      return {
        release: () => {
          slot.release?.();
        },
      };
    },
    isAvailable() {
      probeCount += 1;
      return Promise.resolve(availability);
    },
    async search(request) {
      searches.push(request);
      if (gate !== undefined) await gate;
      if (thrown !== undefined) throw thrown;
      return respond(request);
    },
  };
}

export interface FakeFetchProvider extends WebFetchProvider {
  readonly fetches: ProviderFetchRequest[];
  setAvailability(next: ProviderAvailabilityWeb): void;
  failWith(thrown: Error | undefined): void;
}

export interface FakeFetchOptions {
  readonly manifest?: WebProviderManifest;
  readonly availability?: ProviderAvailabilityWeb;
  readonly result?: (request: ProviderFetchRequest) => ProviderFetchResult;
}

export function fakeFetchProvider(id: string, options: FakeFetchOptions = {}): FakeFetchProvider {
  const fetches: ProviderFetchRequest[] = [];
  let availability: ProviderAvailabilityWeb = options.availability ?? { ok: true };
  let thrown: Error | undefined;
  return {
    id,
    manifest: options.manifest ?? fakeManifest(id.replace(/^plugin:/, ""), { services: ["fetch"] }),
    fetches,
    setAvailability(next) {
      availability = next;
    },
    failWith(value) {
      thrown = value;
    },
    isAvailable: () => Promise.resolve(availability),
    fetch(request) {
      fetches.push(request);
      if (thrown !== undefined)
        return Promise.reject(thrown instanceof Error ? thrown : new Error("failed"));
      return Promise.resolve(
        options.result?.(request) ?? {
          finalUrl: request.url,
          status: 200,
          contentType: "text/markdown",
          markdown: `# Rendered by ${id}\n\nThe page content as read by the provider, long enough to count as content.`,
          title: `Rendered by ${id}`,
          warnings: [],
        },
      );
    },
  };
}

export function searchCandidate(
  provider: WebSearchProvider,
  origin: SearchCandidate["origin"],
  cachePolicy: SearchCandidate["cachePolicy"] = "session",
): SearchCandidate {
  return { provider, origin, cachePolicy };
}

export function fetchCandidate(
  provider: WebFetchProvider,
  origin: FetchCandidate["origin"] = "plugin",
  cachePolicy: FetchCandidate["cachePolicy"] = "session",
): FetchCandidate {
  return { provider, origin, cachePolicy };
}

export function fakeCatalog(
  search: readonly SearchCandidate[] = [],
  fetch: readonly FetchCandidate[] = [],
  browse: readonly BrowseCandidate[] = [],
): WebProviderCatalog {
  return {
    searchCandidates: () => search,
    fetchCandidates: () => fetch,
    browseCandidates: () => browse,
  };
}
