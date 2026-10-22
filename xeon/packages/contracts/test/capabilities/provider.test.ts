import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  ProviderIdSchema,
  orderProviderCandidates,
  type ProviderCandidate,
} from "../../src/capabilities/index.ts";

const CANDIDATES: readonly ProviderCandidate[] = [
  { id: "builtin-b", origin: "builtin" },
  { id: "builtin-a", origin: "builtin" },
  { id: "plugin:exa", origin: "plugin" },
  { id: "plugin:acme", origin: "plugin" },
  { id: "searxng", origin: "detected" },
  { id: "plugin:zed", origin: "plugin" },
];

describe("orderProviderCandidates", () => {
  test("a call-level provider is tried alone", () => {
    expect(
      orderProviderCandidates({
        candidates: CANDIDATES,
        callProvider: "searxng",
        settingProvider: "builtin-a",
        pluginOrder: [],
      }),
    ).toEqual({ selectedBy: "call", order: ["searxng"] });
  });

  test("a setting provider is tried alone, and an unknown one yields nothing", () => {
    expect(
      orderProviderCandidates({
        candidates: CANDIDATES,
        settingProvider: "builtin-a",
        pluginOrder: [],
      }),
    ).toEqual({ selectedBy: "setting", order: ["builtin-a"] });
    expect(
      orderProviderCandidates({
        candidates: CANDIDATES,
        settingProvider: "missing",
        pluginOrder: [],
      }).order,
    ).toEqual([]);
    expect(
      orderProviderCandidates({
        candidates: CANDIDATES,
        callProvider: "missing",
        settingProvider: "auto",
        pluginOrder: [],
      }).order,
    ).toEqual([]);
  });

  test("auto: plugins in pluginOrder, unlisted plugins by id, then detected, then builtin", () => {
    const result = orderProviderCandidates({
      candidates: CANDIDATES,
      settingProvider: "auto",
      pluginOrder: ["plugin:exa", "plugin:ghost"],
    });
    expect(result.selectedBy).toBe("auto");
    expect(result.order).toEqual([
      "plugin:exa",
      "plugin:acme",
      "plugin:zed",
      "searxng",
      "builtin-a",
      "builtin-b",
    ]);
  });

  test("same input, same output regardless of candidate order", () => {
    const pluginOrder: readonly string[] = [];
    const input = { settingProvider: "auto", pluginOrder };
    const a = orderProviderCandidates({ ...input, candidates: CANDIDATES });
    const b = orderProviderCandidates({ ...input, candidates: CANDIDATES.toReversed() });
    expect(a).toEqual(b);
  });

  test("provider id schema", () => {
    expect(parse(ProviderIdSchema, "plugin:web-exa").ok).toBe(true);
    expect(parse(ProviderIdSchema, "searxng").ok).toBe(true);
    expect(parse(ProviderIdSchema, "Plugin:x").ok).toBe(false);
  });
});
