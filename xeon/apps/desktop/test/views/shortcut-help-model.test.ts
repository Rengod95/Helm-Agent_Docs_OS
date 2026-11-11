import { describe, expect, test } from "bun:test";
import { ACTION_IDS, DEFAULT_KEYMAP, resolveKeymap } from "../../src/views/shell/keybindings.ts";
import {
  ACTION_LABEL_IDS,
  filterShortcutRows,
  fixedShortcutRowsOf,
  keyPartsOf,
  SHORTCUT_COLUMNS,
  shortcutRowsOf,
} from "../../src/views/shortcut-help-model.ts";

// 바로 가기 키 도움말(O-09)의 표 모델. 행은 `ACTION_IDS` 순서이고 키는 `formatKey`로 쓴다. 값은 `toEqual`로 비교한다.

describe("shortcutRowsOf", () => {
  test("the default table has one row per action, in the shell's order, with the macOS glyphs", () => {
    const rows = shortcutRowsOf(DEFAULT_KEYMAP, true);
    expect(rows.map((row) => row.id)).toEqual([...ACTION_IDS]);
    expect(rows.slice(0, 3)).toEqual([
      {
        id: "palette.open",
        label: "desktop.shortcuts.action.paletteOpen",
        group: "anywhere",
        keys: "⌘K",
        parts: ["⌘", "K"],
      },
      {
        id: "thread.new",
        label: "desktop.shortcuts.action.threadNew",
        group: "anywhere",
        keys: "⌘N",
        parts: ["⌘", "N"],
      },
      {
        id: "nav.1",
        label: "desktop.shortcuts.action.nav1",
        group: "navigate",
        keys: "⌘1",
        parts: ["⌘", "1"],
      },
    ]);
    expect(rows.find((row) => row.id === "panel.inbox")?.keys).toBe("⇧⌘I");
    expect(rows.find((row) => row.id === "thread.next")?.keys).toBe("⌥⌘↓");
    expect(rows.find((row) => row.id === "area.chat")?.keys).toBe("⌥⌘1");
    expect(rows.find((row) => row.id === "nav.3")).toEqual({
      id: "nav.3",
      label: "desktop.shortcuts.action.nav3",
      group: "navigate",
      keys: "⌘3",
      parts: ["⌘", "3"],
    });
    expect(rows.filter((row) => row.id.startsWith("nav.")).map((row) => row.id)).toEqual([
      "nav.1",
      "nav.2",
      "nav.3",
    ]);
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

const text = (id: string): string => id;

describe("groups, key chips and search", () => {
  test("rows carry their group and the key split into chips", () => {
    const mac = shortcutRowsOf(DEFAULT_KEYMAP, true);
    expect(mac.find((row) => row.id === "panel.inbox")).toEqual({
      id: "panel.inbox",
      label: "desktop.shortcuts.action.panelInbox",
      group: "panel",
      keys: "⇧⌘I",
      parts: ["⇧", "⌘", "I"],
    });
    const other = shortcutRowsOf(DEFAULT_KEYMAP, false);
    expect(other.find((row) => row.id === "panel.inbox")?.parts).toEqual(["Ctrl", "Shift", "I"]);
  });

  test("a trailing plus is a key, not a separator", () => {
    expect(keyPartsOf("Ctrl++", false)).toEqual(["Ctrl", "+"]);
  });

  test("every group in the columns holds at least one default action", () => {
    const rows = [...shortcutRowsOf(DEFAULT_KEYMAP, true), ...fixedShortcutRowsOf(true)];
    for (const group of SHORTCUT_COLUMNS.flat()) {
      expect(rows.some((row) => row.group === group)).toBe(true);
    }
  });

  test("search matches the action label, group label, id or keys and an empty query keeps all", () => {
    const rows = shortcutRowsOf(DEFAULT_KEYMAP, true);
    expect(filterShortcutRows(rows, "  ", text)).toEqual(rows);
    expect(filterShortcutRows(rows, "panelinbox", text).map((row) => row.id)).toEqual([
      "panel.inbox",
    ]);
    expect(filterShortcutRows(rows, "group.area", text).map((row) => row.id)).toEqual([
      "area.toggle",
      "area.chat",
      "area.workbench",
    ]);
    expect(filterShortcutRows(rows, "thread.NEXT", text).map((row) => row.id)).toEqual([
      "thread.next",
    ]);
    expect(filterShortcutRows(rows, "⇧⌘i", text).map((row) => row.id)).toEqual(["panel.inbox"]);
    expect(filterShortcutRows(rows, "no-such", text)).toEqual([]);
  });
});

describe("fixed keys", () => {
  test("composer and approval rows are listed with their real keys", () => {
    expect(fixedShortcutRowsOf(true)).toEqual([
      {
        id: "composer.send",
        label: "desktop.shortcuts.action.composerSend",
        group: "composer",
        keys: "↩",
        parts: ["↩"],
      },
      {
        id: "composer.newline",
        label: "desktop.shortcuts.action.composerNewline",
        group: "composer",
        keys: "⇧↩",
        parts: ["⇧", "↩"],
      },
      {
        id: "composer.steer",
        label: "desktop.shortcuts.action.composerSteer",
        group: "composer",
        keys: "⌘↩",
        parts: ["⌘", "↩"],
      },
      {
        id: "approval.allow",
        label: "desktop.shortcuts.action.approvalAllow",
        group: "approval",
        keys: "Y",
        parts: ["Y"],
      },
      {
        id: "approval.deny",
        label: "desktop.shortcuts.action.approvalDeny",
        group: "approval",
        keys: "N",
        parts: ["N"],
      },
    ]);
    expect(fixedShortcutRowsOf(false)[2]).toEqual({
      id: "composer.steer",
      label: "desktop.shortcuts.action.composerSteer",
      group: "composer",
      keys: "Ctrl+Enter",
      parts: ["Ctrl", "Enter"],
    });
    expect(fixedShortcutRowsOf(false)[1]).toEqual({
      id: "composer.newline",
      label: "desktop.shortcuts.action.composerNewline",
      group: "composer",
      keys: "Shift+Enter",
      parts: ["Shift", "Enter"],
    });
  });
});
