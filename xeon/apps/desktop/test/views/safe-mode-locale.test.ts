import { describe, expect, test } from "bun:test";
import { catalogOf, type Locale } from "@fresnel/client/i18n";

// U-06 문구 키가 ko와 en에 모두 있고, 인자(`{count}`)가 두 로케일에서 같은지 본다.
// 키 목록은 안전 모드 카드, 칩, 정보 글, 단추가 쓰는 것과 같다.

const PLACEHOLDERS: Readonly<Record<string, readonly string[]>> = {
  "desktop.safe.suggest.title": ["{count}"],
  "desktop.safe.suggest.body": [],
  "desktop.safe.suggest.info": [],
  "desktop.safe.suggest.remote": [],
  "desktop.safe.start": [],
  "desktop.safe.retry": [],
  "desktop.safe.chip": [],
  "desktop.safe.off": [],
  "desktop.safe.cause.user": [],
  "desktop.safe.cause.startupFailures": [],
  "desktop.safe.cause.flag": [],
  "desktop.safe.exit": [],
  "desktop.safe.exit.info": [],
  "desktop.safe.failures": [],
};

function placeholdersOf(message: string | undefined): readonly string[] | null {
  if (message === undefined) return null;
  return message.match(/\{\w+\}/g) ?? [];
}

describe("safe mode keys in both catalogs", () => {
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
