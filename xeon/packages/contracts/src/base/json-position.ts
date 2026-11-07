/** JSON 문법 오류의 위치. 줄과 칸은 1부터 센다. 칸은 줄 머리에서 UTF-16 단위로 센다 */
export interface JsonErrorPosition {
  readonly line: number;
  readonly column: number;
}

/**
 * 텍스트가 올바른 JSON이면 undefined, 아니면 첫 문법 오류의 위치다. `JSON.parse`의 오류 메시지에는 위치가 없어서(Bun)
 * 엄격한 RFC 8259 스캐너로 찾는다. 오류가 입력 끝에서 나면(모자람) 마지막 문자 다음 위치다.
 * 값은 던지지 않는다. 실패는 스캐너의 `error`에 첫 오류 위치를 적고 모든 함수가 거짓으로 돌아간다.
 */
export function jsonErrorPosition(text: string): JsonErrorPosition | undefined {
  const cursor: Cursor = { text, pos: 0, error: undefined };
  skipWhitespace(cursor);
  const parsed = value(cursor);
  if (parsed) {
    skipWhitespace(cursor);
    if (cursor.pos < text.length) fail(cursor);
  }
  if (cursor.error === undefined) return undefined;
  return positionOf(text, cursor.error);
}

interface Cursor {
  readonly text: string;
  pos: number;
  /** 첫 오류가 난 문자 위치. 한 번 정해지면 바뀌지 않는다 */
  error: number | undefined;
}

function fail(cursor: Cursor): false {
  cursor.error ??= cursor.pos;
  return false;
}

/** 현재 문자. 입력 끝이면 빈 문자열이다 */
function current(cursor: Cursor): string {
  return cursor.text.charAt(cursor.pos);
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isHex(ch: string): boolean {
  return isDigit(ch) || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
}

function skipWhitespace(cursor: Cursor): void {
  while (cursor.pos < cursor.text.length && isWhitespace(current(cursor))) cursor.pos += 1;
}

function value(cursor: Cursor): boolean {
  const ch = current(cursor);
  if (ch === "{") return object(cursor);
  if (ch === "[") return array(cursor);
  if (ch === '"') return string(cursor);
  if (ch === "t") return literal(cursor, "true");
  if (ch === "f") return literal(cursor, "false");
  if (ch === "n") return literal(cursor, "null");
  if (ch === "-" || isDigit(ch)) return number(cursor);
  return fail(cursor);
}

function literal(cursor: Cursor, word: string): boolean {
  for (const expected of word) {
    if (current(cursor) !== expected) return fail(cursor);
    cursor.pos += 1;
  }
  return true;
}

function digits(cursor: Cursor): boolean {
  if (!isDigit(current(cursor))) return fail(cursor);
  while (isDigit(current(cursor))) cursor.pos += 1;
  return true;
}

function number(cursor: Cursor): boolean {
  if (current(cursor) === "-") cursor.pos += 1;
  // 정수부: 0이면 그 뒤 숫자는 다음 문법이 거른다(01은 1 앞에서 틀린다)
  if (current(cursor) === "0") cursor.pos += 1;
  else if (!digits(cursor)) return false;
  if (current(cursor) === ".") {
    cursor.pos += 1;
    if (!digits(cursor)) return false;
  }
  if (current(cursor) === "e" || current(cursor) === "E") {
    cursor.pos += 1;
    if (current(cursor) === "+" || current(cursor) === "-") cursor.pos += 1;
    if (!digits(cursor)) return false;
  }
  return true;
}

/** 문자열. 여는 따옴표에서 부른다 */
function string(cursor: Cursor): boolean {
  cursor.pos += 1;
  for (;;) {
    if (cursor.pos >= cursor.text.length) return fail(cursor);
    const ch = current(cursor);
    if (ch === '"') {
      cursor.pos += 1;
      return true;
    }
    if (ch.charCodeAt(0) < 0x20) return fail(cursor);
    if (ch !== "\\") {
      cursor.pos += 1;
      continue;
    }
    cursor.pos += 1;
    const escape = current(cursor);
    if (escape === "u") {
      cursor.pos += 1;
      for (let index = 0; index < 4; index += 1) {
        if (!isHex(current(cursor))) return fail(cursor);
        cursor.pos += 1;
      }
    } else if ('"\\/bfnrt'.includes(escape) && escape !== "") {
      cursor.pos += 1;
    } else {
      return fail(cursor);
    }
  }
}

/** 객체. `{`에서 부른다. 키는 문자열이고 그 뒤에 `:`와 값이 온다 */
function object(cursor: Cursor): boolean {
  cursor.pos += 1;
  skipWhitespace(cursor);
  if (current(cursor) === "}") {
    cursor.pos += 1;
    return true;
  }
  for (;;) {
    if (current(cursor) !== '"') return fail(cursor);
    if (!string(cursor)) return false;
    skipWhitespace(cursor);
    if (current(cursor) !== ":") return fail(cursor);
    cursor.pos += 1;
    skipWhitespace(cursor);
    if (!value(cursor)) return false;
    skipWhitespace(cursor);
    if (current(cursor) === "}") {
      cursor.pos += 1;
      return true;
    }
    if (current(cursor) !== ",") return fail(cursor);
    cursor.pos += 1;
    skipWhitespace(cursor);
  }
}

/** 배열. `[`에서 부른다 */
function array(cursor: Cursor): boolean {
  cursor.pos += 1;
  skipWhitespace(cursor);
  if (current(cursor) === "]") {
    cursor.pos += 1;
    return true;
  }
  for (;;) {
    if (!value(cursor)) return false;
    skipWhitespace(cursor);
    if (current(cursor) === "]") {
      cursor.pos += 1;
      return true;
    }
    if (current(cursor) !== ",") return fail(cursor);
    cursor.pos += 1;
    skipWhitespace(cursor);
  }
}

/** 문자 위치를 줄과 칸으로 바꾼다. 위치가 입력 끝이면 마지막 문자 다음이다 */
function positionOf(text: string, index: number): JsonErrorPosition {
  let line = 1;
  let lineStart = 0;
  for (let at = 0; at < index; at += 1) {
    if (text.charAt(at) === "\n") {
      line += 1;
      lineStart = at + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}
