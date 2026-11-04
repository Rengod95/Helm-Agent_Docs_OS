import { describe, expect, test } from "bun:test";
import { createUiStore } from "../../src/state/ui/store.ts";

describe("restart needed list in the ui store", () => {
  test("starts empty", () => {
    expect(createUiStore().read.getState().restartNeeded).toEqual([]);
  });

  test("a reason is kept once per kind and name, in the order first noted", () => {
    const ui = createUiStore();
    ui.actions.noteRestartNeeded({ kind: "install", name: "alpha" });
    ui.actions.noteRestartNeeded({ kind: "install", name: "alpha" });
    ui.actions.noteRestartNeeded({ kind: "rollback", name: "alpha" });
    ui.actions.noteRestartNeeded({ kind: "install", name: "beta" });
    expect(ui.read.getState().restartNeeded).toEqual([
      { kind: "install", name: "alpha" },
      { kind: "rollback", name: "alpha" },
      { kind: "install", name: "beta" },
    ]);
  });

  test("a duplicate note keeps the same state object, so subscribers are not woken", () => {
    const ui = createUiStore();
    ui.actions.noteRestartNeeded({ kind: "install", name: "alpha" });
    const before = ui.read.getState();
    ui.actions.noteRestartNeeded({ kind: "install", name: "alpha" });
    expect(ui.read.getState()).toBe(before);
  });

  test("clear empties the list and leaves the other ui keys alone", () => {
    const ui = createUiStore();
    ui.actions.toggleSidebar();
    ui.actions.noteRestartNeeded({ kind: "rollback", name: "gamma" });
    ui.actions.clearRestartNeeded();
    expect(ui.read.getState().restartNeeded).toEqual([]);
    expect(ui.read.getState().sidebarOpen).toBe(false);
  });

  test("clearing an empty list keeps the same state object", () => {
    const ui = createUiStore();
    const before = ui.read.getState();
    ui.actions.clearRestartNeeded();
    expect(ui.read.getState()).toBe(before);
  });
});
