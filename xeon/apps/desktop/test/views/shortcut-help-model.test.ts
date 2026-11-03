import { describe, expect, test } from "bun:test";
import { ACTION_IDS, DEFAULT_KEYMAP, resolveKeymap } from "../../src/views/shell/keybindings.ts";
import { ACTION_LABEL_IDS, shortcutRowsOf } from "../../src/views/shortcut-help-model.ts";

// 바로 가기 키 도움말(O-09)의 표 모델. 행은 `ACTION_IDS` 순서이고 키는 `formatKey`로 쓴다. 값은 `toEqual`로 비교한다.

describe("shortcutRowsOf", () => {
  test("the default table has one row per action, in the shell's order, with the macOS glyphs", () => {
    const rows = shortcutRowsOf(DEFAULT_KEYMAP, true);
    expect(rows.map((row) => row.id)).toEqual([...ACTION_IDS]);
    expect(rows.slice(0, 3)).toEqual([
      { id: "palette.open", label: "desktop.shortcuts.action.paletteOpen", keys: "⌘K" },
      { id: "thread.new", label: "desktop.shortcuts.action.threadNew", keys: "⌘N" },
      { id: "nav.1", label: "desktop.shortcuts.action.nav1", keys: "⌘1" },
    ]);
    expect(rows.find((row) => row.id === "panel.inbox")?.keys).toBe("⇧⌘I");
    expect(rows.find((row) => row.id === "thread.next")?.keys).toBe("⌥⌘↓");
    expect(rows.find((row) => row.id === "area.chat")?.keys).toBe("⌥⌘1");
  });

  test("off macOS the same keys read with Ctrl and Shift", () => {
    const rows = shortcutRowsOf(DEFAULT_KEYMAP, false);
    expect(rows.find((row) => row.id === "palette.open")?.keys).toBe("Ctrl+K");
    expect(rows.find((row) => row.id === "panel.inbox")?.keys).toBe("Ctrl+Shift+I");
  });

  test("a key the person changed shows the new key, and an unknown action id is ignored", () => {
    const keymap = resolveKeymap({ "palette.open": "Mod+Shift+P", "no.such.action": "Mod+Z" });
    const rows = shortcutRowsOf(keymap, true);
    expect(rows.find((row) => row.id === "palette.open")?.keys).toBe("⇧⌘P");
    expect(rows.length).toBe(ACTION_IDS.length);
  });

  test("every action has a label id", () => {
    expect(Object.keys(ACTION_LABEL_IDS).toSorted()).toEqual([...ACTION_IDS].toSorted());
  });
});
