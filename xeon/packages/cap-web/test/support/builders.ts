import type {
  CacheUsage,
  Cost,
  Source,
  WebCallMeta,
  WebFetchPage,
} from "@fresnel/contracts/capabilities";

const FREE_COST: Cost = { usd: 0, basis: "free", units: [] };

export function metaOf(overrides: Partial<WebCallMeta> = {}): WebCallMeta {
  return {
    callId: "wcl_01ARZ3NDEKTSV4RRFFQ5000001",
    provider: "plugin:example-search",
    selectedBy: "auto",
    fallbacks: [],
    cache: "miss",
    latencyMs: 0,
    cost: FREE_COST,
    warnings: [],
    untrusted: true,
    ...overrides,
  };
}

export function sourceOf(
  id: string,
  url: string,
  cache: CacheUsage = "persist",
  overrides: Partial<Source> = {},
): Source {
  return {
    id,
    url,
    retrievedAt: "2026-10-24T00:00:00Z",
    provider: "plugin:example-search",
    usage: { cache },
    ...overrides,
  };
}

export function pageOf(
  source: Source,
  content: string,
  overrides: Partial<WebFetchPage> = {},
): WebFetchPage {
  return {
    source,
    status: 200,
    contentType: "text/html",
    bytes: content.length,
    content,
    truncated: { shown: content.length, total: content.length },
    method: "readability",
    ...overrides,
  };
}
