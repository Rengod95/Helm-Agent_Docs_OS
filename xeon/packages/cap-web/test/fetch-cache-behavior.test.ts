import { afterEach, describe, expect, test } from "bun:test";
import { CapabilityError, type CacheUsage } from "@xeon/contracts/capabilities";
import { DEFAULT_WEB_SETTINGS } from "../src/settings.ts";
import {
  fakeCatalog,
  fakeFetchProvider,
  fakeManifest,
  fetchCandidate,
} from "../src/testing/fake-providers.ts";
import { threadIdOf } from "./support/ids.ts";
import { each, times } from "./support/seq.ts";
import { releaseStores } from "./support/store.ts";
import { makeWebWorld, PUBLIC_IP } from "./support/web-world.ts";

afterEach(releaseStores);

const TEXT = { "content-type": "text/plain" };
const MINUTE = 60_000;

async function rejection(promise: Promise<unknown>): Promise<CapabilityError> {
  const caught = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(caught instanceof CapabilityError)) throw new Error("expected a CapabilityError");
  return caught;
}

describe("fetch cache behaviour", () => {
  test("the second call is served from the disk cache without a request", async () => {
    const world = await makeWebWorld({
      routes: { "https://example.com/a": { headers: TEXT, body: "cached body" } },
    });
    const first = await world.fetch({ url: "https://example.com/a" });
    expect(first.meta.cache).toBe("miss");
    const second = await world.fetch({ url: "https://example.com/a?utm_source=mail#x" });
    expect(second.meta.cache).toBe("hit");
    expect(second.pages[0]?.content).toBe("cached body");
    expect(second.pages[0]?.source.id).toBe("s1");
    expect(second.pages[0]?.source.rawRef).toBe(first.pages[0]?.source.rawRef);
    expect(second.pages[0]?.source.url).toBe("https://example.com/a?utm_source=mail#x");
    expect(world.transport.requests.length).toBe(1);
    expect(second.meta.cost.basis).toBe("free");
  });

  test("policy runs before the cache", async () => {
    const world = await makeWebWorld({
      routes: { "https://example.com/a": { headers: TEXT, body: "cached body" } },
    });
    await world.fetch({ url: "https://example.com/a" });
    // 캐시에 있어도 지금 정책이 막으면 돌려주지 않는다
    const before = world.transport.requests.length;
    world.setSettings({
      ...world.settings(),
      policy: { ...world.settings().policy, deny: ["example.com"] },
    });
    const failure = await rejection(world.fetch({ url: "https://example.com/a" }));
    expect(failure.data.code).toBe("denied");
    expect(world.transport.requests.length).toBe(before);
    // 정책을 풀면 캐시가 다시 쓰인다
    world.setSettings({ ...world.settings(), policy: { ...world.settings().policy, deny: [] } });
    expect((await world.fetch({ url: "https://example.com/a" })).meta.cache).toBe("hit");
  });

  test("cached entries expire after the ttl", async () => {
    const world = await makeWebWorld({
      routes: { "https://example.com/a": { headers: TEXT, body: "cached body" } },
    });
    await world.fetch({ url: "https://example.com/a" });
    world.clock.advance(14 * MINUTE);
    expect((await world.fetch({ url: "https://example.com/a" })).meta.cache).toBe("hit");
    world.clock.advance(2 * MINUTE);
    const again = await world.fetch({ url: "https://example.com/a" });
    expect(again.meta.cache).toBe("miss");
    expect(world.transport.requests.length).toBe(2);
  });

  test("freshness live bypasses the cache and prefer-fresh revalidates a half-expired entry", async () => {
    const world = await makeWebWorld({
      routes: { "https://example.com/a": { headers: TEXT, body: "cached body" } },
    });
    await world.fetch({ url: "https://example.com/a" });
    const live = await world.fetch({ url: "https://example.com/a", freshness: "live" });
    expect(live.meta.cache).toBe("bypass");
    expect(world.transport.requests.length).toBe(2);
    // live 결과도 rawRef 이어 읽기를 위해 원문은 저장하지만 캐시 행으로 쓰이지는 않는다
    expect(live.pages[0]?.source.rawRef).toBeDefined();

    const fresh = await makeWebWorld({
      routes: { "https://example.com/a": { headers: TEXT, body: "cached body" } },
    });
    await fresh.fetch({ url: "https://example.com/a" });
    fresh.clock.advance(5 * MINUTE);
    expect(
      (await fresh.fetch({ url: "https://example.com/a", freshness: "prefer-fresh" })).meta.cache,
    ).toBe("hit");
    fresh.clock.advance(4 * MINUTE);
    const revalidated = await fresh.fetch({
      url: "https://example.com/a",
      freshness: "prefer-fresh",
    });
    expect(revalidated.meta.cache).toBe("stale-revalidated");
    expect(fresh.transport.requests.length).toBe(2);
  });

  test("cache policy storage matrix", async () => {
    const policies: readonly CacheUsage[] = ["none", "session", "persist"];
    await each(policies, async (policy) => {
      const provider = fakeFetchProvider(`plugin:web-${policy}`, {
        manifest: fakeManifest(`web-${policy}`, {
          termsFlags: {
            cachePolicy: policy,
            mayTrainOn: "unknown",
            redistribution: "unknown",
            reviewedAt: "2026-10-01",
          },
        }),
      });
      const world = await makeWebWorld({
        catalog: fakeCatalog([], [fetchCandidate(provider, "plugin", policy)]),
      });
      const output = await world.fetch(
        { url: "https://example.com/p", provider: provider.id },
        world.asModel(threadIdOf(1)),
      );
      const counts = (await world.store?.rowCounts()) ?? {};
      const source = output.pages[0]?.source;
      expect([policy, source?.usage.cache]).toEqual([policy, policy]);
      expect([policy, counts["cap_web_raw"]]).toEqual([policy, policy === "none" ? 0 : 1]);
      expect([policy, counts["cap_web_fetch_cache"]]).toEqual([
        policy,
        policy === "persist" ? 1 : 0,
      ]);
      expect([policy, source?.rawRef === undefined]).toEqual([policy, policy === "none"]);
    });
  });

  test("brave none never on disk", async () => {
    const provider = fakeFetchProvider("plugin:web-brave", {
      manifest: fakeManifest("web-brave", {
        termsFlags: {
          cachePolicy: "none",
          mayTrainOn: false,
          redistribution: "no",
          reviewedAt: "2026-10-01",
        },
      }),
    });
    const world = await makeWebWorld({
      catalog: fakeCatalog([], [fetchCandidate(provider, "plugin", "none")]),
    });
    const call = { url: "https://example.com/p", provider: "plugin:web-brave" } as const;
    await world.fetch(call);
    await world.fetch(call);
    expect(provider.fetches.length).toBe(2);
    const counts = (await world.store?.rowCounts()) ?? {};
    expect(counts["cap_web_fetch_cache"]).toBe(0);
    expect(counts["cap_web_raw"]).toBe(0);
  });

  test("a result from a promoted persist plugin is found by the next call", async () => {
    const provider = fakeFetchProvider("plugin:web-fake", {
      manifest: fakeManifest("web-fake", {
        termsFlags: {
          cachePolicy: "persist",
          mayTrainOn: false,
          redistribution: "yes",
          reviewedAt: "2026-10-01",
        },
      }),
    });
    const world = await makeWebWorld({
      routes: {
        "https://example.com/app": {
          headers: { "content-type": "text/html" },
          body: "<html><body><div id='root'></div></body></html>",
        },
      },
      catalog: fakeCatalog([], [fetchCandidate(provider, "plugin", "persist")]),
    });
    await world.fetch({ url: "https://example.com/app" });
    const again = await world.fetch({ url: "https://example.com/app" });
    expect(again.meta.cache).toBe("hit");
    expect(again.pages[0]?.source.provider).toBe("plugin:web-fake");
    expect(provider.fetches.length).toBe(1);
    expect(world.transport.requests.length).toBe(1);
  });

  test("session call limits", async () => {
    const world = await makeWebWorld({
      routes: { "https://example.com/a": { headers: TEXT, body: "x" } },
      settings: { limits: { fetchPerSession: 300 } },
    });
    const options = world.asModel(threadIdOf(1));
    // 캐시 적중도 센다. 폭주 방지가 목적이다
    await times(300, () => world.fetch({ url: "https://example.com/a" }, options));
    const refused = await rejection(world.fetch({ url: "https://example.com/a" }, options));
    expect(refused.data.code).toBe("session_limit");
    // 다른 세션과 세션 없는 호출은 영향이 없다
    await world.fetch({ url: "https://example.com/a" }, world.asModel(threadIdOf(2)));
    await world.fetch({ url: "https://example.com/a" });
  });

  test("urls count once per url", async () => {
    const world = await makeWebWorld({
      routes: { "https://example.com/a": { headers: TEXT, body: "x" } },
      settings: { limits: { fetchPerSession: 4 } },
    });
    const options = world.asModel(threadIdOf(1));
    const urls = ["https://example.com/a", "https://example.com/a", "https://example.com/a"];
    await world.fetch({ urls }, options);
    expect((await rejection(world.fetch({ urls }, options))).data.code).toBe("session_limit");
    await world.fetch({ url: "https://example.com/a" }, options);
  });

  test("usage is metered per provider and the allowance warns", async () => {
    const provider = fakeFetchProvider("plugin:web-metered", {
      manifest: fakeManifest("web-metered", {
        pricing: {
          asOf: "2026-10-20",
          sourceUrl: "https://metered.example/pricing",
          currency: "USD",
          units: { page_content: 1 },
          freeAllowance: { period: "month", usd: 10 },
        },
      }),
    });
    const world = await makeWebWorld({
      catalog: fakeCatalog([], [fetchCandidate(provider, "plugin", "session")]),
    });
    const call = {
      url: "https://example.com/p",
      provider: "plugin:web-metered",
      freshness: "live",
    } as const;
    await times(7, () => world.fetch(call));
    const eighth = await world.fetch(call);
    expect(eighth.meta.warnings).toContain("free_allowance_80:plugin:web-metered");
    const totals = world.deps.meter?.monthTotals("plugin:web-metered");
    expect(totals?.ok && totals.value.find((row) => row.name === "page_content")?.count).toBe(8);
  });

  test("robots.txt is ignored by default, applies to model batches on auto and to every call when always", async () => {
    const routes = {
      "https://example.com/robots.txt": {
        headers: TEXT,
        body: "User-agent: *\nDisallow: /private",
      },
      "https://example.com/private/a": { headers: TEXT, body: "secret" },
      "https://example.com/public/a": { headers: TEXT, body: "open" },
    };
    const world = await makeWebWorld({ routes, settings: { policy: { robots: "auto" } } });
    const options = world.asModel(threadIdOf(1));
    // 사용자 대행 단건 fetch는 robots.txt 검사 대상이 아니다
    const single = await world.fetch({ url: "https://example.com/private/a" }, options);
    expect(single.pages[0]?.content).toBe("secret");
    const batch = await world.fetch(
      { urls: ["https://example.com/private/a", "https://example.com/public/a"] },
      world.asModel(threadIdOf(1), "tool-2"),
    );
    expect(batch.pages[0]?.error?.code).toBe("robots_disallowed");
    expect(batch.pages[1]?.content).toBe("open");

    // 기본(D-M3-23 행 4)은 따르지 않는다
    const byDefault = await makeWebWorld({ routes });
    const defaultBatch = await byDefault.fetch(
      { urls: ["https://example.com/private/a"] },
      byDefault.asModel(threadIdOf(1)),
    );
    expect(defaultBatch.pages[0]?.content).toBe("secret");
    expect(DEFAULT_WEB_SETTINGS.policy.robots).toBe("never");

    const always = await makeWebWorld({ routes, settings: { policy: { robots: "always" } } });
    expect(
      (await rejection(always.fetch({ url: "https://example.com/private/a" }))).data.code,
    ).toBe("robots_disallowed");
    const never = await makeWebWorld({ routes, settings: { policy: { robots: "never" } } });
    const neverBatch = await never.fetch(
      { urls: ["https://example.com/private/a"] },
      never.asModel(threadIdOf(1)),
    );
    expect(neverBatch.pages[0]?.content).toBe("secret");
  });

  test("robots.txt is fetched once per origin and an unreachable one disallows", async () => {
    const world = await makeWebWorld({
      routes: {
        "https://example.com/robots.txt": { headers: TEXT, body: "User-agent: *\nDisallow:" },
        "https://example.com/1": { headers: TEXT, body: "1" },
        "https://example.com/2": { headers: TEXT, body: "2" },
      },
      settings: { policy: { robots: "always" } },
    });
    await world.fetch({ url: "https://example.com/1" });
    await world.fetch({ url: "https://example.com/2" });
    expect(
      world.transport.requests.filter((request) => request.url.endsWith("/robots.txt")).length,
    ).toBe(1);

    const broken = await makeWebWorld({
      hosts: { "down.example": [PUBLIC_IP] },
      routes: { "https://down.example/1": { headers: TEXT, body: "1" } },
      settings: { policy: { robots: "always" } },
    });
    expect((await rejection(broken.fetch({ url: "https://down.example/1" }))).data.code).toBe(
      "robots_disallowed",
    );
  });

  test("results feed the seen urls so later model calls need no confirmation", async () => {
    const world = await makeWebWorld({
      hosts: { "other.example": [PUBLIC_IP] },
      routes: {
        "https://example.com/a": {
          headers: { "content-type": "text/html" },
          body: "<html><body><article><h1>T</h1><p>A page with a link to <a href='https://other.example/next'>the next page</a> and enough words to count as the article body of this fixture page for the extractor to keep.</p></article></body></html>",
        },
      },
      settings: { policy: { unseenUrl: "deny" } },
    });
    const thread = threadIdOf(1);
    world.deps.seen.note(thread, ["https://example.com/a"]);
    await world.fetch({ url: "https://example.com/a" }, world.asModel(thread));
    const unseenBefore = await world.deps.seen.has(thread, "https://other.example/next");
    expect(unseenBefore.ok && unseenBefore.value).toBe(true);
  });

  test("without a store the call still works and there is no rawRef", async () => {
    const world = await makeWebWorld({
      withStore: false,
      routes: { "https://example.com/a": { headers: TEXT, body: "no store" } },
    });
    const output = await world.fetch({ url: "https://example.com/a" });
    expect(output.pages[0]?.content).toBe("no store");
    expect(output.pages[0]?.source.rawRef).toBeUndefined();
    expect(output.meta.warnings).toContain("cache_unavailable");
    const refused = await rejection(world.fetch({ rawRef: `webraw:${"a".repeat(64)}` }));
    expect(refused.data.code).toBe("unavailable");
  });

  test("an explicit provider that is unknown or unavailable does not fall back", async () => {
    const down = fakeFetchProvider("plugin:web-down", {
      availability: { ok: false, reason: "no-key" },
    });
    const world = await makeWebWorld({
      routes: { "https://example.com/a": { headers: TEXT, body: "local" } },
      catalog: fakeCatalog([], [fetchCandidate(down)]),
    });
    const unknown = await rejection(
      world.fetch({ url: "https://example.com/a", provider: "plugin:web-none" }),
    );
    expect(unknown.data.code).toBe("unavailable");
    const unavailable = await rejection(
      world.fetch({ url: "https://example.com/a", provider: "plugin:web-down" }),
    );
    expect(unavailable.data.code).toBe("unavailable");
    expect(world.transport.requests.length).toBe(0);
    const local = await world.fetch({ url: "https://example.com/a", provider: "local" });
    expect(local.meta.selectedBy).toBe("call");
    expect(local.pages[0]?.content).toBe("local");
  });
});
