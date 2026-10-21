import { describe, expect, test } from "bun:test";
import {
  WIRE_CLIENT_NOTIFICATIONS,
  WIRE_METHODS,
  WIRE_NOTIFICATIONS,
  classifyMethodName,
} from "../../src/wire-settings/wire/index.ts";

describe("classifyMethodName", () => {
  test("classifies core/control/extension", () => {
    expect(classifyMethodName("turn.start")).toBe("core");
    expect(classifyMethodName("secret.beginEntry")).toBe("core");
    expect(classifyMethodName("$/cancelRequest")).toBe("control");
    expect(classifyMethodName("ext.web-exa.search")).toBe("extension");
  });

  test("rejects bad names", () => {
    const bad = [
      "Turn.start",
      "turn",
      "turn.start.now",
      "turn_start",
      "$/",
      "$/Cancel",
      "ext.web-exa",
      "ext.Web.search",
      "ext._x.search",
      "",
      `a.${"b".repeat(95)}`,
      "turn.Start",
      "1turn.start",
    ];
    for (const name of bad)
      expect({ name, kind: classifyMethodName(name) }).toEqual({ name, kind: undefined });
  });

  test("a 96 character name is the longest allowed", () => {
    expect(classifyMethodName(`a.${"b".repeat(94)}`)).toBe("core");
    expect(classifyMethodName(`a.${"b".repeat(95)}`)).toBeUndefined();
  });

  test("registry names follow rule", () => {
    for (const name of Object.keys(WIRE_METHODS)) expect(classifyMethodName(name)).toBe("core");
    for (const name of Object.keys(WIRE_NOTIFICATIONS))
      expect(classifyMethodName(name)).toBe("core");
    for (const name of Object.keys(WIRE_CLIENT_NOTIFICATIONS)) {
      const kind = classifyMethodName(name);
      expect(kind === "core" || kind === "control").toBe(true);
    }
    expect(classifyMethodName("$/cancelRequest")).toBe("control");
    expect(classifyMethodName("events.batch")).toBe("core");
  });
});
