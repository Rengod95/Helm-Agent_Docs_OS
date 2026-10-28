import { afterEach, describe, expect, test } from "bun:test";
import {
  CapabilityError,
  renderSearch,
  type ProviderSearchResult,
  type WebSearchOutput,
} from "@xeon/contracts/capabilities";
import { redactForPersistence } from "../src/contract/redact.ts";
import {
  fakeCatalog,
  fakeManifest,
  fakeSearchProvider,
  searchCandidate,
} from "../src/testing/fake-providers.ts";
import { threadIdOf } from "./support/ids.ts";
import { times } from "./support/seq.ts";
import { releaseStores } from "./support/store.ts";
import { makeWebWorld } from "./support/web-world.ts";

afterEach(releaseStores);

const MINUTE = 60_000;

async function rejection(promise: Promise<unknown>): Promise<CapabilityError> {
  const caught = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(caught instanceof CapabilityError)) throw new Error("expected a CapabilityError");
  return caught;
}

function manifestWithPolicy(name: string, cachePolicy: "none" | "session" | "persist") {
  return fakeManifest(name, {
    termsFlags: { cachePolicy, mayTrainOn: false, redistribution: "no", reviewedAt: "2026-10-01" },
  });
}

async function worldWith(
  provider = fakeSearchProvider("searxng"),
  policy: "none" | "session" | "persist" = "persist",
) {
  const world = await makeWebWorld({
    catalog: fakeCatalog([searchCandidate(provider, "detected", policy)]),
  });
  return { world, provider };
}

