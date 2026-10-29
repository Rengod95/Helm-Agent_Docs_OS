import { afterEach, describe, expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import type { CallOptions, WebProviderManifest } from "@xeon/contracts/capabilities";
import {
  WebProviderStatusSchema,
  WebSettingsWireSchema,
  type WebProviderStatus,
} from "@xeon/contracts/wire";
import { describeWebProviders, describeWebSettings } from "../src/status.ts";
import { DEFAULT_WEB_SETTINGS } from "../src/settings.ts";
import { browseCandidate, fakeBrowseProvider } from "../src/testing/fake-browser.ts";
import {
  fakeCatalog,
  fakeFetchProvider,
  fakeManifest,
  fakeSearchProvider,
  fetchCandidate,
  searchCandidate,
} from "../src/testing/fake-providers.ts";
import { threadIdOf } from "./support/ids.ts";
import { releaseStores } from "./support/store.ts";
import { makeWebWorld } from "./support/web-world.ts";

// `web.providers`의 행과 설정 값(L2.web.spec §6.1, F.wire-settings). 행은 wire 스키마를 통과하고 그 밖의 필드가 없다.

afterEach(releaseStores);

const SIGNAL = new AbortController().signal;
const HOST: CallOptions = {
  requestId: "req-host",
  context: { threadId: threadIdOf(1), caller: { kind: "host" } },
};
const ROW_KEYS = [
  "auth",
  "capability",
  "displayName",
  "firstUseNoticed",
  "id",
  "origin",
  "pricingAsOf",
  "pricingStale",
  "status",
];

function keyed(name: string, services: WebProviderManifest["services"]): WebProviderManifest {
  return fakeManifest(name, {
    services,
    auth: { kind: "header", secrets: [{ setting: `ext.${name}.apiKey`, header: "x-api-key" }] },
  });
}

describe("web.providers rows", () => {
  test("rows for the builtin, keyed, keyless, stale, free, fetch and browse candidates", async () => {
    const wrapper = fakeSearchProvider("builtin-wrapper");
    const key = fakeSearchProvider("plugin:web-key", {
      manifest: fakeManifest("web-key", {
        services: ["search"],
        auth: { kind: "header", secrets: [{ setting: "ext.web-key.apiKey", header: "x-api-key" }] },
        pricing: {
          asOf: "2025-01-01",
          sourceUrl: "https://web-key.example/pricing",
          currency: "USD",
          units: { search: 0.005 },
        },
      }),
    });
    const nokey = fakeSearchProvider("plugin:web-nokey", {
      manifest: fakeManifest("web-nokey", {
        services: ["search"],
        auth: {
          kind: "header",
          secrets: [{ setting: "ext.web-nokey.apiKey", header: "x-api-key" }],
        },
      }),
      availability: { ok: false, reason: "no-key", detail: "ext.web-nokey.apiKey" },
    });
    const free = fakeSearchProvider("plugin:web-free", {
      manifest: fakeManifest("web-free", {
        services: ["search"],
        pricing: {
          asOf: "2026-10-01",
          sourceUrl: "https://web-free.example/pricing",
          currency: "USD",
          units: { search: 0, page_content: 0 },
        },
      }),
    });
    const fetching = fakeFetchProvider("plugin:web-fetch", {
      manifest: fakeManifest("web-fetch", {
        services: ["fetch"],
        auth: { kind: "query", secrets: [{ setting: "ext.web-fetch.apiKey", query: "key" }] },
      }),
    });
    const browsing = fakeBrowseProvider("plugin:web-browse", {
      manifest: fakeManifest("web-browse", {
        services: ["browse"],
        auth: { kind: "bearer", secrets: [{ setting: "ext.web-browse.apiKey" }] },
      }),
    });
    const world = await makeWebWorld({
      catalog: fakeCatalog(
        [
          searchCandidate(wrapper, "builtin"),
          searchCandidate(key, "plugin"),
          searchCandidate(nokey, "plugin"),
          searchCandidate(free, "plugin"),
        ],
        [fetchCandidate(fetching, "plugin")],
        [browseCandidate(browsing, "plugin")],
      ),
    });

    const before = await describeWebProviders(world.deps, SIGNAL);
    expect(before).toEqual([
      {
        id: "builtin-wrapper",
        capability: "web.search",
        origin: "builtin",
        displayName: "builtin-wrapper",
        auth: "none",
        status: { kind: "ok" },
        pricingAsOf: "2026-10-20",
        pricingStale: false,
        firstUseNoticed: true,
      },
      {
        id: "plugin:web-key",
        capability: "web.search",
        origin: "plugin",
        displayName: "web-key",
        auth: "header",
        status: { kind: "ok" },
        pricingAsOf: "2025-01-01",
        pricingStale: true,
        firstUseNoticed: false,
      },
      {
        id: "plugin:web-nokey",
        capability: "web.search",
        origin: "plugin",
        displayName: "web-nokey",
        auth: "header",
        status: { kind: "unavailable", reason: "no-key", detail: "ext.web-nokey.apiKey" },
        pricingAsOf: "2026-10-20",
        pricingStale: false,
        firstUseNoticed: false,
      },
      {
        id: "plugin:web-free",
        capability: "web.search",
        origin: "plugin",
        displayName: "web-free",
        auth: "none",
        status: { kind: "ok" },
        pricingAsOf: null,
        pricingStale: false,
        firstUseNoticed: true,
      },
      {
        id: "plugin:web-fetch",
        capability: "web.fetch",
        origin: "plugin",
        displayName: "web-fetch",
        auth: "query",
        status: { kind: "ok" },
        pricingAsOf: "2026-10-20",
        pricingStale: false,
        firstUseNoticed: false,
      },
      {
        id: "plugin:web-browse",
        capability: "web.browse",
        origin: "plugin",
        displayName: "web-browse",
        auth: "bearer",
        status: { kind: "ok" },
        pricingAsOf: "2026-10-20",
        pricingStale: false,
        firstUseNoticed: false,
      },
    ]);

    // 키 플러그인을 한 번 쓰면 고지가 기록되어 firstUseNoticed가 참이 된다. 브라우저도 같다
    const searched = await world.search({ query: "status", provider: "plugin:web-key" });
    expect(searched.meta.provider).toBe("plugin:web-key");
    const opened = await world.browse.open({ provider: "plugin:web-browse" }, HOST);
    expect(opened.meta.provider).toBe("plugin:web-browse");
    const after = await describeWebProviders(world.deps, SIGNAL);
    expect(after.map((row) => [row.id, row.firstUseNoticed])).toEqual([
      ["builtin-wrapper", true],
      ["plugin:web-key", true],
      ["plugin:web-nokey", false],
      ["plugin:web-free", true],
      ["plugin:web-fetch", false],
      ["plugin:web-browse", true],
    ]);
  });

  test("every row parses with the wire schema and carries no field outside it", async () => {
    const key = fakeSearchProvider("plugin:web-key", {
      manifest: keyed("web-key", ["search"]),
      availability: { ok: false, reason: "no-key", detail: "ext.web-key.apiKey" },
    });
    const world = await makeWebWorld({
      secretValues: ["sk-test-SECRET-VALUE-123"],
      catalog: fakeCatalog([searchCandidate(key, "plugin")]),
    });
    const rows = await describeWebProviders(world.deps, SIGNAL);
    expect(rows.length).toBe(1);
    for (const row of rows) {
      expect(Object.keys(row).toSorted()).toEqual(ROW_KEYS);
      const parsed = parse(WebProviderStatusSchema, row);
      expect(parsed.ok).toBe(true);
    }
    expect(JSON.stringify(rows)).not.toContain("sk-test-SECRET-VALUE-123");
  });

  test("the runtime exposes the same rows through providerStatus", async () => {
    const wrapper = fakeSearchProvider("builtin-wrapper");
    const world = await makeWebWorld({
      builtin: { search: [searchCandidate(wrapper, "builtin")], fetch: [] },
    });
    const rows: readonly WebProviderStatus[] = await world.runtime.providerStatus(SIGNAL);
    expect(rows).toEqual([
      {
        id: "builtin-wrapper",
        capability: "web.search",
        origin: "builtin",
        displayName: "builtin-wrapper",
        auth: "none",
        status: { kind: "ok" },
        pricingAsOf: "2026-10-20",
        pricingStale: false,
        firstUseNoticed: true,
      },
    ]);
  });
});

describe("web settings view", () => {
  test("the effective values map to the wire shape", () => {
    expect(describeWebSettings(DEFAULT_WEB_SETTINGS)).toEqual({
      searchProvider: "auto",
      searchOrder: [],
      searchParallel: 1,
      browseProvider: "auto",
      browseOrder: [],
      robots: "never",
    });
    const custom = describeWebSettings({
      ...DEFAULT_WEB_SETTINGS,
      search: {
        ...DEFAULT_WEB_SETTINGS.search,
        provider: "plugin:web-key",
        order: ["plugin:web-key", "builtin-wrapper"],
        parallel: 2,
      },
      browse: {
        ...DEFAULT_WEB_SETTINGS.browse,
        provider: "auto",
        order: ["plugin:web-browse"],
      },
      policy: { ...DEFAULT_WEB_SETTINGS.policy, robots: "always" },
    });
    expect(custom).toEqual({
      searchProvider: "plugin:web-key",
      searchOrder: ["plugin:web-key", "builtin-wrapper"],
      searchParallel: 2,
      browseProvider: "auto",
      browseOrder: ["plugin:web-browse"],
      robots: "always",
    });
    expect(parse(WebSettingsWireSchema, custom).ok).toBe(true);
  });

  test("a long order list is cut to the wire limit of 64 entries", () => {
    const ids = Array.from({ length: 70 }, (_, index) => `plugin:web-${index}`);
    const view = describeWebSettings({
      ...DEFAULT_WEB_SETTINGS,
      search: { ...DEFAULT_WEB_SETTINGS.search, order: ids },
    });
    expect(view.searchOrder.length).toBe(64);
    expect(parse(WebSettingsWireSchema, view).ok).toBe(true);
  });
});
