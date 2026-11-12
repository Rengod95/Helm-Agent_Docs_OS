import { describe, expect, test } from "bun:test";
import {
  EMPTY_TAB_PREFS,
  ICON_TAB,
  KEPT_TABS_MAX,
  LABEL_TAB_MAX,
  pinnedTabsOf,
  tabStripLayoutOf,
  touchedOf,
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

describe("tabStripLayoutOf", () => {
  test("labels when every label tab fits, icons when only icons fit, then folds the rest into more", () => {
    expect(tabStripLayoutOf(3, 3 * LABEL_TAB_MAX, false)).toEqual({ mode: "label", visible: 3 });
    expect(tabStripLayoutOf(3, 3 * LABEL_TAB_MAX, true)).toEqual({ mode: "icon", visible: 3 });
    expect(tabStripLayoutOf(3, 3 * LABEL_TAB_MAX - 1, false)).toEqual({ mode: "icon", visible: 3 });
    expect(tabStripLayoutOf(10, 48 + 4 * ICON_TAB, false)).toEqual({ mode: "icon", visible: 4 });
    expect(tabStripLayoutOf(3, 10, false)).toEqual({ mode: "icon", visible: 0 });
    expect(tabStripLayoutOf(0, 1000, false)).toEqual({ mode: "icon", visible: 0 });
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