describe("search service", () => {
  test("a search returns ranked results, sources and an untrusted meta", async () => {
    const { world, provider } = await worldWith();
    const output = await world.search({ query: "xeon agents", limit: 2 });
    expect(output.results.map((result) => [result.rank, result.sourceId])).toEqual([
      [1, "s1"],
      [2, "s2"],
    ]);
    expect(output.sources.map((source) => source.id)).toEqual(["s1", "s2"]);
    expect(output.sources[0]).toMatchObject({ provider: "searxng", usage: { cache: "persist" } });
    expect(output.results[0]?.passages[0]).toMatchObject({ sourceId: "s1", kind: "snippet" });
    expect(output.meta).toMatchObject({
      provider: "searxng",
      selectedBy: "auto",
      cache: "miss",
      untrusted: true,
    });
    expect(output.meta.callId).toMatch(/^wcl_/);
    expect(output.meta.cost.basis).toBe("estimated");
    expect(provider.searches.length).toBe(1);
    expect(provider.searches[0]).toMatchObject({
      terms: "xeon agents",
      limit: 10,
      content: "snippets",
      freshness: "cached-ok",
    });
    // 모델에 가는 텍스트는 경계 안에 있고 출처 번호를 단다
    const rendered = renderSearch(output).content[0];
    const text = rendered?.type === "text" ? rendered.text : "";
    expect(text.startsWith('<untrusted_web_content sources="s1 s2">')).toBe(true);
    expect(text).toContain("[s1] xeon agents result 1");
  });

  test("the same url keeps its sN across calls of one session and numbers continue", async () => {
    const { world } = await worldWith();
    const thread = world.asModel(threadIdOf(1));
    const first = await world.search({ query: "alpha", limit: 2 }, thread);
    const second = await world.search(
      { query: "beta", limit: 2 },
      world.asModel(threadIdOf(1), "tool-2"),
    );
    expect(first.sources.map((source) => source.id)).toEqual(["s1", "s2"]);
    expect(second.sources.map((source) => source.id)).toEqual(["s3", "s4"]);
    const again = await world.search(
      { query: "alpha", limit: 2, freshness: "live" },
      world.asModel(threadIdOf(1), "tool-3"),
    );
    expect(again.sources.map((source) => source.id)).toEqual(["s1", "s2"]);
    // 다른 세션은 s1부터 센다
    const other = await world.search({ query: "alpha", limit: 2 }, world.asModel(threadIdOf(2)));
    expect(other.sources.map((source) => source.id)).toEqual(["s1", "s2"]);
  });

  test("result urls feed the seen urls of the session", async () => {
    const { world } = await worldWith();
    const thread = threadIdOf(1);
    const output = await world.search({ query: "alpha", limit: 1 }, world.asModel(thread));
    const seen = await world.deps.seen.has(thread, output.results[0]?.url ?? "");
    expect(seen.ok && seen.value).toBe(true);
  });

  test("a query with only directives is invalid input", async () => {
    const { world, provider } = await worldWith();
    expect((await rejection(world.search({ query: "   " }))).data.code).toBe("invalid_input");
    expect((await rejection(world.search({ query: "site:example.com" }))).data.code).toBe(
      "invalid_input",
    );
    expect(provider.searches.length).toBe(0);
  });

  test("directives are resolved before the provider sees the request", async () => {
    const { world, provider } = await worldWith();
    await world.search({
      query: 'agents site:docs.example.com -draft "exact words" after:2026-01-01',
      recency: "month",
      domains: { allow: ["a.example"], deny: ["b.example"] },
      objective: "find the guide",
      content: "highlights",
      limit: 12,
    });
    expect(provider.searches[0]).toMatchObject({
      terms: "agents",
      objective: "find the guide",
      limit: 20,
      recency: "month",
      content: "highlights",
      domains: { allow: ["a.example"], deny: ["b.example"] },
      directives: {
        site: ["docs.example.com"],
        phrases: ["exact words"],
        exclude: ["draft"],
        after: "2026-01-01",
      },
    });
  });

  test("results the provider did not filter are filtered by the front end", async () => {
    const provider = fakeSearchProvider("plugin:web-raw", {
      result: () => ({
        items: [
          {
            url: "https://docs.example.com/guide.pdf",
            title: "Guide",
            passages: [{ text: "agents", kind: "snippet" }],
          },
          {
            url: "https://blog.example.com/post",
            title: "Post",
            passages: [{ text: "agents", kind: "snippet" }],
          },
          {
            url: "https://ads.example.net/x",
            title: "Ad",
            passages: [{ text: "agents", kind: "snippet" }],
          },
        ],
        appliedNatively: [],
        warnings: [],
      }),
    });
    const world = await makeWebWorld({
      catalog: fakeCatalog([searchCandidate(provider, "plugin")]),
      settings: { policy: { deny: ["*.example.net"] } },
    });
    const output = await world.search({ query: "agents site:example.com filetype:pdf" });
    expect(output.results.map((result) => result.url)).toEqual([
      "https://docs.example.com/guide.pdf",
    ]);
    // 정책 deny에 걸린 도메인은 지시어와 상관없이 빠진다
    const all = await world.search({ query: "agents", freshness: "live" });
    expect(all.results.map((result) => result.url)).toEqual([
      "https://docs.example.com/guide.pdf",
      "https://blog.example.com/post",
    ]);
  });

  test("filters that remove everything are relaxed and reported", async () => {
    const provider = fakeSearchProvider("plugin:web-raw", {
      result: () => ({
        items: [
          {
            url: "https://a.example/x",
            title: "Plain",
            passages: [{ text: "plain text", kind: "snippet" }],
          },
        ],
        appliedNatively: [],
        warnings: [],
      }),
    });
    const world = await makeWebWorld({
      catalog: fakeCatalog([searchCandidate(provider, "plugin")]),
    });
    const output = await world.search({ query: 'agents "no such phrase" -plain' });
    expect(output.results.length).toBe(1);
    expect(output.relaxed).toEqual(["exclude", "phrase"]);
    expect(output.meta.warnings).toContain("filters_relaxed:exclude,phrase");
  });

  test("provider answers keep their citations as source ids", async () => {
    const provider = fakeSearchProvider("builtin-wrapper", {
      result: (): ProviderSearchResult => ({
        items: [
          {
            url: "https://a.example/1",
            title: "One",
            passages: [{ text: "first", kind: "snippet" }],
          },
          {
            url: "https://b.example/2",
            title: "Two",
            passages: [{ text: "second", kind: "snippet" }],
          },
        ],
        answer: {
          text: "A short answer.",
          citations: [{ itemIndex: 1, citedText: "second" }, { itemIndex: 7 }],
        },
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
        warnings: ["wrapper_continuation_limit"],
      }),
    });
    const world = await makeWebWorld({
      catalog: fakeCatalog([searchCandidate(provider, "builtin")]),
    });
    const output = await world.search({ query: "anything" });
    expect(output.answer).toEqual({
      text: "A short answer.",
      citations: [{ sourceId: "s2", citedText: "second" }],
    });
    expect(output.meta.warnings).toContain("wrapper_continuation_limit");
  });

  test("content none drops the passages and limit cuts the list", async () => {
    const { world } = await worldWith();
    const none = await world.search({ query: "alpha", content: "none", limit: 1 });
    expect(none.results.length).toBe(1);
    expect(none.results[0]?.passages).toEqual([]);
  });

  test("a registered secret in the query is refused before any provider call", async () => {
    const provider = fakeSearchProvider("searxng");
    const world = await makeWebWorld({
      catalog: fakeCatalog([searchCandidate(provider, "detected")]),
      secretValues: ["hunter2-top-secret"],
    });
    const failure = await rejection(world.search({ query: "what is hunter2-top-secret" }));
    expect(failure.data.code).toBe("denied");
    expect(failure.data.detail).toMatchObject({ reason: "secret_in_query" });
    expect(failure.message).not.toContain("hunter2");
    const viaObjective = await rejection(
      world.search({ query: "ok", objective: "hunter2-top-secret" }),
    );
    expect(viaObjective.data.code).toBe("denied");
    expect(provider.probes()).toBe(0);
  });

  test("session call limits", async () => {
    const { world } = await worldWith();
    const options = world.asModel(threadIdOf(1));
    await times(100, (index) => world.search({ query: `q${index}`, freshness: "live" }, options));
    const refused = await rejection(world.search({ query: "one more" }, options));
    expect(refused.data.code).toBe("session_limit");
    expect(refused.data.retryable).toBe(false);
    // 호스트 호출은 세지 않는다
    await world.search({ query: "host call" });
  });
});

