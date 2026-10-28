import { afterEach, describe, expect, test } from "bun:test";
import type { Logger, LogFields } from "@xeon/contracts";
import type { ProviderSearchRequest } from "@xeon/contracts/capabilities";
import { WebHttpError } from "../src/policy/guarded-http.ts";
import { createSearxngProvider } from "../src/search/providers/searxng.ts";
import { parseSearchQuery } from "../src/search/query.ts";
import { fakeResolver } from "../src/testing/fake-resolver.ts";
import { fixtureTransport, type FixtureTransport } from "../src/testing/http-fixtures.ts";
import { releaseStores } from "./support/store.ts";
import { makeWebWorld } from "./support/web-world.ts";

afterEach(releaseStores);

const SIGNAL = new AbortController().signal;
const PROBE = (base: string): string => `${base}/search?q=xeon&format=json&pageno=1`;

const SEARX_BODY = JSON.stringify({
  query: "xeon",
  number_of_results: 3,
  results: [
    {
      url: "https://docs.example.org/guide",
      title: "  Guide  ",
      content: "How   to\nset it up",
      publishedDate: "2025-04-30T10:15:00",
      engine: "duckduckgo",
      score: 4.2,
    },
    { url: "javascript:alert(1)", title: "bad scheme", content: "x" },
    { url: "not a url", title: "bad url" },
    { title: "no url" },
    { url: "http://blog.example.org/post", title: "Post", content: "", publishedDate: null },
    {
      url: "https://dated.example.org/",
      title: "Dated",
      publishedDate: "2024-01-02T03:04:05+09:00",
    },
  ],
  unresponsive_engines: [
    ["brave", "timeout"],
    ["startpage", "CAPTCHA"],
  ],
});

interface Logged {
  readonly event: string;
  readonly fields: LogFields | undefined;
}

function recordingLogger(lines: Logged[]): Logger {
  const logger: Logger = {
    debug() {},
    info() {},
    warn: (event, fields) => {
      lines.push({ event, fields });
    },
    error() {},
    child: () => logger,
  };
  return logger;
}

function request(query = "xeon", overrides: Partial<ProviderSearchRequest> = {}) {
  const parsed = parseSearchQuery(query);
  const value: ProviderSearchRequest = {
    terms: parsed.terms,
    directives: parsed.directives,
    limit: 10,
    domains: { allow: [], deny: [] },
    content: "snippets",
    freshness: "cached-ok",
    ...overrides,
  };
  return value;
}

function setup(
  settings: { url: string },
  routes: Readonly<Record<string, Parameters<FixtureTransport["route"]>[1]>> = {},
) {
  const resolver = fakeResolver({
    localhost: ["127.0.0.1"],
    "searx.example.org": ["93.184.216.34"],
  });
  const transport = fixtureTransport(routes, resolver);
  const logs: Logged[] = [];
  const provider = createSearxngProvider({
    http: { resolver, transport, secrets: undefined, guard: undefined },
    settings: () => settings,
    logger: recordingLogger(logs),
  });
  return { provider, transport, logs, settings };
}

async function failure(promise: Promise<unknown>) {
  const caught = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(caught instanceof WebHttpError)) throw new Error("expected a WebHttpError");
  return caught.failure;
}

const urlsOf = (transport: FixtureTransport): string[] =>
  transport.requests.map((sent) => sent.url);

