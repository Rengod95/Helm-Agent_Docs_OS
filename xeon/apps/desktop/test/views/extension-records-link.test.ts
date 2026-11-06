import { describe, expect, test } from "bun:test";
import { createShellStore } from "../../src/state/shell/index.ts";
import { createWorkbenchStore } from "../../src/state/workbench/index.ts";
import { recordsJumpOf } from "../../src/views/extension-records-link.ts";

describe("recordsJumpOf", () => {
  test("from the chat it goes to the workbench extensions screen and opens that extension's record tab", () => {
    const shell = createShellStore(1280);
    const workbench = createWorkbenchStore();
    recordsJumpOf(shell.actions, workbench.actions)("bad-guard");
    const place = shell.read.getState();
    expect([place.area, place.places.workbench.screen]).toEqual(["workbench", "extensions"]);
    const state = workbench.read.getState();
    expect([state.detail, state.detailTab, state.sel]).toEqual([
      "bad-guard",
      "record",
      { k: "plugin", id: "bad-guard" },
    ]);
  });

  test("a second jump to another extension replaces the open record tab's extension", () => {
    const shell = createShellStore(1280);
    const workbench = createWorkbenchStore();
    const jump = recordsJumpOf(shell.actions, workbench.actions);
    jump("bad-guard");
    jump("other");
    const state = workbench.read.getState();
    expect([state.detail, state.detailTab]).toEqual(["other", "record"]);
  });
});
