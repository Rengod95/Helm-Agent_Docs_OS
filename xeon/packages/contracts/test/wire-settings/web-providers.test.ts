import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  WIRE_METHODS,
  WebProviderStatusSchema,
  WebProvidersResultSchema,
} from "../../src/wire-settings/wire/index.ts";

// M3-REQ-96. 값을 왕복해 견주고, 거부 값을 확인한다. 결과에는 키나 토큰 같은 비밀 값 필드가 없다.
function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
function parsed(schema: Parameters<typeof parse>[0], value: unknown): unknown {
  const outcome = parse(schema, roundTrip(value));
  return outcome.ok ? outcome.value : undefined;
}

const exa = {
  id: "exa",
  capability: "web.search",
  origin: "builtin",
  displayName: "Exa",
  auth: "header",
  status: { kind: "unavailable", reason: "no-key", detail: "등록된 키가 없습니다" },
  pricingAsOf: "2026-10-01",
  pricingStale: false,
  firstUseNoticed: false,
  autoRank: 1,
};
const brave = {
  id: "plugin:brave-search",
  capability: "web.search",
  origin: "plugin",
  displayName: "Brave Search",
  auth: "header",
  status: { kind: "ok" },
  pricingAsOf: null,
  pricingStale: false,
  firstUseNoticed: true,
  autoRank: 0,
};
const stagehand = {
  id: "stagehand",
  capability: "web.browse",
  origin: "builtin",
  displayName: "Stagehand",
  auth: "none",
  status: { kind: "ok" },
  pricingAsOf: null,
  pricingStale: false,
  firstUseNoticed: true,
  autoRank: 0,
};
const fetching = {
  id: "plugin:web-fetch",
  capability: "web.fetch",
  origin: "plugin",
  displayName: "Web Fetch",
  auth: "query",
  status: { kind: "ok" },
  pricingAsOf: "2026-10-01",
  pricingStale: false,
  firstUseNoticed: false,
  autoRank: null,
};
const sample = {
  providers: [exa, brave, stagehand, fetching],
  settings: {
    searchProvider: "auto",
    searchOrder: ["plugin:brave-search", "exa"],
    searchParallel: 2,
    browseProvider: "auto",
    browseOrder: ["stagehand"],
    robots: "auto",
  },
};

const resultSchema = WIRE_METHODS["web.providers"].result;

