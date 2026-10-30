import { lookupMessage, type Locale, type MessageId } from "./catalog.ts";
import { createIntlFormat, type MessageArgs, type MessageFormatPort } from "./format.ts";

// ADR-0016 §3.1~3.3. 로케일 하나에 묶인 번역기와, CLI처럼 React 밖 코드가 쓰는 프로세스 단위 현재 번역기.

export interface Translator {
  readonly locale: Locale;
  /** 코드가 아는 id. 없는 id는 타입 검사가 막는다 */
  t(id: MessageId, args?: MessageArgs): string;
  /** 호스트가 보낸 키(`labelKey`, 오류 `kind`)처럼 런타임에 정해지는 id. 카탈로그에 없으면 `fallback`을 쓴다 */
  tKey(id: string, fallback: string, args?: MessageArgs): string;
  has(id: string): boolean;
}

export function createTranslator(
  locale: Locale,
  port: MessageFormatPort = createIntlFormat(),
): Translator {
  const translate = (id: string, fallback: string, args: MessageArgs = {}): string => {
    const message = lookupMessage(locale, id);
    return message === undefined ? fallback : port.format(locale, message, args);
  };
  return {
    locale,
    t: (id, args) => translate(id, id, args),
    tKey: translate,
    has: (id) => lookupMessage(locale, id) !== undefined,
  };
}

let active: Translator = createTranslator("en");

/** 현재 로케일을 바꾼다. 프로세스 시작 때 한 번 부른다 */
export function setActiveLocale(locale: Locale): void {
  if (active.locale !== locale) active = createTranslator(locale);
}

export function activeLocale(): Locale {
  return active.locale;
}

/** 현재 로케일의 문장. 호스트가 문장을 만들지 않으므로 사용자 문장은 모두 여기서 나온다 */
export function t(id: MessageId, args?: MessageArgs): string {
  return active.t(id, args);
}

export function tKey(id: string, fallback: string, args?: MessageArgs): string {
  return active.tKey(id, fallback, args);
}
