// ADR-0021 §3.8. 확장 화면의 문구는 메시지 키(`<확장이름>.<키>`) 또는 문자열이다. 키는 확장 패키지의 카탈로그에서 현재 로케일, 영어
// 순으로 찾고, 없으면 글자 그대로(키 자체)다. 클라이언트 카탈로그(`@fresnel/client` locales)와 별개이고, 확장 화면 안에서만 쓴다.

/** 로케일 -> 키 -> 문장. `ext.ui.list` 항목의 `messages`와 같은 모양이다 */
export type ExtMessages = Readonly<Record<string, Readonly<Record<string, string>>>>;

function lookup(messages: ExtMessages, locale: string, key: string): string | undefined {
  const table = Object.hasOwn(messages, locale) ? messages[locale] : undefined;
  return table !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}

/** 확장 화면의 문구 하나. 카탈로그에 있으면 그 문장이고, 없으면 `text` 그대로다(문자열이거나 못 찾은 키) */
export function extMessageOf(
  messages: ExtMessages | undefined,
  locale: string,
  text: string,
): string {
  if (messages === undefined) return text;
  const language = locale.split("-")[0] ?? locale;
  return lookup(messages, language, text) ?? lookup(messages, "en", text) ?? text;
}