describe("web.providers (M3-REQ-96)", () => {
  test("is a M3 read method whose params take no fields", () => {
    const method = WIRE_METHODS["web.providers"];
    expect(method.stage).toBe("M3");
    expect(parse(method.params, {}).ok).toBe(true);
    expect(parse(method.params, { providerId: "exa" }).ok).toBe(false);
  });

  test("a valid result round-trips by value", () => {
    expect(parsed(resultSchema, sample)).toEqual(sample);
    expect(parsed(WebProviderStatusSchema, exa)).toEqual(exa);
    expect(parsed(WebProviderStatusSchema, brave)).toEqual(brave);
    expect(parsed(WebProviderStatusSchema, fetching)).toEqual(fetching);
  });

  test("auto rank is a 0-based integer or null: a valid rank is kept, a negative or fractional one is rejected", () => {
    expect(parsed(WebProviderStatusSchema, { ...exa, autoRank: 0 })).toEqual({
      ...exa,
      autoRank: 0,
    });
    expect(parsed(WebProviderStatusSchema, { ...exa, autoRank: 7 })).toEqual({
      ...exa,
      autoRank: 7,
    });
    expect(parsed(WebProviderStatusSchema, { ...exa, autoRank: null })).toEqual({
      ...exa,
      autoRank: null,
    });
    expect(parse(WebProviderStatusSchema, { ...exa, autoRank: -1 }).ok).toBe(false);
    expect(parse(WebProviderStatusSchema, { ...exa, autoRank: 1.5 }).ok).toBe(false);
    expect(parse(WebProviderStatusSchema, { ...exa, autoRank: "1" }).ok).toBe(false);
  });

  test("a wrong capability, origin or auth kind is rejected", () => {
    expect(parse(WebProviderStatusSchema, { ...exa, capability: "web.research" }).ok).toBe(false);
    expect(parse(WebProviderStatusSchema, { ...exa, origin: "remote" }).ok).toBe(false);
    expect(parse(WebProviderStatusSchema, { ...exa, auth: "cookie" }).ok).toBe(false);
  });

  test("an unknown status kind is rejected, and so are extra or over-long status fields", () => {
    expect(parse(WebProviderStatusSchema, { ...exa, status: { kind: "maybe" } }).ok).toBe(false);
    expect(
      parse(WebProviderStatusSchema, { ...exa, status: { kind: "ok", reason: "no-key" } }).ok,
    ).toBe(false);
    expect(
      parse(WebProviderStatusSchema, {
        ...exa,
        status: { kind: "unavailable", reason: "x".repeat(65) },
      }).ok,
    ).toBe(false);
    expect(
      parse(WebProviderStatusSchema, {
        ...exa,
        status: { kind: "unavailable", reason: "no-key", detail: "x".repeat(513) },
      }).ok,
    ).toBe(false);
    expect(parse(WebProviderStatusSchema, { ...exa, status: { kind: "unavailable" } }).ok).toBe(
      false,
    );
  });

  test("a missing field is rejected", () => {
    const { displayName: _displayName, ...withoutName } = exa;
    expect(parse(WebProviderStatusSchema, withoutName).ok).toBe(false);
    const { firstUseNoticed: _first, ...withoutFirst } = exa;
    expect(parse(WebProviderStatusSchema, withoutFirst).ok).toBe(false);
    const { pricingAsOf: _asOf, ...withoutAsOf } = exa;
    expect(parse(WebProviderStatusSchema, withoutAsOf).ok).toBe(false);
    const { autoRank: _rank, ...withoutRank } = exa;
    expect(parse(WebProviderStatusSchema, withoutRank).ok).toBe(false);
    const { providers: _providers, ...withoutProviders } = sample;
    expect(parse(resultSchema, withoutProviders).ok).toBe(false);
  });

  test("settings bounds: searchParallel 1..4, robots enum, at most 64 providers", () => {
    const withSettings = (patch: Record<string, unknown>): unknown => ({
      ...sample,
      settings: { ...sample.settings, ...patch },
    });
    expect(parse(resultSchema, withSettings({ searchParallel: 0 })).ok).toBe(false);
    expect(parse(resultSchema, withSettings({ searchParallel: 5 })).ok).toBe(false);
    expect(parse(resultSchema, withSettings({ searchParallel: 4 })).ok).toBe(true);
    expect(parse(resultSchema, withSettings({ robots: "sometimes" })).ok).toBe(false);
    expect(parse(resultSchema, withSettings({ robots: "never" })).ok).toBe(true);
    const longOrder = Array.from({ length: 65 }, (_, i) => `p${i}`);
    expect(parse(resultSchema, withSettings({ searchOrder: longOrder })).ok).toBe(false);
    const tooMany = Array.from({ length: 65 }, () => exa);
    expect(parse(resultSchema, { ...sample, providers: tooMany }).ok).toBe(false);
  });

  test("no field can carry a key: the property names are fixed and extra fields are rejected", () => {
    expect(Object.keys(WebProvidersResultSchema.properties).toSorted()).toEqual([
      "providers",
      "settings",
    ]);
    expect(Object.keys(WebProviderStatusSchema.properties).toSorted()).toEqual([
      "auth",
      "autoRank",
      "capability",
      "displayName",
      "firstUseNoticed",
      "id",
      "origin",
      "pricingAsOf",
      "pricingStale",
      "status",
    ]);
    expect(Object.keys(WebProvidersResultSchema.properties.settings.properties).toSorted()).toEqual(
      [
        "browseOrder",
        "browseProvider",
        "robots",
        "searchOrder",
        "searchParallel",
        "searchProvider",
      ],
    );
    expect(parse(WebProviderStatusSchema, { ...exa, apiKey: "sk-test" }).ok).toBe(false);
    expect(parse(WebProviderStatusSchema, { ...exa, secret: "sk-test" }).ok).toBe(false);
    expect(
      parse(resultSchema, { ...sample, settings: { ...sample.settings, token: "t" } }).ok,
    ).toBe(false);
  });
});
