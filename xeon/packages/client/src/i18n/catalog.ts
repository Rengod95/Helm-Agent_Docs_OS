import en from "./locales/en.json";
import ko from "./locales/ko.json";

// ADR-0016 §3.2. 로케일마다 JSON 하나. 메시지 id의 정본은 en이고, `MessageId`가 en.json의 키 집합이라
// 코드가 없는 id를 쓰면 타입 검사가 실패한다(생성 상수 대신 JSON 키 타입을 쓴다 [결정: 오케스트레이터 기본값]).
// ko와 en의 id·인자 이름 대조는 test/i18n/catalog.test.ts가 한다.

export type Locale = "ko" | "en";
export const LOCALES: readonly Locale[] = ["ko", "en"];
export type MessageId = keyof typeof en;
export type MessageCatalog = Readonly<Record<string, string>>;

const CATALOGS: Readonly<Record<Locale, MessageCatalog>> = { ko, en };

export function catalogOf(locale: Locale): MessageCatalog {
  return CATALOGS[locale];
}

/** 선택한 로케일에서 찾고 없으면 en 문장으로 폴백한다(ADR-0016 §3.3 3). 둘 다 없으면 undefined */
export function lookupMessage(locale: Locale, id: string): string | undefined {
  return CATALOGS[locale][id] ?? CATALOGS.en[id];
}

export function isLocale(value: string): value is Locale {
  return value === "ko" || value === "en";
}
