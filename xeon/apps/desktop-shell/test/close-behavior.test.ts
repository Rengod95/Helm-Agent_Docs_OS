import { describe, expect, test } from "bun:test";
import {
  effectiveCloseBehavior,
  parseCloseBehavior,
  setConfiguredCloseBehavior,
  setTrayActive,
  shouldQuitWhenWindowsClosed,
} from "../src/main/close-behavior.ts";

describe("effective close behavior", () => {
  test("tray without an active tray acts as quit", () => {
    expect(effectiveCloseBehavior("tray", false)).toBe("quit");
  });

  test("tray with an active tray stays tray", () => {
    expect(effectiveCloseBehavior("tray", true)).toBe("tray");
  });

  test("quit stays quit whether or not a tray is active", () => {
    expect(effectiveCloseBehavior("quit", false)).toBe("quit");
    expect(effectiveCloseBehavior("quit", true)).toBe("quit");
  });
});

describe("parse close behavior", () => {
  test("only the two stored values are accepted", () => {
    expect(parseCloseBehavior("tray")).toBe("tray");
    expect(parseCloseBehavior("quit")).toBe("quit");
    expect(
      ["Tray", "", "exit", null, undefined, 1, {}].map((value) => parseCloseBehavior(value)),
    ).toEqual([null, null, null, null, null, null, null]);
  });
});

describe("window close decision", () => {
  test("follows the configured value and whether a tray is active", () => {
    setConfiguredCloseBehavior("tray");
    setTrayActive(true);
    expect(shouldQuitWhenWindowsClosed()).toBe(false);
    setTrayActive(false);
    expect(shouldQuitWhenWindowsClosed()).toBe(true);

    setConfiguredCloseBehavior("quit");
    setTrayActive(true);
    expect(shouldQuitWhenWindowsClosed()).toBe(true);
  });
});
