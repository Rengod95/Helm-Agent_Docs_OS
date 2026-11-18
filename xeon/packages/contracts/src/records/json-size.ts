// F.records.spec §3.4.1 큰 값의 크기 세기. 값을 직렬화한 글을 만들지 않고 UTF-8 바이트 수를 센다.
// 100 MiB 문자열을 `JSON.stringify`로 글로 만들고 다시 인코딩하면 입력의 여러 배 메모리를 쓴다. 이 함수는 값을 한 번 훑어 센다.
// 결과는 `new TextEncoder().encode(JSON.stringify(value)).length`와 같다.

/** 출력 가능한 ASCII 가운데 JSON이 이스케이프하는 `"`와 `\`를 뺀 글자만 아니면 거짓이다. 참이면 `JSON.stringify`는 따옴표만 더하고 UTF-8 바이트 수는 글자 수와 같다 */
// 글자 집합은 이스케이프 열(`\u005d`가 `]`로 바뀌지 않게)로 만든다
const NOT_PLAIN_ASCII = new RegExp(String.raw`[^\u0020\u0021\u0023-\u005b\u005d-\u007e]`);

/** 글이 출력 가능한 ASCII뿐이고 이스케이프할 글자가 없는가 */
export function isPlainJsonText(text: string): boolean {
  return !NOT_PLAIN_ASCII.test(text);
}

/** `JSON.stringify(text)`의 UTF-8 바이트 수(따옴표 포함)와 `text` 자체의 UTF-8 바이트 수. 글자를 한 번 훑어 세고 새 문자열을 만들지 않는다 */
export function stringUtf8Sizes(text: string): { readonly json: number; readonly utf8: number } {
  // 흔한 경우: 한 번의 정규식 검사로 끝낸다
  if (isPlainJsonText(text)) return { json: text.length + 2, utf8: text.length };
  let json = 2;
  let utf8 = 0;
  const length = text.length;
  for (let i = 0; i < length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      utf8 += 1;
      if (code === 0x22 || code === 0x5c) json += 2;
      else if (code < 0x20)
        json += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6;
      else json += 1;
    } else if (code < 0x800) {
      utf8 += 2;
      json += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        utf8 += 4;
        json += 4;
        i += 1;
      } else {
        // 짝 없는 서로게이트: JSON은 `\udXXX`(6바이트)로 쓰고 UTF-8 인코더는 U+FFFD(3바이트)로 바꾼다
        utf8 += 3;
        json += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      utf8 += 3;
      json += 6;
    } else {
      utf8 += 3;
      json += 3;
    }
  }
  return { json, utf8 };
}

const encoder = new TextEncoder();

/**
 * 값의 JSON 직렬화 UTF-8 바이트 수. `JSON.stringify`와 같은 규칙이다: undefined 멤버는 건너뛰고 배열 안의 undefined는 null이다.
 * 값은 JSON 값(문자열, 숫자, 불리언, null, 배열, 일반 객체)이라고 본다. `toJSON`은 부르지 않는다.
 */
export function jsonUtf8Length(node: unknown): number {
  if (typeof node === "string") return stringUtf8Sizes(node).json;
  if (Array.isArray(node)) {
    const items: readonly unknown[] = node;
    let total = 2;
    for (const [index, item] of items.entries()) {
      if (index > 0) total += 1;
      total += jsonUtf8Length(item);
    }
    return total;
  }
  if (typeof node === "object" && node !== null) {
    let total = 2;
    let first = true;
    for (const [key, member] of Object.entries(node)) {
      if (member === undefined) continue;
      if (!first) total += 1;
      first = false;
      total += stringUtf8Sizes(key).json + 1 + jsonUtf8Length(member);
    }
    return total;
  }
  if (node === undefined) return 4;
  return encoder.encode(JSON.stringify(node)).length;
}
