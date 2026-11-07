import { describe, expect, test } from "bun:test";
import { createUiStore } from "../../src/state/ui/store.ts";

describe("denied models in the UI store", () => {
  test("a model is noted once, kept while others come and go, and cleared when it succeeds", () => {
    const { read, actions } = createUiStore();
    expect(read.getState().deniedModels).toEqual({});
    actions.noteModelDenied("anthropic/a");
    const first = read.getState().deniedModels;
    expect(first).toEqual({ "anthropic/a": true });
    actions.noteModelDenied("anthropic/a");
    expect(read.getState().deniedModels).toBe(first);
    actions.noteModelDenied("openai/b");
    actions.clearModelDenied("anthropic/a");
    expect(read.getState().deniedModels).toEqual({ "openai/b": true });
    const kept = read.getState().deniedModels;
    actions.clearModelDenied("anthropic/a");
    expect(read.getState().deniedModels).toBe(kept);
  });
});
