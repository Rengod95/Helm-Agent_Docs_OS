import { describe, expect, test } from "bun:test";
import { createUiStore } from "../../src/state/ui/store.ts";

describe("command run counter in the ui store", () => {
  test("counts finished slash commands so the goal cell reads the goal again", () => {
    const ui = createUiStore();
    expect(ui.read.getState().commandRuns).toBe(0);
    ui.actions.noteCommandRun();
    ui.actions.noteCommandRun();
    expect(ui.read.getState().commandRuns).toBe(2);
  });
});
