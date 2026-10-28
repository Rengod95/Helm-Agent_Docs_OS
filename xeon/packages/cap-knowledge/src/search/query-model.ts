// L2.knowledge.spec §4.8.4 질의 규칙의 순수 부분: 정규화, 토큰 나누기, FTS5 MATCH 식, LIKE 식, 스니펫 자르기.

/** trigram 토크나이저는 3 코드 포인트 미만 질의를 MATCH로 찾지 못한다(오류 없이 0건) */
const TRIGRAM_MIN_CHARS = 3;

export interface QueryTokens {
  /** 큰따옴표 구절은 한 토큰으로 둔다. 모두 비어 있지 않다 */
  readonly tokens: readonly string[];
}

function codePointCount(text: string): number {
  return Array.from(text).length;
}

/** NFC로 바꾸고 앞뒤 공백을 지운다. 공백만 있으면 빈 문자열 */
export function normalizeQuery(raw: string): string {
  return raw.normalize("NFC").trim();
}

/**
 * 공백으로 나눈 토큰과 큰따옴표 구절을 모은다. 닫히지 않은 따옴표는 끝까지를 구절로 본다.
 * FTS5 특수 문자(`"`, `*`, `^`, `:`, `(`, `)`)는 토큰 안에서 글자 그대로 쓰이므로 여기서는 건드리지 않는다.
 */
export function tokenizeQuery(normalized: string): QueryTokens {
  const tokens: string[] = [];
  let index = 0;
  while (index < normalized.length) {
    while (index < normalized.length && /\s/.test(normalized.charAt(index))) index += 1;
    if (index >= normalized.length) break;
    if (normalized.charAt(index) === '"') {
      const close = normalized.indexOf('"', index + 1);
      const end = close === -1 ? normalized.length : close;
      const phrase = normalized.slice(index + 1, end).trim();
      if (phrase !== "") tokens.push(phrase);
      index = close === -1 ? normalized.length : close + 1;
      continue;
    }
    let end = index;
    while (end < normalized.length && !/\s/.test(normalized.charAt(end))) end += 1;
    tokens.push(normalized.slice(index, end));
    index = end;
  }
  return { tokens };
}

/** 모든 토큰이 3 코드 포인트 이상이면 FTS 경로, 하나라도 짧으면 LIKE 경로다 */
export function queryPath(tokens: readonly string[]): "fts" | "like" {
  return tokens.every((token) => codePointCount(token) >= TRIGRAM_MIN_CHARS) ? "fts" : "like";
}

/** 토큰마다 큰따옴표로 감싸고 내부 큰따옴표는 두 번 쓴다. 토큰은 공백으로 이어 AND가 된다 */
export function toMatchExpression(tokens: readonly string[]): string {
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" ");
}

/** `LIKE ... ESCAPE '\'`용 패턴. `%`, `_`, `\`를 이스케이프한다 */
export function toLikePattern(token: string): string {
  return `%${token.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

const SNIPPET_MAX_CHARS = 600;
const LIKE_WINDOW = 120;

function cut(text: string): string {
  return Array.from(text.replace(/\s+/g, " ").trim()).slice(0, SNIPPET_MAX_CHARS).join("");
}

/** FTS5 `snippet()` 결과를 600자에서 자른다 */
export function clipSnippet(text: string): string {
  return cut(text);
}

/**
 * LIKE 경로의 스니펫: 첫 일치 위치 앞뒤 120자. 일치 위치를 찾지 못하면(대소문자 처리 차이) 앞에서 자른다.
 * SQLite LIKE는 ASCII 대소문자를 구분하지 않으므로 같은 규칙으로 소문자 비교한다.
 */
export function likeSnippet(text: string, tokens: readonly string[]): string {
  const lowered = text.toLowerCase();
  let first = -1;
  for (const token of tokens) {
    const at = lowered.indexOf(token.toLowerCase());
    if (at !== -1 && (first === -1 || at < first)) first = at;
  }
  if (first === -1) return cut(text);
  const points = Array.from(text);
  // 일치 위치는 UTF-16 오프셋이라 코드 포인트 위치로 바꾼다
  const point = Array.from(text.slice(0, first)).length;
  const from = Math.max(0, point - LIKE_WINDOW);
  const to = Math.min(points.length, point + LIKE_WINDOW + 1);
  const window = points.slice(from, to).join("");
  return cut(`${from > 0 ? "…" : ""}${window}${to < points.length ? "…" : ""}`);
}
