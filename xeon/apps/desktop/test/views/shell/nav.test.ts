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

  test("the chat nav lists five items without the inbox (it lives on the right toolbar), the plugin pages entry last and on nav.6", () => {
    expect(NAV_BY_AREA.chat.map((item) => [item.id, item.label, item.action])).toEqual([
      ["chat", "desktop.shell.nav.chat", "nav.1"],
      ["proposals", "desktop.shell.nav.proposals", "nav.3"],
      ["schedules", "desktop.shell.nav.schedules", "nav.4"],
      ["connection", "desktop.shell.nav.connection", "nav.5"],
      ["plugins", "desktop.shell.nav.plugins", "nav.6"],
    ]);
  });
});
