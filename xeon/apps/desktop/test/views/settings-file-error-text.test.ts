import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import { errorText } from "../../src/views/settings.tsx";
import {
  FILE_NOT_OBJECT_DETAIL,
  fileErrorTextOf,
} from "../../src/views/pages/settings/settings-file-model.ts";

// 설정 파일 저장 실패 문장(`fileErrorTextOf`). host의 영어 문장("the settings file must be a JSON object")은 보이지 않고,
// 초안이 JSON 문법 오류면 그 줄과 칸을, 올바른 JSON인데 객체가 아니면 객체여야 한다는 문장만 쓴다.
// 다른 오류는 `errorText`와 같다.

let before: Locale;
beforeEach(() => {
  before = activeLocale();
  setActiveLocale("ko");
});
afterEach(() => {
  setActiveLocale(before);
});

const NOT_OBJECT = { kind: "rejected" as const, code: 3108, detail: FILE_NOT_OBJECT_DETAIL };

describe("save errors of the settings file editor", () => {
  test("a draft with a JSON syntax error names the line and the column", () => {
    expect(fileErrorTextOf(NOT_OBJECT, '{\n  "a": 1,\n}')).toBe(
      "JSON 문법 오류(3줄 1칸): 닫는 괄호나 쉼표를 확인해 주세요",
    );
  });

  test("a draft that is valid JSON but not an object says only that it must be an object", () => {
    expect(fileErrorTextOf(NOT_OBJECT, "[1, 2]")).toBe("설정 파일은 JSON 객체여야 해요");
  });

  test("the English locale shows the same two cases in English, without the host sentence", () => {
    setActiveLocale("en");
    expect(fileErrorTextOf(NOT_OBJECT, '{\n  "a": 1,\n}')).toBe(
      "JSON syntax error (line 3, column 1): check for a missing bracket or comma",
    );
    expect(fileErrorTextOf(NOT_OBJECT, "[1, 2]")).toBe("The settings file must be a JSON object");
  });

  test("another rejection keeps the host sentence as before", () => {
    const unknownModel = {
      kind: "rejected" as const,
      code: 3102,
      detail: "알 수 없는 모델 anthropic/claude-sonnet-5.5",
    };
    expect(fileErrorTextOf(unknownModel, "{}")).toBe(errorText(unknownModel));
    expect(fileErrorTextOf({ kind: "offline" }, "{}")).toBe(errorText({ kind: "offline" }));
  });
});