describe("search cache", () => {
  test("a repeated query is served from the memo and costs nothing", async () => {
    const { world, provider } = await worldWith();
    const first = await world.search({ query: "alpha" });
    const second = await world.search({ query: "  alpha  " });
    expect(provider.searches.length).toBe(1);
    expect(second.meta.cache).toBe("hit");
    expect(second.meta.cost.basis).toBe("free");
    expect(second.results).toEqual(first.results);
    expect(second.meta.callId).not.toBe(first.meta.callId);
  });

  test("limit bucket", async () => {
    const { world, provider } = await worldWith();
    await world.search({ query: "alpha", limit: 7 });
    await world.search({ query: "alpha", limit: 10 });
    expect(provider.searches.length).toBe(1);
    await world.search({ query: "alpha", limit: 11 });
    expect(provider.searches.length).toBe(2);
    expect(provider.searches[1]?.limit).toBe(20);
  });

  test("memo entries expire after the ttl, live bypasses and prefer-fresh revalidates", async () => {
    const { world, provider } = await worldWith();
    await world.search({ query: "alpha" });
    world.clock.advance(19 * MINUTE);
    expect((await world.search({ query: "alpha" })).meta.cache).toBe("hit");
    world.clock.advance(2 * MINUTE);
    expect((await world.search({ query: "alpha" })).meta.cache).toBe("miss");
    expect(provider.searches.length).toBe(2);

    const live = await world.search({ query: "alpha", freshness: "live" });
    expect(live.meta.cache).toBe("bypass");
    expect(provider.searches.length).toBe(3);

    world.clock.advance(5 * MINUTE);
    expect((await world.search({ query: "alpha", freshness: "prefer-fresh" })).meta.cache).toBe(
      "hit",
    );
    world.clock.advance(6 * MINUTE);
    const revalidated = await world.search({ query: "alpha", freshness: "prefer-fresh" });
    expect(revalidated.meta.cache).toBe("stale-revalidated");
    expect(provider.searches.length).toBe(4);
  });

  test("a different session gets its own source numbers from the shared memo", async () => {
    const { world, provider } = await worldWith();
    const a = await world.search({ query: "alpha", limit: 2 }, world.asModel(threadIdOf(1)));
    await world.search({ query: "other", limit: 2 }, world.asModel(threadIdOf(2), "tool-2"));
    const b = await world.search(
      { query: "alpha", limit: 2 },
      world.asModel(threadIdOf(2), "tool-3"),
    );
    expect(provider.searches.length).toBe(2);
    expect(b.meta.cache).toBe("hit");
    expect(a.sources.map((source) => source.id)).toEqual(["s1", "s2"]);
    // 두 번째 세션은 앞서 s1, s2를 썼으므로 같은 URL이 그 번호를 그대로 쓴다
    expect(b.sources.map((source) => source.url)).toEqual(a.sources.map((source) => source.url));
    expect(b.sources.map((source) => source.id)).toEqual(["s3", "s4"]);
  });

  test("single flight", async () => {
    const { world, provider } = await worldWith();
    const hold = provider.hold();
    const first = world.search({ query: "alpha" });
    const second = world.search({ query: "alpha" });
    await Promise.resolve();
    hold.release();
    const [one, two] = await Promise.all([first, second]);
    expect(provider.searches.length).toBe(1);
    expect(one.results).toEqual(two.results);
    // 동시 호출도 각자 호출 ID를 받는다
    expect(one.meta.callId).not.toBe(two.meta.callId);
  });

  test("brave none never on disk", async () => {
    const provider = fakeSearchProvider("plugin:web-brave", {
      manifest: manifestWithPolicy("web-brave", "none"),
    });
    const world = await makeWebWorld({
      catalog: fakeCatalog([searchCandidate(provider, "plugin", "none")]),
    });
    const first = await world.search({ query: "alpha" });
    const second = await world.search({ query: "alpha" });
    expect(provider.searches.length).toBe(2);
    expect(second.meta.cache).toBe("miss");
    expect(first.sources[0]?.usage.cache).toBe("none");
    const counts = (await world.store?.rowCounts()) ?? {};
    expect(counts["cap_web_fetch_cache"]).toBe(0);
    expect(counts["cap_web_raw"]).toBe(0);
    // 영속 사본은 발췌를 지운다
    const redacted = redactForPersistence(first);
    expect(redacted.results[0]?.passages.every((passage) => passage.text === "")).toBe(true);
    expect(redacted.results[0]?.url).toBe(first.results[0]?.url ?? "");
  });

  test("fallback result not cached under first provider", async () => {
    const first = fakeSearchProvider("plugin:web-first", {
      availability: { ok: false, reason: "unreachable" },
    });
    const second = fakeSearchProvider("builtin-wrapper");
    const world = await makeWebWorld({
      catalog: fakeCatalog([searchCandidate(first, "plugin"), searchCandidate(second, "builtin")]),
    });
    await world.search({ query: "alpha" });
    await world.search({ query: "alpha" });
    // 첫 후보가 응답하지 않았으므로 메모에 넣지 않는다
    expect(second.searches.length).toBe(2);
    // 첫 후보가 살아나면 그 결과는 메모에 들어간다
    world.deps.probes.forget();
    first.setAvailability({ ok: true });
    await world.search({ query: "alpha" });
    const hit = await world.search({ query: "alpha" });
    expect(hit.meta.cache).toBe("hit");
    expect(hit.meta.provider).toBe("plugin:web-first");
  });

  test("an answer from a different chain does not reuse the memo", async () => {
    const { world, provider } = await worldWith();
    await world.search({ query: "alpha" });
    world.setSettings({
      ...world.settings(),
      search: { ...world.settings().search, provider: "searxng" },
    });
    await world.search({ query: "alpha" });
    expect(provider.searches.length).toBe(1);
  });
});

