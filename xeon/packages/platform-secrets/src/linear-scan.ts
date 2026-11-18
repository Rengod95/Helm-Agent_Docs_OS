// L0.secrets.spec §3.5 큰 내용의 시간. 정규식 세 개(PEM 개인 키, JWT, 접속 문자열 사용자 정보)는 입력이 클 때 입력 길이의 제곱으로 느려질 수 있어
// (한 줄짜리 소문자 문자열 1 MiB에서 60초 넘게, PEM 시작 줄만 이어 붙인 1 MiB에서 15초) 같은 일치 규칙을 선형 시간으로 찾는다.
// 일치하는 자리와 길이는 옛 정규식과 같다(시험이 옛 정규식과 견준다).

export interface Span {
  readonly start: number;
  readonly end: number;
}

const PEM_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const PEM_END = /-----END [A-Z ]*PRIVATE KEY-----/g;
const USERINFO_TAIL = /:\/\/([^\s:@/]+:)([^\s@/]+)@/g;

/** PEM 개인 키 시작 줄부터 가장 가까운 끝 줄까지. 끝 줄이 없으면 그 뒤의 시작 줄도 일치하지 않으므로 거기서 멈춘다 */
export function findPrivateKeyBlocks(text: string): Span[] {
  const out: Span[] = [];
  PEM_BEGIN.lastIndex = 0;
  for (;;) {
    const begin = PEM_BEGIN.exec(text);
    if (begin === null) break;
    PEM_END.lastIndex = begin.index + begin[0].length;
    const end = PEM_END.exec(text);
    if (end === null) break;
    const stop = end.index + end[0].length;
    out.push({ start: begin.index, end: stop });
    PEM_BEGIN.lastIndex = stop;
  }
  return out;
}

function isTokenChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    code === 45
  );
}

function tokenRunEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length && isTokenChar(text.charCodeAt(i))) i += 1;
  return i;
}

const MIN_JWT_PART = 10;
const DOT = 46;

/** `eyJ`로 시작하는 `<토큰>.<토큰>.<토큰>`(각 토큰은 [A-Za-z0-9_-] 10자 이상). 실패한 시작은 같은 토큰 안의 뒤쪽 시작도 실패하므로 토큰 끝으로 건너뛴다 */
export function findJwts(text: string): Span[] {
  const out: Span[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf("eyJ", from);
    if (at === -1) break;
    const s1 = at + 3;
    const e1 = tokenRunEnd(text, s1);
    if (e1 - s1 >= MIN_JWT_PART && text.charCodeAt(e1) === DOT) {
      const s2 = e1 + 1;
      const e2 = tokenRunEnd(text, s2);
      if (e2 - s2 >= MIN_JWT_PART && text.charCodeAt(e2) === DOT) {
        const s3 = e2 + 1;
        const e3 = tokenRunEnd(text, s3);
        if (e3 - s3 >= MIN_JWT_PART) {
          out.push({ start: at, end: e3 });
          from = e3;
          continue;
        }
      }
    }
    from = e1;
  }
  return out;
}

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** `://` 앞에 글자로 시작하는 스킴([a-z][a-z0-9+.-]*)이 있는가. 스킴 문자가 이어지는 구간에 글자가 하나라도 있으면 된다 */
function hasSchemeBefore(text: string, colon: number): boolean {
  let i = colon - 1;
  let letter = false;
  while (i >= 0) {
    const code = text.charCodeAt(i);
    if (isLetter(code)) letter = true;
    else if (!(code >= 48 && code <= 57) && code !== 43 && code !== 46 && code !== 45) break;
    i -= 1;
  }
  return letter;
}

export interface UserinfoSpan {
  /** 값(비밀번호) 자리 */
  readonly start: number;
  readonly end: number;
}

/** `scheme://user:<값>@` 의 값 자리 */
export function findUserinfoValues(text: string): UserinfoSpan[] {
  const out: UserinfoSpan[] = [];
  USERINFO_TAIL.lastIndex = 0;
  for (;;) {
    const match = USERINFO_TAIL.exec(text);
    if (match === null) break;
    const head = match[1];
    const value = match[2];
    if (head === undefined || value === undefined) continue;
    if (!hasSchemeBefore(text, match.index)) continue;
    const start = match.index + 3 + head.length;
    out.push({ start, end: start + value.length });
  }
  return out;
}

/** 자리 목록(앞에서 뒤로, 겹치지 않음)을 `replacement`로 바꾼 글 */
export function replaceSpans(text: string, spans: readonly Span[], replacement: string): string {
  if (spans.length === 0) return text;
  const parts: string[] = [];
  let at = 0;
  for (const span of spans) {
    parts.push(text.slice(at, span.start), replacement);
    at = span.end;
  }
  parts.push(text.slice(at));
  return parts.join("");
}
