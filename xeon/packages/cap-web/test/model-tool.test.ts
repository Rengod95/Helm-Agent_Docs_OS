import { describe, expect, test } from "bun:test";
import {
  decideModelSearchTool,
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