describe("search cost", () => {
  test("reported vs estimated vs free", async () => {
    const reported = fakeSearchProvider("plugin:web-reported", {
      result: (): ProviderSearchResult => ({
        items: [{ url: "https://a.example/1", passages: [{ text: "x", kind: "snippet" }] }],
        cost: { usd: 0.0123, basis: "reported", units: [{ name: "search", count: 1 }] },
        appliedNatively: [],
        warnings: [],
      }),
    });
    const estimated = fakeSearchProvider("plugin:web-estimated");
    const free = fakeSearchProvider("searxng", {
      manifest: fakeManifest("searxng", {
        pricing: {
          asOf: "2026-10-20",
          sourceUrl: "https://searxng.example",
          currency: "USD",
          units: {},
        },
      }),
    });
    const world = await makeWebWorld({
      catalog: fakeCatalog([
        searchCandidate(reported, "plugin"),
        searchCandidate(estimated, "plugin"),
        searchCandidate(free, "detected"),
      ]),
    });
    const a = await world.search({ query: "q", provider: "plugin:web-reported" });
    expect(a.meta.cost).toMatchObject({ basis: "reported", usd: 0.0123 });
    const b = await world.search({ query: "q", provider: "plugin:web-estimated" });
    expect(b.meta.cost).toMatchObject({ basis: "estimated", pricingAsOf: "2026-10-20" });
    expect(b.meta.cost.usd).toBeGreaterThan(0.004);
    const c = await world.search({ query: "q", provider: "searxng" });
    expect(c.meta.cost.usd).toBe(0);
    // 사용량 표에 provider별로 쌓인다
    const totals = world.deps.meter?.monthTotals("plugin:web-estimated");
    expect(totals?.ok && totals.value.find((row) => row.name === "search")?.count).toBe(1);
  });

  test("a stale price table warns and a spent free allowance warns", async () => {
    const stale = fakeManifest("web-old", {
      pricing: {
        asOf: "2026-01-01",
        sourceUrl: "https://old.example/pricing",
        currency: "USD",
        units: { search: 1 },
        freeAllowance: { period: "month", usd: 3 },
      },
    });
    const provider = fakeSearchProvider("plugin:web-old", { manifest: stale });
    const world = await makeWebWorld({
      catalog: fakeCatalog([searchCandidate(provider, "plugin")]),
    });
    const first = await world.search({ query: "one" });
    expect(first.meta.warnings).toContain("pricing_stale:plugin:web-old:2026-01-01");
    await world.search({ query: "two" });
    const third = await world.search({ query: "three" });
    expect(third.meta.warnings).toContain("free_allowance_exhausted:plugin:web-old");
  });

  test("without a store the search still works and is not metered", async () => {
    const provider = fakeSearchProvider("searxng");
    const world = await makeWebWorld({
      withStore: false,
      catalog: fakeCatalog([searchCandidate(provider, "detected")]),
    });
    const output: WebSearchOutput = await world.search({ query: "alpha" });
    expect(output.results.length).toBeGreaterThan(0);
    expect(world.deps.meter).toBeUndefined();
  });
});
