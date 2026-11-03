import { describe, expect, test } from "bun:test";
import { groupPlacements, type PlacedEntry } from "../../src/plugin-ui/placements.ts";
import { UI_ALLOW_PROJECT_APPS_KEY, UI_APPS_KEY } from "../../src/plugin-ui/policy-context.ts";
import { appEntryOf, uiEntryOf } from "./support.ts";

const idsOf = (rows: readonly PlacedEntry[]): string[] =>
  rows.map((row) => `${row.entry.extension}/${row.entry.id}`);

describe("groupPlacements", () => {
  test("every placement host gets a list, empty when nothing is placed there", () => {
    const groups = groupPlacements([uiEntryOf({ placement: "card", id: "c" })], {});
    expect(Object.keys(groups).toSorted()).toEqual([
      "card",
      "command",
      "page",
      "panel",
      "settings",
      "status",
    ]);
    expect(groups.page).toEqual([]);
    expect(idsOf(groups.card)).toEqual(["helm/c"]);
  });

  test("items go to their placement and keep disabled and invalid states", () => {
    const groups = groupPlacements(
      [
        uiEntryOf({ id: "off", state: "disabled" }),
        uiEntryOf({ id: "bad", state: "invalid" }),
        uiEntryOf({ id: "panel", placement: "panel" }),
      ],
      {},
    );
    expect(groups.page.map((row) => [row.entry.id, row.entry.state, row.blocked])).toEqual([
      ["bad", "invalid", null],
      ["off", "disabled", null],
    ]);
    expect(groups.panel.map((row) => row.entry.id)).toEqual(["panel"]);
  });

  test("the order inside a placement is by extension, then id, and stable for equal keys", () => {
    const groups = groupPlacements(
      [
        uiEntryOf({ extension: "zeta", id: "a" }),
        uiEntryOf({ extension: "alpha", id: "b" }),
        uiEntryOf({ extension: "alpha", id: "a", title: "first" }),
        uiEntryOf({ extension: "alpha", id: "a", title: "second" }),
      ],
      {},
    );
    expect(groups.page.map((row) => [row.entry.extension, row.entry.id, row.entry.title])).toEqual([
      ["alpha", "a", "first"],
      ["alpha", "a", "second"],
      ["alpha", "b", "상태"],
      ["zeta", "a", "상태"],
    ]);
  });

  test("an app entry is blocked when the project tier has no app permission", () => {
    const groups = groupPlacements([appEntryOf({ id: "graph", trust: "project" })], {});
    expect(groups.page.map((row) => row.blocked)).toEqual(["frame_blocked"]);
  });

  test("an app entry is free when the tier allows apps and the setting permits project apps", () => {
    const groups = groupPlacements(
      [
        appEntryOf({ id: "user-app", trust: "user" }),
        appEntryOf({ id: "project-app", trust: "project" }),
      ],
      { [UI_APPS_KEY]: true, [UI_ALLOW_PROJECT_APPS_KEY]: true },
    );
    expect(groups.page.map((row) => [row.entry.id, row.blocked])).toEqual([
      ["project-app", null],
      ["user-app", null],
    ]);
  });

  test("with no settings every app entry is blocked (x.ui.apps defaults off) and a native entry is not", () => {
    const groups = groupPlacements(
      [appEntryOf({ id: "app", trust: "user" }), uiEntryOf({ id: "native", trust: "user" })],
      {},
    );
    expect(groups.page.map((row) => [row.entry.id, row.blocked])).toEqual([
      ["app", "frame_blocked"],
      ["native", null],
    ]);
  });

  test("x.ui.apps false blocks app entries of every tier and leaves native entries alone", () => {
    const groups = groupPlacements(
      [appEntryOf({ id: "app", trust: "user" }), uiEntryOf({ id: "native", trust: "user" })],
      { [UI_APPS_KEY]: false },
    );
    expect(groups.page.map((row) => [row.entry.id, row.blocked])).toEqual([
      ["app", "frame_blocked"],
      ["native", null],
    ]);
  });

  test("a native entry keeps its tree and is never blocked by the app policy", () => {
    const tree = { type: "Text", props: { content: "화면" } } as const;
    const groups = groupPlacements([uiEntryOf({ id: "native", trust: "project", tree })], {});
    expect(groups.page[0]?.entry.tree).toEqual(tree);
    expect(groups.page[0]?.blocked).toBeNull();
  });
});
