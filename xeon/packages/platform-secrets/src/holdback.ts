// L0.secrets.spec §3.5.1 화면 가림의 보류. 진행 중 텍스트의 꼬리 가운데 "뒤에 이어 올 글과 합쳐져 시크릿 패턴이 될 수 있는 열린 후보"가
// 시작하는 자리를 구한다. 그 앞은 보여도 된다. 이미 패턴이 된 구간은 가림 구간이 덮으므로 후보가 아니다(구간은 글이 늘면 함께 늘어난다).
// 확신이 없는 모양은 후보로 본다(보류하는 쪽). 후보의 길이는 규칙의 최소 길이에서 멈추거나(고정 길이 패턴),
// 값이 끝나는 글자(공백, 따옴표 같은 규칙 밖 글자)가 올 때까지 이어진다(길이 상한이 없는 패턴: 키-값, 접속 문자열, PEM, JWT).

const WHITESPACE = /\s/;

function code(text: string, at: number): number {
  return text.charCodeAt(at);
}

/** `[A-Za-z0-9_-]` */
function isTokenChar(c: number): boolean {
  return (
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45
  );
}

/** `[A-Za-z0-9_]` */
function isWordChar(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

/** `[A-Za-z0-9]` */
function isAlnum(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

/** `[0-9A-Z]` */
function isUpperDigit(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90);
}

/**
 * `<literal><본문 글자 minBody개 이상>` 꼴 패턴의 열린 꼬리 시작. 꼬리가 literal의 앞부분이거나,
 * literal 뒤에 본문 글자만 minBody개 미만으로 이어지면 열린 것이다. 없으면 -1.
 * 본문이 minBody개가 되면 패턴이 된 것이므로 후보가 아니다(minBody가 0이면 literal이 다 오면 후보가 아니다).
 */
function openLiteralBody(
  text: string,
  literal: string,
  isBody: (c: number) => boolean,
  minBody: number,
): number {
  const total = text.length;
  const first = literal.charAt(0);
  let at = text.indexOf(first, Math.max(0, total - (literal.length + minBody - 1)));
  while (at !== -1) {
    const tailLength = total - at;
    if (tailLength < literal.length) {
      if (literal.startsWith(text.slice(at))) return at;
    } else if (text.startsWith(literal, at)) {
      const bodyLength = tailLength - literal.length;
      if (bodyLength < minBody) {
        let all = true;
        for (let i = at + literal.length; i < total; i += 1) {
          if (!isBody(code(text, i))) {
            all = false;
            break;
          }
        }
        if (all) return at;
      }
    }
    at = text.indexOf(first, at + 1);
  }
  return -1;
}

interface BodyRule {
  readonly literal: string;
  readonly isBody: (c: number) => boolean;
  readonly minBody: number;
}

// PREFIX_RULES와 같은 모양(redactor.ts). 본문 글자 집합과 최소 길이는 그 정규식에서 옮겼다.
// `sk-(?:proj-)?[A-Za-z0-9_-]{20,}`은 `proj-`도 본문 글자이므로 `sk-` 뒤 20자 이상과 같다.
const BODY_RULES: readonly BodyRule[] = [
  { literal: "sk-ant-", isBody: isTokenChar, minBody: 20 },
  { literal: "sk-", isBody: isTokenChar, minBody: 20 },
  { literal: "AIza", isBody: isTokenChar, minBody: 35 },
  { literal: "github_pat_", isBody: isWordChar, minBody: 50 },
  { literal: "ghp_", isBody: isAlnum, minBody: 36 },
  ...["a", "b", "p", "o", "s", "r"].map((kind) => ({
    literal: `xox${kind}-`,
    isBody: isTokenChar,
    minBody: 10,
  })),
  { literal: "AKIA", isBody: isUpperDigit, minBody: 16 },
  { literal: "AGE-SECRET-KEY-1", isBody: isUpperDigit, minBody: 58 },
];

/** 가장 이른 열린 후보. 없으면 -1 */
function earliest(a: number, b: number): number {
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

// ── JWT: eyJ<토큰 10+>.<토큰 10+>.<토큰 10+> ─────────────────────────────

const MIN_JWT_PART = 10;
const DOT = 46;

function tokenRunEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length && isTokenChar(code(text, i))) i += 1;
  return i;
}

function jwtOpenFrom(text: string, at: number): boolean {
  const total = text.length;
  let i = at + 3;
  for (let part = 1; part <= 3; part += 1) {
    const start = i;
    i = tokenRunEnd(text, i);
    const length = i - start;
    if (i >= total) return part < 3 || length < MIN_JWT_PART;
    if (part === 3 || length < MIN_JWT_PART || code(text, i) !== DOT) return false;
    i += 1;
  }
  return false;
}

