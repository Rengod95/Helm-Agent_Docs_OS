import { describe, expect, test } from "bun:test";
import { catalogOf, type Locale } from "@fresnel/client/i18n";

// U-02 문구 키가 ko와 en에 모두 있고, 인자(`{count}`, `{name}`)가 두 로케일에서 같은지 본다.
// 키 목록은 화면이 쓰는 것과 같다(상태 표시줄, 확인 대화 상자, 설치 결과, 토스트).

const PLACEHOLDERS: Readonly<Record<string, readonly string[]>> = {
  "desktop.restart.needed.title": [],
  "desktop.restart.needed.count": ["{count}"],
  "desktop.restart.now": [],
  "desktop.restart.later": [],
  "desktop.restart.info": [],
  "desktop.restart.confirm.title": [],
  "desktop.restart.confirm.turns": ["{count}"],
  "desktop.restart.confirm.approvals": ["{count}"],
  "desktop.restart.done": [],
  "desktop.restart.failed": [],
  "desktop.restart.reason.install": ["{name}"],
  "desktop.restart.reason.rollback": ["{name}"],
  "desktop.restart.web": [],
};

function placeholdersOf(message: string | undefined): readonly string[] | null {
  if (message === undefined) return null;
  return message.match(/\{\w+\}/g) ?? [];
}

describe("restart keys in both catalogs", () => {
  for (const [key, expected] of Object.entries(PLACEHOLDERS)) {
    test(`${key} exists in ko and en with the same placeholders`, () => {
      const locales: readonly Locale[] = ["ko", "en"];
      for (const locale of locales) {
        const message = catalogOf(locale)[key];
        expect(message ?? "").not.toBe("");
        expect(placeholdersOf(message)).toEqual([...expected]);
      }
    });
  }
});
