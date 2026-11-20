// 시크릿 판정. cap-mcp의 `values.ts`(`looksLikeSecretName`)와 같은 낱말 규칙에 값의 알려진 접두를 더한다.
// L3 라이브러리는 L2를 import하지 않으므로(층 규칙) 같은 규칙을 여기에 둔다. 값은 어디에도 저장하지 않고 판정만 한다.

const SECRET_WORDS: ReadonlySet<string> = new Set([
  "KEY",
  "APIKEY",
  "TOKEN",
  "SECRET",
  "SECRETS",
  "PASSWORD",
  "PASSWD",
  "PWD",
  "CREDENTIAL",
  "CREDENTIALS",
  "AUTH",
  "AUTHORIZATION",
  "COOKIE",
  "BEARER",
]);

function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((word) => word.length > 0);
}

export function looksLikeSecretName(name: string): boolean {
  return wordsOf(name).some((word) => SECRET_WORDS.has(word));
}

const SECRET_VALUE_PREFIXES: readonly RegExp[] = [
  /^sk-[A-Za-z0-9_-]{8,}/,
  /^ghp_[A-Za-z0-9]{8,}/,
  /^gho_[A-Za-z0-9]{8,}/,
  /^github_pat_[A-Za-z0-9_]{8,}/,
  /^xox[abprs]-[A-Za-z0-9-]{8,}/,
  /^AKIA[0-9A-Z]{12,}/,
  /^Bearer\s+\S{8,}/i,
];

/** 값이 알려진 시크릿 형태인가(`Bearer sk-…`처럼 접두가 가려지는 경우도 본다) */
export function looksLikeSecretValue(value: string): boolean {
  return SECRET_VALUE_PREFIXES.some((pattern) => pattern.test(value.trim()));
}

/** `${VAR}`, `${VAR:-기본값}`, `$VAR` 형태의 환경 변수 참조 이름들. 값은 읽지 않는다 */
export function envRefsIn(
  value: string,
): readonly { readonly name: string; readonly fallback: string | undefined }[] {
  const refs: { name: string; fallback: string | undefined }[] = [];
  for (const match of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g)) {
    refs.push({ name: match[1] ?? "", fallback: match[2] });
  }
  return refs;
}

/** 본문 안을 찾는 값 형태(접두가 단어 경계에서 시작한다). 스크립트 본문과 명령 문자열에 쓴다 */
const SECRET_VALUE_SEARCH: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/,
  /\bghp_[A-Za-z0-9]{8,}/,
  /\bgho_[A-Za-z0-9]{8,}/,
  /\bgithub_pat_[A-Za-z0-9_]{8,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/,
  /\bAKIA[0-9A-Z]{12,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
];

/** 텍스트 어디에든 알려진 시크릿 형태의 값이 있는가. 값은 돌려주지 않는다 */
export function containsSecretValue(text: string): boolean {
  return SECRET_VALUE_SEARCH.some((pattern) => pattern.test(text));
}

const SECRET_VALUE_MASKS: readonly RegExp[] = SECRET_VALUE_SEARCH.map(
  (pattern) =>
    new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`),
);

/**
 * 알려진 시크릿 형태의 값을 `***`로 가린 텍스트를 돌려준다(보고서에 명령을 싣기 전에 쓴다). 값이 없으면 원문과 같다.
 * 명령은 `secret_in_command`로 이미 걸러지므로 이 가림은 마지막 방어다.
 */
export function maskSecretValues(text: string): string {
  return SECRET_VALUE_MASKS.reduce((masked, pattern) => masked.replace(pattern, "***"), text);
}

/** `NAME=값` 꼴로 시크릿 이름에 값을 준 토큰이 있는가(값이 `$` 참조면 값이 아니라 참조다) */
export function assignsSecretLiteral(tokens: readonly string[]): boolean {
  return tokens.some((token) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(token);
    if (match === null) return false;
    const name = match[1] ?? "";
    const value = match[2] ?? "";
    return looksLikeSecretName(name) && !value.startsWith("$");
  });
}
