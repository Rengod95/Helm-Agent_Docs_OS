import { describe, expect, test } from "bun:test";
import {
  duplicateTitlesOf,
  hiddenTabsOf,
  visibleTabsOf,
} from "../../../src/views/plugin/panel-screen-tabs.ts";
import { uiEntryOf } from "../../plugin-ui/support.ts";

// 좁은 옆 패널의 화면 탭 줄(AGE-73 railFix): 드는 만큼 보이고 나머지는 "다른 화면" 메뉴로 접는다.

const fit = (widths: readonly number[], available: number, selected = 0) => ({
  widths,
  available,
  gap: 2,
  more: 30,
  selected,
});

describe("panel screen tabs", () => {
  test("all tabs show when they fit, with nothing in the menu", () => {
    const visible = visibleTabsOf(fit([60, 60, 60], 184));
    expect(visible).toEqual([0, 1, 2]);
    expect(hiddenTabsOf(3, visible)).toEqual([]);
  });

  test("when they overflow, the leading tabs that fit beside the menu button show and the rest fold", () => {
    // 쓸 폭 200 - 메뉴 30 = 170: 60 + 2 + 60 = 122, 셋째까지는 184라 안 든다
    const visible = visibleTabsOf(fit([60, 60, 60, 60], 200));
    expect(visible).toEqual([0, 1]);
    expect(hiddenTabsOf(4, visible)).toEqual([2, 3]);
  });

  test("a selected tab that would fold takes the last visible place", () => {
    const visible = visibleTabsOf(fit([60, 60, 60, 60], 200, 3));
    expect(visible).toEqual([0, 3]);
    expect(hiddenTabsOf(4, visible)).toEqual([1, 2]);
  });

  test("a wide selected tab that does not fit beside the others stands alone", () => {
    const visible = visibleTabsOf(fit([40, 40, 40, 160], 120, 3));
    expect(visible).toEqual([3]);
    expect(hiddenTabsOf(4, visible)).toEqual([0, 1, 2]);
  });

  test("at least one tab shows even when the first is wider than the room", () => {
    expect(visibleTabsOf(fit([160, 60], 100))).toEqual([0]);
  });

  test("no tabs gives an empty list", () => {
    expect(visibleTabsOf(fit([], 200, -1))).toEqual([]);
    expect(hiddenTabsOf(0, [])).toEqual([]);
  });

  test("titles shared by two screens are marked so they get the plugin name", () => {
    const entries = [
      uiEntryOf({ extension: "kanban", id: "board", placement: "page", title: "칸반" }),
      uiEntryOf({ extension: "kanban-native", id: "board", placement: "page", title: "칸반" }),
      uiEntryOf({ extension: "suggest", id: "page", placement: "page", title: "제안" }),
    ];
    expect([...duplicateTitlesOf(entries)]).toEqual(["칸반"]);
  });
});
