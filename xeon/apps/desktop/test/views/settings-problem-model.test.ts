import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeLocale, setActiveLocale, type Locale } from "@fresnel/client/i18n";
import type { SettingsFileProblem } from "@fresnel/contracts/wire";
import {
  firstSettingsProblemOf,
  settingsProblemTextOf,
} from "../../src/views/settings-problem-model.ts";

// 읽지 못한 설정 파일의 문구 조각(`settings-problem-model.ts`). 위치가 있으면 줄과 칸을, 없으면 이유를 쓰고,
// 경로는 홈을 `~`로 줄인다. 문구는 활성 로케일을 따르므로 시험마다 ko로 맞추고 끝나면 되돌린다.

const BASE: SettingsFileProblem = {
  scope: "user",
  path: "/home/me/.fresnel/settings.json",
  reason: "invalid_json",
  line: 3,
  column: 5,
};

let before: Locale;
beforeEach(() => {
  before = activeLocale();
  setActiveLocale("ko");
});
afterEach(() => {
  setActiveLocale(before);
});

describe("the first problem to show", () => {
  test("no problem gives null and a list gives its first entry", () => {
    expect(firstSettingsProblemOf([])).toBeNull();
    expect(firstSettingsProblemOf([BASE, { ...BASE, line: 9 }])).toEqual(BASE);
  });
});

describe("the location text of a problem", () => {
  test("a JSON syntax error with a line and a column shows the position and the shortened path", () => {
    expect(settingsProblemTextOf(BASE)).toEqual({
      path: "~/.fresnel/settings.json",
      where: "3줄 5칸",
    });
  });

  test("a problem without a position shows the reason instead", () => {
    expect(
      settingsProblemTextOf({ ...BASE, reason: "invalid_json", line: null, column: null }).where,
    ).toBe("JSON 문법 오류");
    expect(
      settingsProblemTextOf({ ...BASE, reason: "not_object", line: null, column: null }).where,
    ).toBe("JSON 객체가 아님");
  });

  test("a read failure shows its OS code, and an unknown code reads as unknown", () => {
    const unreadable = { ...BASE, reason: "unreadable" as const, line: null, column: null };
    expect(settingsProblemTextOf({ ...unreadable, code: "EACCES" }).where).toBe(
      "읽기 실패: EACCES",
    );
    expect(settingsProblemTextOf(unreadable).where).toBe("읽기 실패: 알 수 없음");
  });

  test("a path outside the home folder stays as it is", () => {
    expect(settingsProblemTextOf({ ...BASE, path: "/etc/fresnel/settings.json" }).path).toBe(
      "/etc/fresnel/settings.json",
    );
  });

  test("the English locale words the position and the reason in English", () => {
    setActiveLocale("en");
    expect(settingsProblemTextOf(BASE).where).toBe("line 3, column 5");
    expect(
      settingsProblemTextOf({ ...BASE, reason: "not_object", line: null, column: null }).where,
    ).toBe("not a JSON object");
  });
});
