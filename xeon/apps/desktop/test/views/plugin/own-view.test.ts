import { describe, expect, test } from "bun:test";
import {
  onExtensionChanged,
  ownScreenKeyOf,
  screenOpenerOf,
} from "../../../src/views/plugin/own-view.ts";
import { uiEntryOf } from "../../plugin-ui/support.ts";

// 열기 링크(`navigate { view }`, `ViewLink`)가 여는 화면의 거름과, 확장 바뀜 알림이 닿는 화면의 거름을 값으로 본다.

const BOARD = uiEntryOf({ extension: "kanban", id: "board", placement: "page", title: "보드" });
const CHIP = uiEntryOf({ extension: "kanban", id: "chip", placement: "status", title: "칩" });
const NOTES_BOARD = uiEntryOf({
  extension: "notes",
  id: "board",
  placement: "page",
  title: "메모",
});
const ENTRIES = [BOARD, CHIP, NOTES_BOARD];

describe("a view link names a screen of its own extension that the playground lists", () => {
  test("the extension's own page screen gets its key", () => {
    expect(ownScreenKeyOf(ENTRIES, "kanban", "board")).toBe("kanban/board");
  });

  test("another extension's screen, an unknown id, and a status cell are refused", () => {
    expect(ownScreenKeyOf([NOTES_BOARD], "kanban", "board")).toBeUndefined();
    expect(ownScreenKeyOf(ENTRIES, "kanban", "nope")).toBeUndefined();
    expect(ownScreenKeyOf(ENTRIES, "kanban", "chip")).toBeUndefined();
  });

  test("the opener opens through the open function and answers false for the rest", () => {
    const opened: (readonly [string, string])[] = [];
    const open = screenOpenerOf({
      entries: () => ENTRIES,
      extension: "kanban",
      open: (name, screenKey) => {
        opened.push([name, screenKey]);
      },
    });
    expect(open("board")).toBe(true);
    expect(open("nope")).toBe(false);
    expect(open("chip")).toBe(false);
    expect(opened).toEqual([["kanban", "kanban/board"]]);
  });
});

describe("an extension change reaches only the screens of that extension", () => {
  test("its own change calls the listener, another extension's does not, and unsubscribe ends it", () => {
    const listeners: ((extension: string | null) => void)[] = [];
    let unsubscribed = 0;
    const subscribe = (listener: (extension: string | null) => void) => {
      listeners.push(listener);
      return () => {
        unsubscribed += 1;
      };
    };
    let calls = 0;
    const off = onExtensionChanged(subscribe, "kanban", () => {
      calls += 1;
    });
    listeners[0]?.("notes");
    expect(calls).toBe(0);
    listeners[0]?.("kanban");
    listeners[0]?.("kanban");
    expect(calls).toBe(2);
    off();
    expect(unsubscribed).toBe(1);
  });

  test("a null signal (re-read after a reconnect) reaches the screen, and it counts once per signal", () => {
    const listeners: ((extension: string | null) => void)[] = [];
    const subscribe = (listener: (extension: string | null) => void) => {
      listeners.push(listener);
      return () => {};
    };
    const seen: number[] = [];
    onExtensionChanged(subscribe, "kanban", () => {
      seen.push(1);
    });
    listeners[0]?.(null);
    expect(seen).toEqual([1]);
    listeners[0]?.("notes");
    expect(seen).toEqual([1]);
  });
});
