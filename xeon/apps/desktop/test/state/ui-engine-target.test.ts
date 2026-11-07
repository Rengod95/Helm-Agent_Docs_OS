import { describe, expect, test } from "bun:test";
import { createUiStore } from "../../src/state/ui/store.ts";

describe("engine target in the ui store", () => {
  test("a new store starts on this computer, so the last target is not remembered across launches", () => {
    const ui = createUiStore();
    expect(ui.read.getState().engineTarget).toEqual({ kind: "local" });
  });

  test("setEngineTarget records a remote target with its name and returns to local", () => {
    const ui = createUiStore();
    ui.actions.setEngineTarget({
      kind: "remote",
      address: "unix:/run/box.sock",
      label: "build-box",
    });
    expect(ui.read.getState().engineTarget).toEqual({
      kind: "remote",
      address: "unix:/run/box.sock",
      label: "build-box",
    });
    ui.actions.setEngineTarget({ kind: "local" });
    expect(ui.read.getState().engineTarget).toEqual({ kind: "local" });
  });
});
