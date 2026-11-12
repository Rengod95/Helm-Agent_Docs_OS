import { describe, expect, test } from "bun:test";
import {
  dragEdgeOf,
  EMPTY_TAB_PREFS,
  KEPT_TABS_MAX,
  pinnedTabsOf,
  stripFadeOf,
  tabModeOf,
  touchedOf,
  wheelShiftOf,
  withAutoPinned,
  withDropped,
  withMoved,
  withPinned,
  type PlaygroundTabsPrefs,
} from "../../../src/views/plugin/playground-tabs.ts";

// 머리 줄 플레이그라운드 탭 모델(DP-90). 값을 그대로 비교한다.

const ABC: PlaygroundTabsPrefs = { pinned: ["a", "b", "c"], seen: ["a", "b", "c"] };

describe("withAutoPinned", () => {
  test("pins a plugin the first time it has a screen, at the end, and never again after unpinning", () => {
    const first = withAutoPinned(EMPTY_TAB_PREFS, ["a", "b"]);
    expect(first).toEqual({ pinned: ["a", "b"], seen: ["a", "b"] });
    const unpinned = withPinned(first, "a", false);
    expect(unpinned).toEqual({ pinned: ["b"], seen: ["a", "b"] });
    expect(withAutoPinned(unpinned, ["a", "b", "c"])).toEqual({
      pinned: ["b", "c"],
      seen: ["a", "b", "c"],
    });
  });

  test("returns the same value when nothing is new, so the caller can skip saving", () => {
    expect(withAutoPinned(ABC, ["c", "a"])).toBe(ABC);
  });
});

describe("pinnedTabsOf", () => {
  test("keeps the pinned order and drops plugins that have no screen now", () => {
    expect(pinnedTabsOf(ABC, ["c", "a"])).toEqual(["a", "c"]);
  });
});

describe("withPinned", () => {
  test("pins at the end once and marks the name seen; unpin keeps it seen", () => {
    const pinned = withPinned(EMPTY_TAB_PREFS, "x", true);
    expect(pinned).toEqual({ pinned: ["x"], seen: ["x"] });
    expect(withPinned(pinned, "x", true)).toEqual(pinned);
    expect(withPinned(pinned, "x", false)).toEqual({ pinned: [], seen: ["x"] });
  });
});

describe("withMoved", () => {
  test("moves one step left or right among shown tabs and stays at the ends", () => {
    const all = ["a", "b", "c"];
    expect(withMoved(ABC, all, "b", -1).pinned).toEqual(["b", "a", "c"]);
    expect(withMoved(ABC, all, "b", 1).pinned).toEqual(["a", "c", "b"]);
    expect(withMoved(ABC, all, "a", 1).pinned).toEqual(["b", "a", "c"]);
    expect(withMoved(ABC, all, "a", -1)).toBe(ABC);
    expect(withMoved(ABC, all, "c", 1)).toBe(ABC);
  });

  test("skips a pinned plugin that has no screen now and keeps it after the shown tabs", () => {
    expect(withMoved(ABC, ["a", "c"], "a", 1).pinned).toEqual(["c", "a", "b"]);
  });
});

describe("withDropped", () => {
  test("puts a tab before another one, or at the end for null; dropping in place changes nothing", () => {
    const all = ["a", "b", "c"];
    expect(withDropped(ABC, all, "c", "a").pinned).toEqual(["c", "a", "b"]);
    expect(withDropped(ABC, all, "a", null).pinned).toEqual(["b", "c", "a"]);
    expect(withDropped(ABC, all, "a", "b")).toBe(ABC);
    expect(withDropped(ABC, all, "x", "a")).toBe(ABC);
  });
});

describe("tab strip scrolling (DP-124)", () => {
  test("name tabs on a wide window, icon tabs on a compact one", () => {
    expect([tabModeOf(false), tabModeOf(true)]).toEqual(["label", "icon"]);
  });
  test("each end fades only while tabs hide past it", () => {
    expect(stripFadeOf(0, 500, 500)).toEqual({ start: false, end: false });
    expect(stripFadeOf(0, 900, 500)).toEqual({ start: false, end: true });
    expect(stripFadeOf(200, 900, 500)).toEqual({ start: true, end: true });
    expect(stripFadeOf(399.5, 900, 500)).toEqual({ start: true, end: false });
  });
  test("a vertical wheel scrolls sideways, a sideways swipe stays, and the ends stop it", () => {
    expect(wheelShiftOf(0, 40, 100, 900, 500)).toBe(40);
    expect(wheelShiftOf(-30, 5, 100, 900, 500)).toBe(-30);
    expect(wheelShiftOf(0, 120, 350, 900, 500)).toBe(50);
    expect(wheelShiftOf(0, -40, 0, 900, 500)).toBe(0);
    expect(wheelShiftOf(0, 40, 0, 500, 500)).toBe(0);
  });
  test("dragging near an end scrolls toward it", () => {
    expect([
      dragEdgeOf(105, 100, 600),
      dragEdgeOf(350, 100, 600),
      dragEdgeOf(590, 100, 600),
    ]).toEqual([-1, 0, 1]);
  });
});

describe("touchedOf", () => {
  test("brings the key to the front and drops the oldest past the cap", () => {
    expect(touchedOf(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    const full = Array.from({ length: KEPT_TABS_MAX }, (_, index) => `p${String(index)}`);
    const next = touchedOf(full, "new");
    expect([next.length, next[0], next.includes(`p${String(KEPT_TABS_MAX - 1)}`)]).toEqual([
      KEPT_TABS_MAX,
      "new",
      false,
    ]);
  });
});
