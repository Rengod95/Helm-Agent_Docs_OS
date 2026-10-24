import { err, ok, type Result } from "@xeon/contracts";
import { invalidInput, type WebFailure } from "../errors.ts";

// L2.web.spec §4.9.1 8단계, §4.9.2. `range`(문자 위치 offset, 1부터 세는 줄 번호)를 먼저 적용하고 `maxChars`로 자른다.
// 절단은 줄 경계에서 하고 `nextOffset`에 다음 문자 위치를 둔다. 순수 함수다.

export interface TextRange {
  readonly offset?: number | undefined;
  readonly startLine?: number | undefined;
  readonly endLine?: number | undefined;
}

export interface TextSlice {
  readonly content: string;
  readonly shown: number;
  readonly total: number;
  readonly nextOffset?: number;
}

/** 1부터 센 줄 번호 line이 시작하는 문자 위치. 줄 수를 넘으면 text.length */
function lineStart(text: string, line: number): number {
  let position = 0;
  for (let current = 1; current < line; current += 1) {
    const newline = text.indexOf("\n", position);
    if (newline === -1) return text.length;
    position = newline + 1;
  }
  return position;
}

/** 줄 번호 line의 끝(다음 줄 시작 위치) */
function lineEnd(text: string, line: number): number {
  return lineStart(text, line + 1);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

export function sliceText(
  text: string,
  range: TextRange | undefined,
  maxChars: number,
): Result<TextSlice, WebFailure> {
  const total = text.length;
  const startLine = range?.startLine;
  const endLine = range?.endLine;
  if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
    return err(invalidInput("range.startLine must not be greater than range.endLine."));
  }
  let start = 0;
  if (range?.offset !== undefined) start = Math.min(range.offset, total);
  else if (startLine !== undefined) start = lineStart(text, startLine);
  const end = endLine === undefined ? total : Math.max(start, lineEnd(text, endLine));
  if (start >= end) return ok({ content: "", shown: 0, total });
  const limit = start + maxChars;
  if (limit >= end) {
    return ok({ content: text.slice(start, end), shown: end - start, total });
  }
  let cut = limit;
  const newline = text.lastIndexOf("\n", cut - 1);
  if (newline > start + maxChars / 2) cut = newline + 1;
  else if (isHighSurrogate(text.charCodeAt(cut - 1))) cut -= 1;
  return ok({ content: text.slice(start, cut), shown: cut - start, total, nextOffset: cut });
}

/** 서식을 벗긴 일반 텍스트(`format: "text"`). 링크는 글자만, 코드 울타리와 표지는 지운다 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
