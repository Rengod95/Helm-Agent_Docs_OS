import { describe, expect, test } from "bun:test";
import type { SearchCandidate } from "../src/ports/providers.ts";
import { fakeSearchProvider } from "../src/testing/fake-providers.ts";
import {
  decideModelSearchTool,
  isWrapperOnlyChain,
  type ModelSearchSetting,
  type ModelSearchTool,
} from "../src/search/model-tool.ts";

describe("model tool", () => {
  test("decide model search tool", () => {
    const table: readonly (readonly [ModelSearchSetting, boolean, boolean, ModelSearchTool])[] = [
      // [설정, 체인이 래퍼뿐, hosted 지원, 결과]
      ["off", true, true, "off"],
      ["off", false, false, "off"],
      ["function", true, true, "function"],
      ["function", false, false, "function"],
      ["hosted", true, true, "hosted"],
      ["hosted", false, true, "hosted"],
      ["hosted", true, false, "function"],
      ["auto", true, true, "hosted"],
      ["auto", true, false, "function"],
      ["auto", false, true, "function"],
      ["auto", false, false, "function"],
    ];
    for (const [setting, wrapperOnlyChain, hostedSupported, expected] of table) {
      expect([
        setting,
        wrapperOnlyChain,
        hostedSupported,
        decideModelSearchTool({ setting, wrapperOnlyChain, hostedSupported }),
      ]).toEqual([setting, wrapperOnlyChain, hostedSupported, expected]);
    }
  });
});

const candidate = (id: string, origin: "plugin" | "detected" | "builtin"): SearchCandidate => ({
  provider: fakeSearchProvider(id),
  origin,
  cachePolicy: "session",
});

describe("wrapper-only chain", () => {
  test("only builtin candidates make the chain wrapper-only", () => {
    const table: readonly (readonly [string, readonly SearchCandidate[], boolean])[] = [
      ["wrapper alone", [candidate("builtin-wrapper", "builtin")], true],
      [
        "a configured searxng ahead of the wrapper",
        [candidate("searxng", "detected"), candidate("builtin-wrapper", "builtin")],
        false,
      ],
      [
        "a key plugin ahead of the wrapper",
        [candidate("plugin:a", "plugin"), candidate("builtin-wrapper", "builtin")],
        false,
      ],
      ["no candidate at all", [], false],
    ];
    for (const [name, candidates, expected] of table) {
      expect([name, isWrapperOnlyChain(candidates)]).toEqual([name, expected]);
    }
  });
});
