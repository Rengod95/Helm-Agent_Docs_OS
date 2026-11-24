import { describe, expect, test } from "bun:test";
import { trialDraftOf } from "../../../src/views/plugin/plugin-trial.ts";

describe("trialDraftOf", () => {
  test("a draft test run names the tested draft", () => {
    const mark = { profileId: null, target: "water", paused: false };
    expect(trialDraftOf({ testRun: { ...mark, kind: "draft" } })).toBe("water");
    expect(trialDraftOf({ testRun: { ...mark, draft: true } })).toBe("water");
  });
  test("other threads name nothing", () => {
    const mark = { profileId: null, target: "water", paused: false };
    expect(trialDraftOf(undefined)).toBeUndefined();
    expect(trialDraftOf({})).toBeUndefined();
    expect(trialDraftOf({ testRun: mark })).toBeUndefined();
    expect(trialDraftOf({ testRun: { ...mark, kind: "draft", target: null } })).toBeUndefined();
  });
});
