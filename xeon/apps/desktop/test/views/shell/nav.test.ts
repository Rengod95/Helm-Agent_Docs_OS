import { describe, expect, test } from "bun:test";
import { NAV_BY_AREA } from "../../../src/views/shell/nav.ts";

describe("nav table", () => {
  test("the workbench nav lists its six items, with no plugin pages entry", () => {
    expect(NAV_BY_AREA.workbench.map((item) => [item.id, item.label])).toEqual([
      ["overview", "desktop.shell.nav.overview"],
      ["extensions", "desktop.shell.nav.extensions"],
      ["tests", "desktop.shell.nav.tests"],
      ["metrics", "desktop.shell.nav.metrics"],
      ["compose", "desktop.shell.nav.compose"],
      ["engine", "desktop.shell.nav.engine"],
    ]);
  });

  test("the chat nav lists three items: no chat row (the pinned new-thread row replaces it), no connection (it moved into settings), the plugin pages entry last on nav.3", () => {
    expect(NAV_BY_AREA.chat.map((item) => [item.id, item.label, item.action])).toEqual([
      ["proposals", "desktop.shell.nav.proposals", "nav.1"],
      ["schedules", "desktop.shell.nav.schedules", "nav.2"],
      ["plugins", "desktop.shell.nav.plugins", "nav.3"],
    ]);
  });
});
