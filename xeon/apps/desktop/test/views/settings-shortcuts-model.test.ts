import { describe, expect, test } from "bun:test";
import type { KeyEventLike } from "../../src/views/shell/keybindings.ts";
import { DEFAULT_KEYMAP, resolveKeymap } from "../../src/views/shell/keybindings.ts";
import {
  conflictOf,
  overridesOf,
  recordStepOf,
  withDefault,
  withKey,
  withSwap,
} from "../../src/views/pages/settings/settings-shortcuts-model.ts";

// 설정 "단축키" 구역의 순수 모델(DP-89). 키 기록, 충돌 찾기, 기본과 다른 키만 남기기를 값으로 본다.

const NONE: KeyEventLike = {
  key: "",
  code: "",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};

function press(over: Partial<KeyEventLike>): KeyEventLike {
  return { ...NONE, ...over };
}

describe("recording a key", () => {
  test("Escape cancels and a lone modifier keeps waiting", () => {
    expect(recordStepOf(press({ key: "Escape" }), true)).toEqual({ kind: "cancel" });
    expect(recordStepOf(press({ key: "Meta", metaKey: true }), true)).toEqual({ kind: "waiting" });
    expect(recordStepOf(press({ key: "Shift", shiftKey: true }), false)).toEqual({
      kind: "waiting",
    });
  });

  test("a plain letter or Shift+letter is refused (it would type into the composer)", () => {
    expect(recordStepOf(press({ key: "k", code: "KeyK" }), true)).toEqual({
      kind: "needsModifier",
    });
    expect(recordStepOf(press({ key: "K", code: "KeyK", shiftKey: true }), true)).toEqual({
      kind: "needsModifier",
    });
  });

  test("on macOS Cmd is Mod and Ctrl is refused; elsewhere Ctrl is Mod and Meta is refused", () => {
    expect(recordStepOf(press({ key: "k", code: "KeyK", metaKey: true }), true)).toEqual({
      kind: "key",
      spec: "Mod+K",
    });
    expect(recordStepOf(press({ key: "k", code: "KeyK", ctrlKey: true }), true)).toEqual({
      kind: "needsModifier",
    });
    expect(recordStepOf(press({ key: "k", code: "KeyK", ctrlKey: true }), false)).toEqual({
      kind: "key",
      spec: "Mod+K",
    });
    expect(recordStepOf(press({ key: "k", code: "KeyK", metaKey: true }), false)).toEqual({
      kind: "needsModifier",
    });
  });

  test("Shift comes before Alt, and with Alt the key is the physical code", () => {
    expect(
      recordStepOf(
        press({ key: "¡", code: "Digit1", metaKey: true, shiftKey: true, altKey: true }),
        true,
      ),
    ).toEqual({ kind: "key", spec: "Mod+Shift+Alt+Digit1" });
    expect(recordStepOf(press({ key: "ArrowUp", code: "ArrowUp", metaKey: true }), true)).toEqual({
      kind: "key",
      spec: "Mod+ArrowUp",
    });
  });
});

describe("finding a conflict", () => {
  test("a key another action uses names that action", () => {
    expect(conflictOf(DEFAULT_KEYMAP, "thread.new", "Mod+K", true)).toBe("palette.open");
    expect(conflictOf(DEFAULT_KEYMAP, "thread.new", "Mod+Alt+Digit1", false)).toBe("area.chat");
  });

  test("the action's own key and an unused key are not conflicts", () => {
    expect(conflictOf(DEFAULT_KEYMAP, "palette.open", "Mod+K", true)).toBeNull();
    expect(conflictOf(DEFAULT_KEYMAP, "thread.new", "Mod+Shift+Y", true)).toBeNull();
  });
});

describe("saved overrides", () => {
  test("only keys that differ from the default stay", () => {
    expect(overridesOf(DEFAULT_KEYMAP)).toEqual({});
    expect(withKey(undefined, "thread.new", "Mod+Shift+N")).toEqual({
      "thread.new": "Mod+Shift+N",
    });
    expect(withKey({ "thread.new": "Mod+Shift+N" }, "thread.new", "Mod+N")).toEqual({});
  });

  test("reset to default drops that one key and keeps the others", () => {
    const saved = { "thread.new": "Mod+Shift+N", "panel.toggle": "Mod+Shift+J" };
    expect(withDefault(saved, "thread.new")).toEqual({ "panel.toggle": "Mod+Shift+J" });
  });

  test("swap gives the key to this action and puts the other back on its default", () => {
    const saved = { "panel.toggle": "Mod+Shift+Y" };
    const next = withSwap(saved, "thread.new", "Mod+Shift+Y", "panel.toggle");
    expect(next).toEqual({ "thread.new": "Mod+Shift+Y" });
    expect(resolveKeymap(next)["panel.toggle"]).toBe(DEFAULT_KEYMAP["panel.toggle"]);
  });
});
