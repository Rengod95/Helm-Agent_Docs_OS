import { describe, expect, test } from "bun:test";
import { createShellStore } from "../../../src/state/shell/index.ts";
import { runShellAction } from "../../../src/views/shell/shortcuts.ts";
import { toastPlace } from "../../../src/views/shell/toaster-slot.ts";

describe("toast place (S-04)", () => {
  test("an open well moves the toast to the well's left edge, a closed one leaves it by the bar", () => {
    expect(toastPlace("wide", false, 352)).toEqual({ kind: "end", endPx: 56 });
    expect(toastPlace("wide", true, 352)).toEqual({ kind: "end", endPx: 352 + 74 });
    expect(toastPlace("medium", true, 480)).toEqual({ kind: "end", endPx: 480 + 74 });
  });

  test("compact has no side well to avoid, so the toast sits bottom center", () => {
    expect(toastPlace("compact", true, 352)).toEqual({ kind: "center-bottom" });
  });
});

const settings = (): { open: boolean; set: (open: boolean) => void; calls: boolean[] } => {
  const calls: boolean[] = [];
  return {
    open: true,
    calls,
    set: (open) => {
      calls.push(open);
    },
  };
};

describe("shell shortcut actions", () => {
  test("area keys switch the area and close the settings screen", () => {
    const store = createShellStore(1400);
    const s = settings();
    expect(runShellAction("area.workbench", store.read.getState(), store.actions, s)).toBe(true);
    expect(store.read.getState().area).toBe("workbench");
    expect(runShellAction("area.toggle", store.read.getState(), store.actions, s)).toBe(true);
    expect(store.read.getState().area).toBe("chat");
    expect(s.calls).toEqual([false, false]);
  });

  test("nav.3 opens the third chat screen in the chat area", () => {
    const store = createShellStore(1400);
    store.actions.switchArea("workbench");
    const s = settings();
    expect(runShellAction("nav.3", store.read.getState(), store.actions, s)).toBe(true);
    const state = store.read.getState();
    expect(state.area).toBe("chat");
    expect(state.places.chat.screen).toBe("proposals");
    expect(s.calls).toEqual([false]);
  });

  test("panel keys open the named tab of the current area", () => {
    const store = createShellStore(1400);
    expect(runShellAction("panel.work", store.read.getState(), store.actions, settings())).toBe(
      true,
    );
    const state = store.read.getState();
    expect(state.endOpen).toBe(true);
    expect(state.places.chat.endTab).toBe("work");
  });

  test("actions the shell does not own are left to the caller", () => {
    const store = createShellStore(1400);
    for (const id of ["thread.new", "turn.interrupt", "composer.focus", "approval.next"] as const) {
      expect(runShellAction(id, store.read.getState(), store.actions, settings())).toBe(false);
    }
  });

  test("Esc closes the end well before anything else, and compact's start sheet after it", () => {
    const store = createShellStore(600);
    store.actions.setStartOpen(true);
    store.actions.openEndTab("inbox");
    expect(store.actions.dismissFloating()).toBe(true);
    expect(store.read.getState().endOpen).toBe(false);
    expect(store.read.getState().startOpen).toBe(true);
    expect(store.actions.dismissFloating()).toBe(true);
    expect(store.read.getState().startOpen).toBe(false);
    expect(store.actions.dismissFloating()).toBe(false);
  });
});
