import { afterEach, describe, expect, test } from "bun:test";
import {
  CapabilityError,
  type ProviderSearchItem,
  type ProviderSearchResult,
  type WebSearchOutput,
} from "@xeon/contracts/capabilities";
import {
  fakeCatalog,
  fakeManifest,
  fakeSearchProvider,
  searchCandidate,
} from "../src/testing/fake-providers.ts";
import { releaseStores } from "./support/store.ts";
import { makeWebWorld } from "./support/web-world.ts";

afterEach(releaseStores);

async function rejection(promise: Promise<unknown>): Promise<CapabilityError> {
  const caught = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(caught instanceof CapabilityError)) throw new Error("expected a CapabilityError");
  return caught;
}

function capabilityError(code: string): CapabilityError {
  return new CapabilityError({
    capability: "web.search",
    method: "search",
    code,
    message: `${code} from the provider`,
    retryable: code !== "invalid_input",
  });
}

/** 주어진 URL을 차례로 돌려주는 응답. 필터 차원은 앞단이 다시 건다 */
function pages(...urls: readonly string[]): ProviderSearchResult {
  return {
    items: urls.map((url): ProviderSearchItem => ({
      url,
      title: url,
      passages: [{ text: `text of ${url}`, kind: "snippet" }],
    })),
    appliedNatively: [],
    warnings: [],
  };
}

/** 결과 한 건마다 URL과 그 결과의 출처 provider */
function urlsWithProviders(output: WebSearchOutput): [string, string | undefined][] {
  return output.results.map((result) => [
    result.url,
    output.sources.find((source) => source.id === result.sourceId)?.provider,
  ]);
}

/** 두 호출이 시작되어 있을 만큼 기다린다. 탐침과 호출 사이의 마이크로태스크는 모두 끝난다 */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 5));
}

