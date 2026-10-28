import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  JsonRpcErrorSchema,
  toJsonRpcError,
  wireError,
} from "../../src/wire-settings/wire/index.ts";
import {
  MESSAGE_KEY_PATTERN,
  MessageKeySchema,
  SettingUiSchema,
} from "../../src/wire-settings/settings/index.ts";

// M3-REQ-21. 라벨은 메시지 키로, wire 오류는 kind와 인자로 싣고 문장은 클라이언트가 만든다.
function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("message keys on SettingUi", () => {
  test("labelKey and helpKey round trip next to the fallback label", () => {
    const ui = {
      tab: "budgets",
      widget: "number",
      order: 1,
      label: "턴당 최대 단계",
      labelKey: "settings.l1.loop.maxSteps.label",
      help: "0이면 상한 없음",
      helpKey: "settings.l1.loop.maxSteps.help",
    };
    const result = parse(SettingUiSchema, roundTrip(ui));
    const actual: unknown = result.ok ? result.value : undefined;
    expect(actual).toEqual(ui);
    expect(parse(SettingUiSchema, { ...ui, labelKey: "has space" }).ok).toBe(false);
    expect(parse(SettingUiSchema, { ...ui, helpKey: "9starts" }).ok).toBe(false);
  });

  test("the key pattern accepts dotted camel-case ids only", () => {
    const re = new RegExp(MESSAGE_KEY_PATTERN);
    for (const ok of ["a", "settings.l1.maxSteps", "wire.settings.fileConflict"]) {
      expect(re.test(ok)).toBe(true);
      expect(parse(MessageKeySchema, ok).ok).toBe(true);
    }
    for (const bad of ["", "A.b", "a..b", "a.b.", "a-b", ".a"]) {
      expect(re.test(bad)).toBe(false);
    }
  });
});

describe("wire errors carry kind and args", () => {
  test("args travel in the error data and the sentence is not part of the contract", () => {
    const error = wireError("settings.invalidValue", {
      details: { key: "l1.loop.maxSteps", issues: [] },
      args: { key: "l1.loop.maxSteps", max: 100, strict: true, hint: null },
    });
    expect(error.data.kind).toBe("settings.invalidValue");
    expect(error.data.args).toEqual({
      key: "l1.loop.maxSteps",
      max: 100,
      strict: true,
      hint: null,
    });
    const wire = toJsonRpcError(error);
    const parsed = parse(JsonRpcErrorSchema, roundTrip(wire));
    const actual: unknown = parsed.ok ? parsed.value : undefined;
    expect(actual).toEqual(wire);
    expect(
      parse(JsonRpcErrorSchema, { ...wire, data: { ...wire.data, args: { nested: { a: 1 } } } }).ok,
    ).toBe(false);
    expect(wireError("thread.closed").data.args).toBeUndefined();
  });
});
