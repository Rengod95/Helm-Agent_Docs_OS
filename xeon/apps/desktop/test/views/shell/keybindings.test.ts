import { describe, expect, test } from "bun:test";
import {
  ACTION_IDS,
  DEFAULT_KEYMAP,
  actionFor,
  formatKey,
  keyConflicts,
  resolveKeymap,
  type KeyEventLike,
} from "../../../src/views/shell/keybindings.ts";

const actionIds: readonly string[] = ACTION_IDS;

const ev = (init: Partial<KeyEventLike>): KeyEventLike => ({
  key: "",
  code: "",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...init,
});

describe("keybindings.default-map-covers-actions", () => {
  test("every action of spec 4.8 has a default key and no two actions share one", () => {
    expect(actionIds.toSorted()).toEqual(Object.keys(DEFAULT_KEYMAP).toSorted());
    expect(keyConflicts(DEFAULT_KEYMAP)).toEqual([]);
  });

  test("macOS and other platforms resolve the same actions from their own modifier", () => {
    expect(actionFor(DEFAULT_KEYMAP, ev({ key: "k", metaKey: true }), true)).toBe("palette.open");
    expect(actionFor(DEFAULT_KEYMAP, ev({ key: "k", ctrlKey: true }), true)).toBeNull();
    expect(actionFor(DEFAULT_KEYMAP, ev({ key: "k", ctrlKey: true }), false)).toBe("palette.open");
    expect(actionFor(DEFAULT_KEYMAP, ev({ key: "I", metaKey: true, shiftKey: true }), true)).toBe(
      "panel.inbox",
    );
    expect(actionFor(DEFAULT_KEYMAP, ev({ key: "3", metaKey: true }), true)).toBe("nav.3");
    // 연결과 대화 내비가 빠지며 번호는 셋으로 줄었다. 옛 ⌘4~⌘6은 어느 동작도 아니다
    expect(actionFor(DEFAULT_KEYMAP, ev({ key: "6", metaKey: true }), true)).toBeNull();
    expect(actionFor(DEFAULT_KEYMAP, ev({ key: "6", ctrlKey: true }), false)).toBeNull();
  });

  test("alt chords match the physical key, whatever character alt produces", () => {
    const alt1 = ev({ key: "¡", code: "Digit1", metaKey: true, altKey: true });
    expect(actionFor(DEFAULT_KEYMAP, alt1, true)).toBe("area.chat");
    expect(
      actionFor(
        DEFAULT_KEYMAP,
        ev({ key: "ArrowDown", code: "ArrowDown", metaKey: true, altKey: true }),
        true,
      ),
    ).toBe("thread.next");
  });

  test("an extra modifier is a different key", () => {
    expect(
      actionFor(DEFAULT_KEYMAP, ev({ key: "k", metaKey: true, shiftKey: true }), true),
    ).toBeNull();
  });

  test("user overrides replace the default; unknown ids and unreadable keys are dropped", () => {
    const map = resolveKeymap({
      "palette.open": "Mod+P",
      "thread.new": "Hyper+N",
      "no.such": "Mod+X",
    });
    expect(map["palette.open"]).toBe("Mod+P");
    expect(map["thread.new"]).toBe("Mod+N");
    expect(Object.keys(map).toSorted()).toEqual(actionIds.toSorted());
    expect(keyConflicts(resolveKeymap({ "thread.new": "Mod+K" }))).toEqual([
      ["palette.open", "thread.new"],
    ]);
  });

  test("keys are shown with the platform's glyphs", () => {
    expect(formatKey("Mod+Shift+I", true)).toBe("⇧⌘I");
    expect(formatKey("Mod+Alt+Digit1", true)).toBe("⌥⌘1");
    expect(formatKey("Mod+Alt+ArrowDown", true)).toBe("⌥⌘↓");
    expect(formatKey("Mod+Shift+I", false)).toBe("Ctrl+Shift+I");
  });
});
