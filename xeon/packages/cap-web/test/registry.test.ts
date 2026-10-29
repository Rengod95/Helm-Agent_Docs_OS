import { describe, expect, test } from "bun:test";
import type { WebProviderManifest } from "@xeon/contracts/capabilities";
import { effectiveCachePolicy } from "../src/cache/policy.ts";
import { createProviderRegistry, type PluginRegistration } from "../src/search/registry.ts";
import { fakeResolver } from "../src/testing/fake-resolver.ts";
import { fixtureTransport } from "../src/testing/http-fixtures.ts";
import { fakeBrowseProvider } from "../src/testing/fake-browser.ts";
import {
  fakeFetchProvider,
  fakeManifest,
  fakeSearchProvider,
} from "../src/testing/fake-providers.ts";
import { manualClock } from "./support/clock.ts";
import { makeWebWorld } from "./support/web-world.ts";

function registry(list: () => readonly PluginRegistration[], logs: string[] = []) {
  return createProviderRegistry({
    source: { list },
    builtin: { search: [], fetch: [] },
    http: {
      resolver: fakeResolver(),
      transport: fixtureTransport(),
      secrets: undefined,
      guard: undefined,
    },
    clock: manualClock(),
    logger: {
      debug: () => {},
      info: () => {},
      warn: (event) => {
        logs.push(event);
      },
      error: () => {},
      child() {
        return this;
      },
    },
    extensionSetting: (extension, key) => `${extension}/${key}`,
  });
}

function searchRegistration(extension: string, manifest?: WebProviderManifest): PluginRegistration {
  return {
    extension,
    registration: {
      capability: "web.search",
      create: () =>
        fakeSearchProvider(`plugin:${extension}`, manifest === undefined ? {} : { manifest }),
    },
  };
}

function browseRegistration(extension: string, manifest?: WebProviderManifest): PluginRegistration {
  return {
    extension,
    registration: {
      capability: "web.browse",
      create: () =>
        fakeBrowseProvider(`plugin:${extension}`, manifest === undefined ? {} : { manifest }),
    },
  };
}

/** 매니페스트 하나를 등록해 거부 로그(`web.provider_rejected`의 이벤트와 필드)를 돌려준다. 후보는 비어 있어야 한다 */
function rejectionsOf(manifest: WebProviderManifest): unknown[] {
  const logged: unknown[] = [];
  const catalog = createProviderRegistry({
    source: { list: () => [searchRegistration(manifest.name, manifest)] },
    builtin: { search: [], fetch: [] },
    http: {
      resolver: fakeResolver(),
      transport: fixtureTransport(),
      secrets: undefined,
      guard: undefined,
    },
    clock: manualClock(),
    logger: {
      debug: () => {},
      info: () => {},
      warn: (event, fields) => {
        logged.push([event, fields]);
      },
      error: () => {},
      child() {
        return this;
      },
    },
    extensionSetting: () => undefined,
  });
  expect(catalog.searchCandidates()).toEqual([]);
  return logged;
}