function jwtOpenStart(text: string): number {
  let at = text.indexOf("eyJ");
  if (at === -1) return openLiteralBody(text, "eyJ", isTokenChar, 0);
  let region = text.length;
  while (region > 0) {
    const c = code(text, region - 1);
    if (!isTokenChar(c) && c !== DOT) break;
    region -= 1;
  }
  at = text.indexOf("eyJ", region);
  while (at !== -1) {
    if (jwtOpenFrom(text, at)) return at;
    at = text.indexOf("eyJ", at + 1);
  }
  return openLiteralBody(text, "eyJ", isTokenChar, 0);
}

// ── PEM ─────────────────────────────────────────────────────────────────

const PEM_BEGIN = "-----BEGIN";
const PEM_HEADER = /-----BEGIN ([A-Z ]*)-----/y;
const PEM_END_PRIVATE = /-----END [A-Z ]*PRIVATE KEY-----/g;

function hasMatchFrom(pattern: RegExp, text: string, from: number): boolean {
  pattern.lastIndex = from;
  return pattern.test(text);
}

/**
 * `-----BEGIN` 뒤가 `" [A-Z ]*-----"`의 앞부분(글 끝까지 이어짐)인가. 아니면 머리줄이 될 수 없다.
 * 대문자와 공백 뒤에 하이픈이 5개 미만이면 아직 열려 있다.
 */
function headerStillOpen(text: string, from: number): boolean {
  const total = text.length;
  if (from >= total) return true;
  if (text.charAt(from) !== " ") return false;
  let i = from;
  while (i < total && (text.charAt(i) === " " || (code(text, i) >= 65 && code(text, i) <= 90)))
    i += 1;
  return total - i < 5 && /^-*$/.test(text.slice(i));
}

/** 닫히지 않은 개인 키 `-----BEGIN` 블록의 시작(머리줄이 덜 온 것 포함). 개인 키 끝 줄이 와야 닫힌다 */
function pemOpenStart(text: string): number {
  let at = text.indexOf(PEM_BEGIN);
  while (at !== -1) {
    PEM_HEADER.lastIndex = at;
    const header = PEM_HEADER.exec(text);
    if (header === null) {
      // 머리줄이 아직 덜 왔으면 보류하고, 머리줄이 될 수 없다고 확정되면 풀고 다음 BEGIN을 본다
      if (headerStillOpen(text, at + PEM_BEGIN.length)) return at;
      at = text.indexOf(PEM_BEGIN, at + PEM_BEGIN.length);
      continue;
    }
    const end = at + header[0].length;
    // 가림 대상은 개인 키뿐이다(redactor.ts의 PRIVATE KEY 패턴). 공개 키와 인증서는 보류하지 않는다
    if ((header[1] ?? "").endsWith("PRIVATE KEY") && !hasMatchFrom(PEM_END_PRIVATE, text, end)) {
      return at;
    }
    at = text.indexOf(PEM_BEGIN, end);
  }
  return openLiteralBody(text, PEM_BEGIN, isTokenChar, 0);
}

// ── 키-값 ───────────────────────────────────────────────────────────────

// redactor.ts의 KV_PATTERN과 같은 키 이름 집합. 일치 자리마다 시작하는 키를 모두 보려고 앞보기로 쓴다.
const KV_KEY_AT =
  /(?=(api[_-]?key|secret|client[_-]?secret|access[_-]?key|private[_-]?key|token|password|passwd|pass|pwd|dsn|authorization))/gi;
const KV_KEY_LITERALS: readonly string[] = [
  "apikey",
  "api_key",
  "api-key",
  "secret",
  "clientsecret",
  "client_secret",
  "client-secret",
  "accesskey",
  "access_key",
  "access-key",
  "privatekey",
  "private_key",
  "private-key",
  "token",
  "password",
  "passwd",
  "pass",
  "pwd",
  "dsn",
  "authorization",
];
const KV_MIN_VALUE = 8;
const METHOD_WORD = /(?:Bearer|Basic|Token)\s+/iy;

function isQuote(char: string): boolean {
  return char === "'" || char === '"';
}

/** 따옴표 하나(앞에 역슬래시가 몇 개 붙어도 된다)를 건너뛴다. 역슬래시만 끝까지 이어지면 따옴표가 올 수 있으므로 끝까지 건너뛴다. 따옴표가 아니면 그대로 */
function skipQuote(text: string, from: number): number {
  let i = from;
  while (i < text.length && text.charAt(i) === "\\") i += 1;
  if (i < text.length) return isQuote(text.charAt(i)) ? i + 1 : from;
  return i;
}

