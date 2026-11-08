import { describe, expect, test } from "bun:test";
import type { SettingsInvalidation } from "@fresnel/client/settings";
import type { ModelEntry } from "@fresnel/contracts/wire";
import {
  THINKING_LEVEL_KEY,
  thinkingChangeConcerns,
  thinkingLevelOf,
  thinkingSelectableOf,
} from "../../src/views/thinking-level-model.ts";
import { thr } from "../state/helpers.ts";

const entry = (ref: string, reasoning: boolean): ModelEntry => ({
  ref,
  name: ref,
  contextWindow: 200000,
  reasoning,
  inputPrice: null,
  outputPrice: null,
});

describe("thinkingLevelOf", () => {
  test("accepts the seven known levels and nothing else", () => {
    for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
      expect(thinkingLevelOf(level)).toBe(level);
    }
    expect(thinkingLevelOf("High")).toBeNull();
    expect(thinkingLevelOf("")).toBeNull();
    expect(thinkingLevelOf(3)).toBeNull();
    expect(thinkingLevelOf(undefined)).toBeNull();
  });
});

describe("thinkingSelectableOf", () => {
  const choices = [entry("a/think", true), entry("a/plain", false)];
  test("follows the catalog flag and shows the select for unknown models", () => {
    expect(thinkingSelectableOf(choices, "a/think")).toBe(true);
    expect(thinkingSelectableOf(choices, "a/plain")).toBe(false);
    expect(thinkingSelectableOf(choices, "b/other")).toBe(true);
  });
});

const notice = (keys: readonly string[], threadId: SettingsInvalidation["threadId"]) => ({
  keys: [...keys],
  scopes: ["launch" as const],
  threadId,
});

describe("thinkingChangeConcerns", () => {
  test("wakes for the thinking key of this thread and for unscoped notices", () => {
    expect(thinkingChangeConcerns(notice([THINKING_LEVEL_KEY], thr(1)), thr(1))).toBe(true);
    expect(thinkingChangeConcerns(notice([], null), thr(1))).toBe(true);
    expect(thinkingChangeConcerns(notice([THINKING_LEVEL_KEY], thr(2)), thr(1))).toBe(false);
    expect(thinkingChangeConcerns(notice(["l1.tools.permissionMode"], thr(1)), thr(1))).toBe(false);
  });
});