describe("searxng configured address", () => {
  // 감지 후보였던 주소들. 어느 하나라도 물어보면 시험이 실패하도록 모두 성공 응답을 걸어 둔다
  const FORMER_DETECT_ADDRESSES = [
    "http://127.0.0.1:8888",
    "http://127.0.0.1:8080",
    "http://localhost:8888",
    "http://localhost:8080",
  ];
  const answering = Object.fromEntries(
    FORMER_DETECT_ADDRESSES.map((base) => [PROBE(base), { body: SEARX_BODY }]),
  );

  test("without an address no former detect address is probed even when one would answer", async () => {
    const { provider, transport } = setup({ url: "" }, answering);
    expect(await provider.isAvailable(SIGNAL)).toMatchObject({
      ok: false,
      reason: "unreachable",
      detail: "no SearXNG address is set (l2.web.search.searxng.url)",
    });
    expect(transport.requests).toHaveLength(0);
    expect(transport.connections()).toBe(0);
  });

  test("a search without an address fails closed and sends nothing", async () => {
    const { provider, transport } = setup({ url: "" }, answering);
    const failed = await failure(provider.search(request(), SIGNAL));
    expect(failed.code).toBe("unavailable");
    expect(failed.retryable).toBe(false);
    expect(transport.requests).toHaveLength(0);
  });

  test("a configured address is the only one asked", async () => {
    const { provider, transport } = setup(
      { url: "http://localhost:9999/searx/" },
      { [PROBE("http://localhost:9999/searx")]: { body: SEARX_BODY } },
    );
    expect(await provider.isAvailable(SIGNAL)).toEqual({ ok: true });
    expect(urlsOf(transport)).toEqual([PROBE("http://localhost:9999/searx")]);
  });

  test("json 403 maps to json-disabled and warns once", async () => {
    const { provider, logs } = setup(
      { url: "http://127.0.0.1:8888" },
      { [PROBE("http://127.0.0.1:8888")]: { status: 403, body: "Forbidden" } },
    );
    expect(await provider.isAvailable(SIGNAL)).toMatchObject({
      ok: false,
      reason: "json-disabled",
    });
    await provider.isAvailable(SIGNAL);
    expect(logs.filter((line) => line.event === "web.searxng_json_disabled")).toHaveLength(1);
  });

  test("a page that is not search json is unreachable", async () => {
    const { provider } = setup(
      { url: "http://127.0.0.1:8888" },
      { [PROBE("http://127.0.0.1:8888")]: { body: "<html>hello</html>" } },
    );
    expect(await provider.isAvailable(SIGNAL)).toMatchObject({ ok: false, reason: "unreachable" });
  });

  test("a metadata address is refused even as a configured endpoint", async () => {
    const { provider, transport } = setup({ url: "http://169.254.169.254" });
    expect(await provider.isAvailable(SIGNAL)).toMatchObject({ ok: false, reason: "unreachable" });
    expect(transport.connections()).toBe(0);
  });

  test("an invalid configured address is unreachable without a request", async () => {
    const { provider, transport } = setup({ url: "ftp://127.0.0.1:8888" });
    expect(await provider.isAvailable(SIGNAL)).toMatchObject({ ok: false, reason: "unreachable" });
    expect(transport.requests).toHaveLength(0);
  });
});

