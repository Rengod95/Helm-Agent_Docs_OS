import { describe, expect, test } from "bun:test";
import { t } from "../../src/i18n/index.ts";
import { invalidMessage } from "../../src/settings/index.ts";
import { wireDef } from "./fixtures.ts";

// 클라이언트 검사 실패 문장은 정의의 범위와 길이 제한에서 만든다(scA-3)

describe("invalidMessage", () => {
  test("a closed range names both ends", () => {
    const def = wireDef({
      key: "l1.loop.maxSteps",
      type: { type: "integer" },
      range: { min: 1, max: 64 },
    });
    expect(invalidMessage(def)).toBe(t("client.settings.field.invalidRange", { min: 1, max: 64 }));
    expect(invalidMessage(def)).toContain("1에서 64");
  });

  test("a one-sided range names the bound", () => {
    const low = wireDef({ key: "l1.a.b", type: { type: "integer" }, range: { min: 0 } });
    const high = wireDef({ key: "l1.a.c", type: { type: "integer" }, range: { max: 9 } });
    expect(invalidMessage(low)).toBe(t("client.settings.field.invalidMin", { min: 0 }));
    expect(invalidMessage(high)).toBe(t("client.settings.field.invalidMax", { max: 9 }));
  });

  test("a string length limit names the characters", () => {
    const def = wireDef({ key: "l1.a.d", type: { type: "string", minLength: 2, maxLength: 5 } });
    expect(invalidMessage(def)).toBe(t("client.settings.field.invalidLength", { min: 2, max: 5 }));
  });
});