describe("search fan-out", () => {
  test("two providers run at once, results interleave by value and a duplicate url is kept once", async () => {
    const a = fakeSearchProvider("plugin:web-a", {
      result: () =>
        pages("https://one.example/a1", "https://dup.example/x", "https://one.example/a2"),
    });
    const b = fakeSearchProvider("plugin:web-b", {
      result: () =>
        pages("https://two.example/b1", "https://dup.example/x", "https://two.example/b2"),
    });
    const c = fakeSearchProvider("plugin:web-c");
    const world = await makeWebWorld({
      settings: {
        search: { parallel: 2, order: ["plugin:web-a", "plugin:web-b", "plugin:web-c"] },
      },
      catalog: fakeCatalog([
        searchCandidate(a, "plugin"),
        searchCandidate(b, "plugin"),
        searchCandidate(c, "plugin"),
      ]),
    });
    const output = await world.search({ query: "xeon fan" });
    expect(a.searches.map((request) => request.terms)).toEqual(["xeon fan"]);
    expect(b.searches.map((request) => request.terms)).toEqual(["xeon fan"]);
    expect(c.searches.length).toBe(0);
    expect(c.probes()).toBe(0);
    expect(urlsWithProviders(output)).toEqual([
      ["https://one.example/a1", "plugin:web-a"],
      ["https://two.example/b1", "plugin:web-b"],
      ["https://dup.example/x", "plugin:web-a"],
      ["https://one.example/a2", "plugin:web-a"],
      ["https://two.example/b2", "plugin:web-b"],
    ]);
    expect(output.meta.provider).toBe("plugin:web-a");
    expect(output.meta.selectedBy).toBe("auto");
    expect(output.meta.fallbacks).toEqual([]);
    expect(output.meta.warnings).toContain("fanout:plugin:web-a,plugin:web-b");
  });

  test("each provider is priced and metered on its own and meta.cost is the sum", async () => {
    const cheap = fakeSearchProvider("plugin:web-cheap", {
      manifest: fakeManifest("web-cheap", {
        pricing: {
          asOf: "2026-10-20",
          sourceUrl: "https://cheap.example/pricing",
          currency: "USD",
          units: { search: 0.01 },
        },
      }),
    });
    const dear = fakeSearchProvider("plugin:web-dear", {
      manifest: fakeManifest("web-dear", {
        pricing: {
          asOf: "2026-10-20",
          sourceUrl: "https://dear.example/pricing",
          currency: "USD",
          units: { search: 0.02 },
        },
      }),
    });
    const world = await makeWebWorld({
      settings: { search: { parallel: 2, order: ["plugin:web-cheap", "plugin:web-dear"] } },
      catalog: fakeCatalog([searchCandidate(cheap, "plugin"), searchCandidate(dear, "plugin")]),
    });
    const output = await world.search({ query: "xeon cost" });
    expect(output.meta.cost.basis).toBe("estimated");
    expect(output.meta.cost.usd).toBeCloseTo(0.03);
    expect(output.meta.cost.units.find((unit) => unit.name === "search")?.count).toBe(2);
    const cheapTotals = world.deps.meter?.monthTotals("plugin:web-cheap");
    const dearTotals = world.deps.meter?.monthTotals("plugin:web-dear");
    const cheapSearch =
      cheapTotals?.ok === true ? cheapTotals.value.find((row) => row.name === "search") : undefined;
    const dearSearch =
      dearTotals?.ok === true ? dearTotals.value.find((row) => row.name === "search") : undefined;
    expect(cheapSearch?.count).toBe(1);
    expect(cheapSearch?.usd).toBeCloseTo(0.01);
    expect(dearSearch?.count).toBe(1);
    expect(dearSearch?.usd).toBeCloseTo(0.02);
  });

  test("a rate-limited provider is skipped as a call fallback and the other answers", async () => {
    const flaky = fakeSearchProvider("plugin:web-flaky");
    flaky.failWith(capabilityError("rate_limited"));
    const steady = fakeSearchProvider("plugin:web-steady");
    const world = await makeWebWorld({
      settings: { search: { parallel: 2, order: ["plugin:web-flaky", "plugin:web-steady"] } },
      catalog: fakeCatalog([searchCandidate(flaky, "plugin"), searchCandidate(steady, "plugin")]),
    });
    const output = await world.search({ query: "xeon one" });
    expect(output.meta.provider).toBe("plugin:web-steady");
    expect(output.meta.fallbacks).toEqual([
      { provider: "plugin:web-flaky", stage: "call", reason: "rate_limited" },
    ]);
    expect(output.meta.warnings.some((warning) => warning.startsWith("fanout:"))).toBe(false);
    const providers = urlsWithProviders(output).map(([, provider]) => provider);
    expect(providers.length).toBeGreaterThan(0);
    expect([...new Set(providers)]).toEqual(["plugin:web-steady"]);
  });

  test("an invalid_input from one provider fails the whole search even when another answered", async () => {
    const strict = fakeSearchProvider("plugin:web-strict");
    strict.failWith(capabilityError("invalid_input"));
    const other = fakeSearchProvider("plugin:web-other");
    const world = await makeWebWorld({
      settings: { search: { parallel: 2, order: ["plugin:web-strict", "plugin:web-other"] } },
      catalog: fakeCatalog([searchCandidate(strict, "plugin"), searchCandidate(other, "plugin")]),
    });
    const failure = await rejection(world.search({ query: "xeon two" }));
    expect(failure.data.code).toBe("invalid_input");
    expect(strict.searches.length).toBe(1);
  });

  test("when both probes fail the chain goes on to the third candidate sequentially", async () => {
    const down = fakeSearchProvider("plugin:web-down", {
      availability: { ok: false, reason: "no-key" },
    });
    const unreachable = fakeSearchProvider("plugin:web-unreachable", {
      availability: { ok: false, reason: "unreachable" },
    });
    const wrapper = fakeSearchProvider("builtin-wrapper");
    const world = await makeWebWorld({
      settings: { search: { parallel: 2, order: ["plugin:web-down", "plugin:web-unreachable"] } },
      catalog: fakeCatalog([
        searchCandidate(down, "plugin"),
        searchCandidate(unreachable, "plugin"),
        searchCandidate(wrapper, "builtin"),
      ]),
    });
    const output = await world.search({ query: "xeon three" });
    expect(output.meta.provider).toBe("builtin-wrapper");
    expect(output.meta.fallbacks).toEqual([
      { provider: "plugin:web-down", stage: "probe", reason: "no-key" },
      { provider: "plugin:web-unreachable", stage: "probe", reason: "unreachable" },
    ]);
    expect(wrapper.searches.length).toBe(1);
    expect(output.meta.warnings.some((warning) => warning.startsWith("fanout:"))).toBe(false);
  });

  test("an explicit provider is never fanned out even with parallel 2", async () => {
    const a = fakeSearchProvider("plugin:web-a");
    const b = fakeSearchProvider("plugin:web-b");
    const world = await makeWebWorld({
      settings: { search: { parallel: 2, order: ["plugin:web-a", "plugin:web-b"] } },
      catalog: fakeCatalog([searchCandidate(a, "plugin"), searchCandidate(b, "plugin")]),
    });
    const output = await world.search({ query: "xeon four", provider: "plugin:web-b" });
    expect(output.meta.selectedBy).toBe("call");
    expect(output.meta.provider).toBe("plugin:web-b");
    expect(a.searches.length).toBe(0);
    expect(b.searches.length).toBe(1);
    expect(output.meta.warnings.some((warning) => warning.startsWith("fanout:"))).toBe(false);
  });

  test("the default parallel of 1 calls only the first provider", async () => {
    const a = fakeSearchProvider("plugin:web-a");
    const b = fakeSearchProvider("plugin:web-b");
    const world = await makeWebWorld({
      settings: { search: { order: ["plugin:web-a", "plugin:web-b"] } },
      catalog: fakeCatalog([searchCandidate(a, "plugin"), searchCandidate(b, "plugin")]),
    });
    const output = await world.search({ query: "xeon five" });
    expect(output.meta.provider).toBe("plugin:web-a");
    expect(a.searches.length).toBe(1);
    expect(b.searches.length).toBe(0);
    expect(b.probes()).toBe(0);
    expect(output.meta.warnings.some((warning) => warning.startsWith("fanout:"))).toBe(false);
  });

  test("a merged result is not memoized while a single-provider result is", async () => {
    const a = fakeSearchProvider("plugin:web-a");
    const b = fakeSearchProvider("plugin:web-b");
    const world = await makeWebWorld({
      settings: { search: { parallel: 2, order: ["plugin:web-a", "plugin:web-b"] } },
      catalog: fakeCatalog([searchCandidate(a, "plugin"), searchCandidate(b, "plugin")]),
    });
    await world.search({ query: "alpha" });
    const again = await world.search({ query: "alpha" });
    expect(again.meta.cache).toBe("miss");
    expect(a.searches.length).toBe(2);
    expect(b.searches.length).toBe(2);

    world.setSettings({
      ...world.settings(),
      search: { ...world.settings().search, parallel: 1 },
    });
    await world.search({ query: "beta" });
    const hit = await world.search({ query: "beta" });
    expect(hit.meta.cache).toBe("hit");
    expect(a.searches.length).toBe(3);
    expect(b.searches.length).toBe(2);
  });

  test("the two providers are called concurrently, before either answers", async () => {
    const a = fakeSearchProvider("plugin:web-a");
    const b = fakeSearchProvider("plugin:web-b");
    const heldA = a.hold();
    const heldB = b.hold();
    const world = await makeWebWorld({
      settings: { search: { parallel: 2, order: ["plugin:web-a", "plugin:web-b"] } },
      catalog: fakeCatalog([searchCandidate(a, "plugin"), searchCandidate(b, "plugin")]),
    });
    const pending = world.search({ query: "alpha" });
    await settle();
    expect(a.searches.length).toBe(1);
    expect(b.searches.length).toBe(1);
    heldA.release();
    heldB.release();
    const output: WebSearchOutput = await pending;
    expect(output.meta.warnings).toContain("fanout:plugin:web-a,plugin:web-b");
  });
});
