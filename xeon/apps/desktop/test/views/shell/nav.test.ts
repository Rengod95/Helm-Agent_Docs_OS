import { describe, expect, test } from "bun:test";
import { NAV_BY_AREA, NAV_SHORTCUTS } from "../../../src/views/shell/nav.ts";

describe("nav table", () => {
  test("the workbench nav has five items: profile, review, plugins, tests and Craft metrics, with no overview, old metrics, compose or engine row", () => {
    expect(NAV_BY_AREA.workbench.map((item) => [item.id, item.label])).toEqual([
      ["profile", "desktop.shell.nav.profile"],
      ["craftReview", "desktop.shell.nav.review"],
      ["extensions", "desktop.shell.nav.extensions"],
      ["tests", "desktop.shell.nav.tests"],
      ["craft-metrics", "desktop.shell.nav.craftMetrics"],
    ]);
  });

  test("the chat nav lists three items: no chat row (the new-chat row and thread list take it) and no connection row (it moved to settings)", () => {
    expect(NAV_BY_AREA.chat.map((item) => [item.id, item.label, item.action])).toEqual([
      ["proposals", "desktop.shell.nav.proposals", "nav.3"],
      ["schedules", "desktop.shell.nav.schedules", "nav.4"],
      ["plugins", "desktop.shell.nav.plugins", "nav.6"],
    ]);
  });

  test("every nav.N key keeps a target: the chat screen, the inbox tab, a nav screen or the connection command", () => {
    expect(NAV_SHORTCUTS).toEqual({
      "nav.1": { kind: "screen", screen: "chat" },
      "nav.2": { kind: "inbox" },
      "nav.3": { kind: "screen", screen: "proposals" },
      "nav.4": { kind: "screen", screen: "schedules" },
      "nav.5": { kind: "connection" },
      "nav.6": { kind: "screen", screen: "plugins" },
    });
  });
});
