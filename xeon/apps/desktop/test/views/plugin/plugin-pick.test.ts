import { describe, expect, test } from "bun:test";
import { groupPlacements } from "../../../src/plugin-ui/placements.ts";
import type { PluginUiState } from "../../../src/plugin-ui/runtime.ts";
import { pluginScreenItemsOf } from "../../../src/views/plugin/plugin-pick.ts";
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

describe("pluginScreenItemsOf", () => {
  test("lists page entries and non-Helm panels and leaves Helm's panel to the Helm tab", () => {
    const keys = pluginScreenItemsOf(stateOf({}, ["review"])).map(
      ({ entry }) => `${entry.extension}/${entry.id}`,
    );
    expect(keys.toSorted()).toEqual(["gone/off", "helm/inquiry", "review/queue", "viewdemo/demo"]);
  });
});