describe("searxng search", () => {
  const BASE = "http://127.0.0.1:8888";
  const searchUrl = (q: string, extra: Record<string, string> = {}): string =>
    `${BASE}/search?${new URLSearchParams({ q, format: "json", pageno: "1", categories: "general", ...extra }).toString()}`;

  test("normalize searxng results", async () => {
    const { provider } = setup({ url: BASE }, { [searchUrl("xeon")]: { body: SEARX_BODY } });
    const result = await provider.search(request(), SIGNAL);
    expect(result.items).toEqual([
      {
        url: "https://docs.example.org/guide",
        title: "Guide",
        publishedAt: "2025-04-30T10:15:00.000Z",
        passages: [{ text: "How to set it up", kind: "snippet" }],
      },
      { url: "http://blog.example.org/post", title: "Post", passages: [] },
      {
        url: "https://dated.example.org/",
        title: "Dated",
        publishedAt: "2024-01-01T18:04:05.000Z",
        passages: [],
      },
    ]);
    expect(result.warnings).toEqual([
      "searxng_engine_unresponsive:brave",
      "searxng_engine_unresponsive:startpage",
    ]);
    expect(result.appliedNatively).toEqual([]);
  });

  test("directives become engine operators and recency becomes time_range", async () => {
    const q = 'foo "exact phrase" -spam site:docs.example.org filetype:pdf intitle:"a b"';
    const { provider, transport } = setup(
      { url: BASE },
      {
        [searchUrl('foo "exact phrase" -spam site:docs.example.org filetype:pdf intitle:"a b"', {
          time_range: "week",
        })]: { body: SEARX_BODY },
      },
    );
    const result = await provider.search(request(q, { recency: "week" }), SIGNAL);
    expect(result.appliedNatively).toEqual(["recency"]);
    expect(transport.requests).toHaveLength(1);
  });

  test("several site operators are left to the post filter", async () => {
    const { provider } = setup({ url: BASE }, { [searchUrl("foo")]: { body: SEARX_BODY } });
    const result = await provider.search(request("foo site:a.example site:b.example"), SIGNAL);
    expect(result.items.length).toBeGreaterThan(0);
  });

  test("status codes map to call failures", async () => {
    const cases = [
      { status: 403, code: "unavailable", detail: { reason: "json-disabled" } },
      { status: 429, code: "rate_limited", retryAfterMs: 7000 },
      { status: 502, code: "upstream_error" },
    ] as const;
    const failures = await Promise.all(
      cases.map((item) => {
        const { provider } = setup(
          { url: BASE },
          {
            [searchUrl("xeon")]: {
              status: item.status,
              headers: { "retry-after": "7" },
              body: "x",
            },
          },
        );
        return failure(provider.search(request(), SIGNAL));
      }),
    );
    for (const [index, item] of cases.entries()) {
      expect(failures[index]?.code).toBe(item.code);
      if ("detail" in item) expect(failures[index]?.detail).toEqual(item.detail);
      if ("retryAfterMs" in item) expect(failures[index]?.retryAfterMs).toBe(item.retryAfterMs);
    }
  });

  test("every engine failing is an upstream error the chain can route around", async () => {
    const { provider } = setup(
      { url: BASE },
      {
        [searchUrl("xeon")]: {
          body: JSON.stringify({
            query: "xeon",
            results: [],
            unresponsive_engines: [["brave", "timeout"]],
          }),
        },
      },
    );
    expect((await failure(provider.search(request(), SIGNAL))).code).toBe("upstream_error");
  });

  test("a body that is not search json is an upstream error", async () => {
    const { provider } = setup({ url: BASE }, { [searchUrl("xeon")]: { body: "oops" } });
    expect((await failure(provider.search(request(), SIGNAL))).code).toBe("upstream_error");
  });
});

describe("searxng through the service", () => {
  const BASE = "http://127.0.0.1:8888";

  test("results carry session source ids and a free cost", async () => {
    const world = await makeWebWorld({
      builtinSearch: true,
      settings: { search: { searxng: { url: BASE } } },
      hosts: { localhost: ["127.0.0.1"] },
    });
    world.transport.route(PROBE(BASE), { body: SEARX_BODY });
    world.transport.route(`${BASE}/search?q=xeon&format=json&pageno=1&categories=general`, {
      body: SEARX_BODY,
    });
    const found = await world.search({ query: "xeon" });
    expect(found.meta.provider).toBe("searxng");
    expect(found.meta.selectedBy).toBe("auto");
    expect(found.meta.cost).toMatchObject({ basis: "free", usd: 0 });
    expect(found.results.map((result) => result.sourceId)).toEqual(["s1", "s2", "s3"]);
    expect(found.sources[0]?.usage.cache).toBe("persist");
  });

  test("searxng loopback endpoint exception is provider-only", async () => {
    const world = await makeWebWorld({
      builtinSearch: true,
      settings: { search: { searxng: { url: BASE } } },
    });
    world.transport.route(PROBE(BASE), { body: SEARX_BODY });
    world.transport.route(`${BASE}/search?q=xeon&format=json&pageno=1&categories=general`, {
      body: SEARX_BODY,
    });
    await world.search({ query: "xeon" });
    const before = world.transport.requests.length;
    // 같은 주소를 콘텐츠 URL로 읽으려 하면 거부된다. 연결 시도가 없다
    const denied = await world.fetch({ url: `${BASE}/` }).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(denied).toMatchObject({ data: { code: "denied" } });
    expect(world.transport.requests).toHaveLength(before);
  });
});
