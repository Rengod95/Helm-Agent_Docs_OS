import type {
  Source,
  WebCallMeta,
  WebFetchOutput,
  WebSearchOutput,
} from "../../../src/capabilities/index.ts";

/** 웹 정의 시험이 함께 쓰는 올바른 값 */
export const SAMPLE_META: WebCallMeta = {
  callId: "wcl_01J00000000000000000000000",
  provider: "searxng",
  selectedBy: "auto",
  fallbacks: [{ provider: "plugin:web-exa", stage: "probe", reason: "no-key" }],
  cache: "miss",
  latencyMs: 120,
  cost: { usd: 0, basis: "free", units: [{ name: "search", count: 1 }] },
  warnings: [],
  untrusted: true,
};

export function sampleSource(id: string, url: string): Source {
  return {
    id,
    url,
    title: `title of ${id}`,
    publishedAt: "2026-09-30",
    retrievedAt: "2026-10-23T01:02:03Z",
    provider: "searxng",
    usage: { cache: "persist" },
  };
}

export const SAMPLE_SEARCH_OUTPUT: WebSearchOutput = {
  results: [
    {
      rank: 1,
      sourceId: "s1",
      url: "https://example.com/a",
      title: "A page",
      publishedAt: "2026-09-30",
      passages: [
        { sourceId: "s1", text: "first excerpt", kind: "snippet" },
        { sourceId: "s1", text: "second excerpt", kind: "highlight" },
      ],
    },
    {
      rank: 2,
      sourceId: "s2",
      url: "https://example.org/b",
      passages: [{ sourceId: "s2", text: "only excerpt", kind: "snippet" }],
    },
  ],
  sources: [
    sampleSource("s1", "https://example.com/a"),
    sampleSource("s2", "https://example.org/b"),
  ],
  meta: SAMPLE_META,
};

export const SAMPLE_FETCH_OUTPUT: WebFetchOutput = {
  pages: [
    {
      source: {
        ...sampleSource("s1", "https://example.com/a"),
        rawRef: `webraw:${"a".repeat(64)}`,
      },
      status: 200,
      contentType: "text/html",
      bytes: 4096,
      content: "# Heading\n\nbody",
      truncated: { shown: 15, total: 40_000, nextOffset: 15 },
      method: "readability",
    },
  ],
  meta: SAMPLE_META,
};
