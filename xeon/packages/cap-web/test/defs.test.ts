import { describe, expect, test } from "bun:test";
import {
  validateCapability,
  validateCapabilitySet,
  WEB_CAPABILITIES,
  WebSearch,
  WebFetch,
} from "@xeon/contracts/capabilities";

describe("web capability definitions", () => {
  test("four web capabilities validate with zero issues", () => {
    for (const def of WEB_CAPABILITIES) {
      expect(validateCapability(def)).toEqual([]);
    }
    expect(validateCapabilitySet(WEB_CAPABILITIES)).toEqual([]);
  });

  test("search tool params exclude provider", () => {
    const tool = WebSearch.tools[0];
    const params = JSON.stringify(tool.parameters);
    expect(params).not.toContain('"provider"');
    expect(JSON.stringify(WebSearch.service.methods.search.input)).toContain('"provider"');
    expect(tool.toInput?.({ query: "xeon" })).toEqual({ query: "xeon" });
    const fetchTool = WebFetch.tools[0];
    expect(JSON.stringify(fetchTool.parameters)).not.toContain('"provider"');
  });
});