describe("provider registry", () => {
  test("plugin browse registrations become browse candidates with the plugin origin", () => {
    const catalog = registry(() => [browseRegistration("web-a")]);
    expect(
      catalog.browseCandidates().map((candidate) => [candidate.provider.id, candidate.origin]),
    ).toEqual([["plugin:web-a", "plugin"]]);
    expect(catalog.searchCandidates()).toEqual([]);
    expect(catalog.fetchCandidates()).toEqual([]);
  });

  test("a browse provider whose manifest does not declare browse is rejected with its reason", () => {
    const logged: unknown[] = [];
    const catalog = createProviderRegistry({
      source: {
        list: () => [browseRegistration("web-b", fakeManifest("web-b", { services: ["search"] }))],
      },
      builtin: { search: [], fetch: [] },
      http: {
        resolver: fakeResolver(),
        transport: fixtureTransport(),
        secrets: undefined,
        guard: undefined,
      },
      clock: manualClock(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: (event, fields) => {
          logged.push([event, fields]);
        },
        error: () => {},
        child() {
          return this;
        },
      },
      extensionSetting: () => undefined,
    });
    expect(catalog.browseCandidates()).toEqual([]);
    expect(logged).toEqual([
      [
        "web.provider_rejected",
        { extension: "web-b", capability: "web.browse", reason: "service_not_declared" },
      ],
    ]);
  });

  test("a query-kind auth manifest is rejected at registration with auth_kind_unsupported", () => {
    const manifest = fakeManifest("web-q", {
      auth: { kind: "query", secrets: [{ setting: "ext.web-q.apiKey", query: "key" }] },
    });
    expect(rejectionsOf(manifest)).toEqual([
      [
        "web.provider_rejected",
        { extension: "web-q", capability: "web.search", reason: "auth_kind_unsupported" },
      ],
    ]);
  });

  test("a header secret without a header name is rejected at registration", () => {
    const manifest = fakeManifest("web-h", {
      auth: { kind: "header", secrets: [{ setting: "ext.web-h.apiKey" }] },
    });
    expect(rejectionsOf(manifest)).toEqual([
      [
        "web.provider_rejected",
        { extension: "web-h", capability: "web.search", reason: "secret_header_missing" },
      ],
    ]);
  });

  test("plugin registrations become candidates with the plugin origin", () => {
    const catalog = registry(() => [searchRegistration("web-a")]);
    const candidates = catalog.searchCandidates();
    expect(candidates.map((candidate) => [candidate.provider.id, candidate.origin])).toEqual([
      ["plugin:web-a", "plugin"],
    ]);
    expect(catalog.fetchCandidates()).toEqual([]);
  });

  test("a provider is created once per registration and dropped when the registration goes", () => {
    let creations = 0;
    let present = true;
    const registration: PluginRegistration = {
      extension: "web-a",
      registration: {
        capability: "web.search",
        create: () => {
          creations += 1;
          return fakeSearchProvider("plugin:web-a");
        },
      },
    };
    const catalog = registry(() => (present ? [registration] : []));
    catalog.searchCandidates();
    catalog.searchCandidates();
    expect(creations).toBe(1);
    present = false;
    expect(catalog.searchCandidates()).toEqual([]);
    present = true;
    catalog.searchCandidates();
    expect(creations).toBe(2);
  });

  test("a builtin candidate whose enabled() is false is not offered until it turns true", () => {
    let configured = false;
    const catalog = createProviderRegistry({
      source: { list: () => [] },
      builtin: {
        search: [
          {
            provider: fakeSearchProvider("searxng"),
            origin: "detected",
            cachePolicy: "persist",
            enabled: () => configured,
          },
          {
            provider: fakeSearchProvider("builtin-wrapper"),
            origin: "builtin",
            cachePolicy: "session",
          },
        ],
        fetch: [],
      },
      http: {
        resolver: fakeResolver(),
        transport: fixtureTransport(),
        secrets: undefined,
        guard: undefined,
      },
      clock: manualClock(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        child() {
          return this;
        },
      },
      extensionSetting: () => undefined,
    });
    const ids = () => catalog.searchCandidates().map((candidate) => candidate.provider.id);
    expect(ids()).toEqual(["builtin-wrapper"]);
    configured = true;
    expect(ids()).toEqual(["searxng", "builtin-wrapper"]);
  });

  test("the builtin candidates come first", () => {
    const builtin = fakeSearchProvider("searxng");
    const catalog = createProviderRegistry({
      source: { list: () => [searchRegistration("web-a")] },
      builtin: {
        search: [{ provider: builtin, origin: "detected", cachePolicy: "persist" }],
        fetch: [],
      },
      http: {
        resolver: fakeResolver(),
        transport: fixtureTransport(),
        secrets: undefined,
        guard: undefined,
      },
      clock: manualClock(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        child() {
          return this;
        },
      },
      extensionSetting: () => undefined,
    });
    expect(catalog.searchCandidates().map((candidate) => candidate.provider.id)).toEqual([
      "searxng",
      "plugin:web-a",
    ]);
  });

  test("invalid registrations are rejected and logged", () => {
    const logs: string[] = [];
    const wrongId: PluginRegistration = {
      extension: "web-a",
      registration: { capability: "web.search", create: () => fakeSearchProvider("plugin:other") },
    };
    const wrongService: PluginRegistration = {
      extension: "web-b",
      registration: {
        capability: "web.search",
        create: () =>
          fakeSearchProvider("plugin:web-b", {
            manifest: fakeManifest("web-b", { services: ["fetch"] }),
          }),
      },
    };
    const badManifest: PluginRegistration = {
      extension: "web-c",
      registration: {
        capability: "web.search",
        create: () =>
          fakeSearchProvider("plugin:web-c", {
            manifest: fakeManifest("web-c", { endpoints: ["not a host!"] }),
          }),
      },
    };
    const throwing: PluginRegistration = {
      extension: "web-d",
      registration: {
        capability: "web.search",
        create: () => {
          throw new Error("boom");
        },
      },
    };
    const browse: PluginRegistration = {
      extension: "web-e",
      registration: {
        capability: "web.browse",
        create: () => {
          throw new Error("not called");
        },
      },
    };
    const catalog = registry(() => [wrongId, wrongService, badManifest, throwing, browse], logs);
    expect(catalog.searchCandidates()).toEqual([]);
    // wrongId, wrongService, badManifest, throwing, browse
    expect(logs.filter((event) => event === "web.provider_rejected").length).toBe(5);
  });

  test("unreviewed persist downgraded", () => {
    const persistUnreviewed = fakeManifest("web-a", {
      termsFlags: { cachePolicy: "persist", mayTrainOn: "unknown", redistribution: "unknown" },
    });
    expect(effectiveCachePolicy(persistUnreviewed)).toEqual({
      policy: "session",
      downgraded: true,
    });
    const reviewed = fakeManifest("web-a", {
      termsFlags: {
        cachePolicy: "persist",
        mayTrainOn: false,
        redistribution: "yes",
        reviewedAt: "2026-10-01",
      },
    });
    expect(effectiveCachePolicy(reviewed)).toEqual({ policy: "persist", downgraded: false });
    const none = fakeManifest("web-b", {
      termsFlags: { cachePolicy: "none", mayTrainOn: false, redistribution: "no" },
    });
    expect(effectiveCachePolicy(none)).toEqual({ policy: "none", downgraded: false });

    const logs: string[] = [];
    const catalog = registry(() => [searchRegistration("web-a", persistUnreviewed)], logs);
    const candidate = catalog.searchCandidates()[0];
    expect(candidate?.cachePolicy).toBe("session");
    expect(logs).toContain("web.cache_policy_downgraded");
  });

  test("a fetch registration becomes a fetch candidate", () => {
    const catalog = registry(() => [
      {
        extension: "web-f",
        registration: { capability: "web.fetch", create: () => fakeFetchProvider("plugin:web-f") },
      },
    ]);
    expect(catalog.fetchCandidates().map((candidate) => candidate.provider.id)).toEqual([
      "plugin:web-f",
    ]);
    expect(catalog.searchCandidates()).toEqual([]);
  });

  test("the registry works end to end through the runtime", async () => {
    const world = await makeWebWorld({
      registrations: { list: () => [searchRegistration("web-a")] },
    });
    const output = await world.search({ query: "xeon" });
    expect(output.meta.provider).toBe("plugin:web-a");
    expect(output.sources[0]?.usage.cache).toBe("session");
  });
});
