import { describe, expect, test } from "bun:test";
import { groupPlacements } from "../../../src/plugin-ui/placements.ts";
import { UI_APPS_KEY } from "../../../src/plugin-ui/policy-context.ts";
import type { PluginUiState } from "../../../src/plugin-ui/runtime.ts";
import { pluginUiRowsOf } from "../../../src/views/plugin/plugin-pick.ts";
import { uiEntryOf } from "../../plugin-ui/support.ts";

function stateOf(
  settings: Record<string, unknown>,
  inactive: readonly string[] = [],
): PluginUiState {
  const entries = [
    uiEntryOf({ extension: "review", id: "queue", title: "리뷰 대기열" }),
    uiEntryOf({ extension: "helm", id: "inquiry", title: "Helm 탐구" }),
    uiEntryOf({ extension: "helm", id: "side", placement: "panel" }),
    uiEntryOf({ extension: "viewdemo", id: "demo", placement: "panel", title: "데모" }),
    uiEntryOf({ extension: "gone", id: "off", state: "disabled" }),
  ];
  return {
    phase: "ready",
    entries,
    settings,
    groups: groupPlacements(entries, settings),
    inactive: new Set(inactive),
    rootsSkipped: [],
  };
}

describe("pluginUiRowsOf", () => {
  test("lists page entries and non-Helm panels, marks off ones, hides Helm's panel", () => {
    const rows = pluginUiRowsOf(stateOf({}, ["review"]));
    expect(rows.map((row) => [row.key, row.off])).toEqual([
      ["gone/off", true],
      ["helm/inquiry", false],
      ["review/queue", true],
      ["viewdemo/demo", false],
    ]);
  });

  test("the section is empty when plugin apps are turned off", () => {
    expect(pluginUiRowsOf(stateOf({ [UI_APPS_KEY]: false }))).toEqual([]);
    expect(pluginUiRowsOf(stateOf({ [UI_APPS_KEY]: true })).length).toBe(4);
  });
});
