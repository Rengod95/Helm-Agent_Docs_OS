import { describe, expect, test } from "bun:test";
import { isDraftTrial } from "../../../src/views/plugin/plugin-trial.ts";

describe("isDraftTrial", () => {
  const mark = { profileId: null, target: null, paused: false };
  test("a draft test run is a draft trial", () => {
    expect(isDraftTrial({ testRun: { ...mark, kind: "draft" } })).toBe(true);
    expect(isDraftTrial({ testRun: { ...mark, draft: true } })).toBe(true);
  });
  test("other threads are not", () => {
    expect(isDraftTrial(undefined)).toBe(false);
    expect(isDraftTrial({})).toBe(false);
    expect(isDraftTrial({ testRun: mark })).toBe(false);
  });
});
