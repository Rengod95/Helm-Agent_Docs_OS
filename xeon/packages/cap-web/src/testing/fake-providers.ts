import type {
  ProviderAvailabilityWeb,
  ProviderFetchRequest,
  ProviderFetchResult,
  WebFetchProvider,
  WebProviderManifest,
} from "@xeon/contracts/capabilities";
import type { FetchCandidate, SearchCandidate, WebProviderCatalog } from "../ports/providers.ts";

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
): WebProviderCatalog {
  return { searchCandidates: () => search, fetchCandidates: () => fetch };
}
