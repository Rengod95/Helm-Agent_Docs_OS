// 페어링 코드의 글자 체계: Crockford base32(0-9와 A-Z에서 I, L, O, U를 뺀 32자). 사람이 읽고 입력하기 쉽다(spec §8.3).

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 코드 길이(글자). 10자 × 5비트 = 50비트 */
const PAIRING_CODE_LENGTH = 10;

/** 무작위 바이트 `length`개로 코드를 만든다. 바이트 하나가 글자 하나(`& 31`)라 256이 32로 나뉘어 치우침이 없다 */
export function encodeCode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    out += ALPHABET.charAt((bytes[i] ?? 0) & 31);
  }
  return out;
}

/**
 * 사용자가 입력한 코드를 정규형(대문자 10자)으로. 공백과 하이픈은 버리고, 소문자는 올리고, 헷갈리는 글자(I, L → 1, O → 0)는 Crockford 규칙으로 바꾼다.
 * 모양이 틀리면 `null`이다.
 */
export function normalizeCode(input: string): string | null {
  const compact = input
    .replace(/[\s-]/gu, "")
    .toUpperCase()
    .replace(/[IL]/gu, "1")
    .replace(/O/gu, "0");
  if (compact.length !== PAIRING_CODE_LENGTH) return null;
  for (const char of compact) {
    if (!ALPHABET.includes(char)) return null;
  }
  return compact;
}

/** 화면에 보이는 모양: 5자씩 하이픈(`ABCDE-12345`) */
export function formatCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}
