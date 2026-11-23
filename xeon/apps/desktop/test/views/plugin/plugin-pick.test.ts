import { describe, expect, test } from "bun:test";
import {
  groupPlacements,
  layoutOf,
  UI_HIDDEN_KEY,
  UI_ORDER_KEY,
} from "../../../src/plugin-ui/placements.ts";
import type { PluginUiState } from "../../../src/plugin-ui/runtime.ts";
import { panelOrderKeysOf, pluginScreenItemsOf } from "../../../src/views/plugin/plugin-pick.ts";
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
    layout: layoutOf(settings),
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

  test("the default order is screens, then side panels, each by extension and id", () => {
    const keys = pluginScreenItemsOf(stateOf({})).map(
      ({ entry }) => `${entry.extension}/${entry.id}`,
    );
    expect(keys).toEqual(["gone/off", "helm/inquiry", "review/queue", "viewdemo/demo"]);
  });

  test("a hidden screen leaves the list, and the user order goes first", () => {
    const state = stateOf({
      [UI_HIDDEN_KEY]: ["review/queue"],
      [UI_ORDER_KEY]: { panel: ["viewdemo/demo", "removed/plugin", "helm/inquiry"] },
    });
    const keys = pluginScreenItemsOf(state).map(({ entry }) => `${entry.extension}/${entry.id}`);
    expect(keys).toEqual(["viewdemo/demo", "helm/inquiry", "gone/off"]);
    // 순서 메뉴는 숨긴 화면도 포함한 목록에서 옮긴다(Helm 옆 패널은 목록에 들지 않는다)
    expect(panelOrderKeysOf(state)).toEqual([
      "viewdemo/demo",
      "helm/inquiry",
      "gone/off",
      "review/queue",
    ]);
  });
});
