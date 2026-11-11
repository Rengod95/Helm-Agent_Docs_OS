import { describe, expect, test } from "bun:test";
import { createUiStore } from "../../src/state/ui/store.ts";

describe("opening a settings section in the ui store", () => {
  test("openSettingsSection(connection) shows the settings screen on the connection section with no key", () => {
    const ui = createUiStore();
    ui.actions.openSettingsSection("connection");
    expect(ui.read.getState().screen).toBe("settings");
    expect(ui.read.getState().settingsJump).toEqual({ tab: "connection", key: null });
  });

  test("it leaves the same state as requesting the jump by hand", () => {
    const opened = createUiStore();
    opened.actions.openSettingsSection("connection");
    const requested = createUiStore();
    requested.actions.requestSettingsJump({ tab: "connection", key: null });
    expect(opened.read.getState().screen).toBe(requested.read.getState().screen);
    expect(opened.read.getState().settingsJump).toEqual(requested.read.getState().settingsJump);
  });

  test("the settings page takes the request once it settles, and the screen stays on settings", () => {
    const ui = createUiStore();
    ui.actions.openSettingsSection("connection");
    ui.actions.settleSettingsJump();
    expect(ui.read.getState().settingsJump).toBeNull();
    expect(ui.read.getState().screen).toBe("settings");
  });
});
