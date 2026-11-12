// 붙여 넣은 키 값을 정리하는 순수 함수(L4.desktop.spec §4.14.1, L4.cli.spec §4.7 [결정: 2026-11-11 사용자]).
// API 키 입력(키 넣기 대화 상자, 셸 `secret_register`의 `<이름>`이 `-api-key`로 끝나는 값, CLI `secret add|set <이름>`의 `-api-key` 값)에만 쓴다.
// 일반 시크릿 값은 이 함수를 쓰지 않는다: 화면은 사람에게 묻고, CLI는 줄바꿈 하나만 지운다.

/** API 키 시크릿 이름의 꼬리. 제공자 키 `<provider>-api-key`와 웹 플러그인 키(`exa-api-key`)가 같다 */
const API_KEY_SUFFIX = "-api-key";

/** 앞뒤에서 지우는 글자: 공백(탭, CR, LF, NBSP, U+FEFF 포함), 너비 없는 글자 U+200B~U+200D, U+2060 */
const EDGE_PATTERN = /^[\s\u200B-\u200D\u2060\uFEFF]+|[\s\u200B-\u200D\u2060\uFEFF]+$/gu;

/** 한 쌍으로 둘러싼 따옴표. 한 쌍만 지운다 */
const QUOTES: ReadonlySet<string> = new Set(['"', "'", "`"]);

export interface NormalizedKey {
  /** 정리한 값. 안쪽은 건드리지 않는다 */
  readonly value: string;
  /** 무엇이든 지웠으면 true */
  readonly trimmed: boolean;
}

/**
 * 붙여 넣은 키 값을 정리한다. 앞뒤의 공백과 너비 없는 글자를 지우고, 그다음 한 쌍으로 둘러싼 따옴표(`"`, `'`, `` ` ``)
 * 하나를 지운 뒤 안쪽 앞뒤를 한 번 더 지운다. 안쪽 글은 바꾸지 않는다. 값 글은 로그에 쓰지 않는다.
 */
export function normalizePastedKey(raw: string): NormalizedKey {
  let text = raw.replace(EDGE_PATTERN, "");
  const first = text.charAt(0);
  if (text.length >= 2 && QUOTES.has(first) && text.charAt(text.length - 1) === first) {
    text = text.slice(1, -1).replace(EDGE_PATTERN, "");
  }
  return { value: text, trimmed: text !== raw };
}

/** 시크릿 이름이 API 키인가(이름이 `-api-key`로 끝난다). 값 정리 규칙을 고를 때 쓴다 */
export function isApiKeySecretName(name: string): boolean {
  return name.endsWith(API_KEY_SUFFIX);
}