function skipWhitespace(text: string, from: number): number {
  let i = from;
  while (i < text.length && WHITESPACE.test(text.charAt(i))) i += 1;
  return i;
}

/** from부터 끝까지가 값 글자(공백, 따옴표 아님)뿐이고 8자 미만이면 값이 아직 열려 있다 */
function valueOpenAt(text: string, from: number): boolean {
  if (text.length - from >= KV_MIN_VALUE) return false;
  for (let i = from; i < text.length; i += 1) {
    const char = text.charAt(i);
    if (WHITESPACE.test(char) || isQuote(char)) return false;
  }
  return true;
}

/** 키 끝 뒤의 나머지가 `구분자 + 값 8자 미만`의 앞부분인가(키-값 일치가 아직 닫히지 않았다) */
function kvRestOpen(text: string, from: number): boolean {
  const total = text.length;
  let i = from;
  i = skipQuote(text, i);
  i = skipWhitespace(text, i);
  if (i >= total) return true;
  const separator = text.charAt(i);
  if (separator !== ":" && separator !== "=") return false;
  i = skipWhitespace(text, i + 1);
  if (i >= total) return true;
  i = skipQuote(text, i);
  if (i >= total) return true;
  if (valueOpenAt(text, i)) return true;
  METHOD_WORD.lastIndex = i;
  const method = METHOD_WORD.exec(text);
  if (method === null) return false;
  const after = i + method[0].length;
  return after >= total || valueOpenAt(text, after);
}

/** 열린 키-값 꼬리가 가질 수 있는 공백 아닌 글자 수의 상한(키 이름 15자, 따옴표, 구분자, 방식어 6자, 값 7자에 여유) */
const KV_OPEN_NON_WHITESPACE = 48;

/** 끝에서 거슬러 공백 아닌 글자를 KV_OPEN_NON_WHITESPACE개 넘게 만나기 전까지의 시작 자리. 공백 덩어리는 길이와 상관없이 건너뛴다 */
function kvWindowStart(text: string): number {
  let seen = 0;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (!WHITESPACE.test(text.charAt(i))) {
      seen += 1;
      if (seen > KV_OPEN_NON_WHITESPACE) return i + 1;
    }
  }
  return 0;
}

function kvOpenStart(fullText: string): number {
  const base = kvWindowStart(fullText);
  const text = base === 0 ? fullText : fullText.slice(base);
  const total = text.length;
  // 키가 다 오지 않은 꼬리: 키 이름의 앞부분
  let found = -1;
  const lowerTail = text.slice(Math.max(0, total - 14)).toLowerCase();
  const tailStart = total - lowerTail.length;
  for (let i = 0; i < lowerTail.length; i += 1) {
    const part = lowerTail.slice(i);
    if (KV_KEY_LITERALS.some((key) => key.length > part.length && key.startsWith(part))) {
      found = tailStart + i;
      break;
    }
  }
  for (const match of text.matchAll(KV_KEY_AT)) {
    const key = match[1];
    if (key === undefined) continue;
    if (found !== -1 && match.index >= found) break;
    if (kvRestOpen(text, match.index + key.length)) {
      found = match.index;
      break;
    }
  }
  return found === -1 ? -1 : found + base;
}

// ── 접속 문자열 `scheme://user:<값>@` ────────────────────────────────────

const USERINFO_OPEN = /[^\s:@/]*(?::[^\s@/]*)?$/y;

function userinfoOpenStart(text: string): number {
  let at = text.indexOf("://");
  while (at !== -1) {
    const from = at + 3;
    USERINFO_OPEN.lastIndex = from;
    if (USERINFO_OPEN.test(text)) return from;
    at = text.indexOf("://", from);
  }
  return -1;
}

/**
 * 패턴 규칙(접두 패턴, JWT, PEM, 키-값, 접속 문자열)에서 열린 후보가 시작하는 가장 이른 자리. 없으면 text.length.
 * 알려진 값 변형은 등록부가 있어야 하므로 여기서 보지 않는다(redactor.ts).
 */
export function patternOpenStart(text: string): number {
  let found = -1;
  for (const rule of BODY_RULES) {
    found = earliest(found, openLiteralBody(text, rule.literal, rule.isBody, rule.minBody));
  }
  found = earliest(found, jwtOpenStart(text));
  found = earliest(found, pemOpenStart(text));
  found = earliest(found, kvOpenStart(text));
  found = earliest(found, userinfoOpenStart(text));
  return found === -1 ? text.length : found;
}
