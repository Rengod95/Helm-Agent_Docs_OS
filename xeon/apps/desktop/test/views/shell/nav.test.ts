import { describe, expect, test } from "bun:test";
import { NAV_BY_AREA } from "../../../src/views/shell/nav.ts";

describe("nav table", () => {
  test("the workbench nav lists the plugin pages entry right after extensions", () => {
    expect(NAV_BY_AREA.workbench.map((item) => [item.id, item.label])).toEqual([
      ["overview", "desktop.shell.nav.overview"],
      ["extensions", "desktop.shell.nav.extensions"],
      ["plugins", "desktop.shell.nav.plugins"],
      ["tests", "desktop.shell.nav.tests"],
      ["metrics", "desktop.shell.nav.metrics"],
      ["compose", "desktop.shell.nav.compose"],
      ["engine", "desktop.shell.nav.engine"],
    ]);
  });

  test("the chat nav keeps its five items", () => {
    expect(NAV_BY_AREA.chat.map((item) => item.id)).toEqual([
      "chat",
      "inbox",
      "proposals",
      "schedules",
      "connection",
    ]);
  });
});
