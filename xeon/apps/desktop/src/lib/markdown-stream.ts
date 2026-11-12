import type { ReactNode } from "react";
import { renderMarkdown, type MarkdownOptions } from "./markdown.tsx";

// 스트리밍 중인 미완성 마크다운을 렌더하기 전에 보정하는 순수 함수다.
// 하는 일은 세 가지다. 닫히지 않은 울타리를 닫고, 아직 끝나지 않은 마지막 줄의 표 행을 보류하고,
// 닫히지 않은 인라인 표식(코드, 강조, 링크 목적지)을 닫거나 지운다. 울타리 안의 내용은 건드리지 않는다.
// 이미 닫힌 문서는 바이트 그대로 돌려준다.

type Fence = { readonly char: string; readonly length: number };
type Span = readonly [start: number, end: number];
type Run = { readonly start: number; readonly end: number };
type Delim = {
  readonly char: string;
  readonly len: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
  /** 앞 글자가 글자·숫자가 아니어서 닫는 표식을 붙여도 단어를 깨지 않는다 */
  readonly closable: boolean;
};
type Opener = { readonly char: string; len: number; readonly closable: boolean };

// 백틱은 \x60으로 쓴다. check-ts-rules의 토큰 검사가 정규식 안의 백틱을 템플릿 시작으로 읽기 때문이다.
const FENCE_OPEN = /^ {0,3}(\x60{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(\x60{3,}|~{3,})[ \t]*$/;
const OPEN_LINK = /!?\[([^\]\n]*)\]\([^)\n]*$/;
const BLOCK_START = /^ {0,3}(?:#{1,6}\s|[-+*]\s|\d+[.)]\s)/;

/** 닫는 표식을 붙이면 울타리나 줄 구조가 바뀌므로 줄 단위 처리는 여기서 끊는다 */
export function closeStreamingMarkdown(source: string): string {
  if (source === "") return "";
  const parts = source.split("\n");
  // 줄바꿈으로 끝나지 않은 마지막 줄. 끝에 줄바꿈이 있으면 빈 문자열이다.
  const partial = parts.pop() ?? "";
  const open = partial !== "";
  const lines = open ? [...parts, partial] : parts;

  const fence = fenceAtEnd(lines);
  if (fence !== undefined) {
    // 같은 글자와 길이로 닫는다. 줄이 끝나지 않았으면 줄바꿈을 먼저 넣는다.
    const closer = fence.char.repeat(fence.length);
    return open ? `${source}\n${closer}` : `${source}${closer}`;
  }
  // 울타리 줄이 방금 닫혔다. 울타리 줄에는 인라인 보정을 하지 않는다.
  if (open && isFenceLine(partial)) return source;

  let kept = lines;
  let terminated = !open;
  // 아직 끝나지 않은 표 행은 표로 해석되지 않도록 보류한다(다음 조각이 와야 행이 된다)
  if (open && isOpenTableRow(partial, parts.at(-1) ?? "")) {
    kept = parts;
    terminated = true;
  }

  const start = paragraphStart(kept);
  const head = kept.slice(0, start);
  const para = kept.slice(start);
  const out = para.length === 0 ? head : [...head, closeInline(para.join("\n"))];
  const body = out.join("\n");
  if (kept.length === 0) return "";
  return terminated ? `${body}\n` : body;
}

/**
 * 끝난 글이 닫히지 않은 울타리 안에서 끝나면(멈춘 답) 같은 글자·길이로 닫는다(dzG 시안 §5). `cut`은 닫았는가이고,
 * 닫은 코드 블록은 글 끝까지 이어진다. 울타리가 모두 닫혀 있으면 글을 그대로 돌려준다
 */
export function closeOpenFence(source: string): { readonly text: string; readonly cut: boolean } {
  const fence = fenceAtEnd(source.split("\n"));
  if (fence === undefined) return { text: source, cut: false };
  const closer = fence.char.repeat(fence.length);
  return { text: source.endsWith("\n") ? `${source}${closer}` : `${source}\n${closer}`, cut: true };
}

/** 스트리밍 조각을 보정한 뒤 렌더한다. `renderMarkdown(closeStreamingMarkdown(source))`와 같다. */
export function renderStreamingMarkdown(source: string, options?: MarkdownOptions): ReactNode {
  return renderMarkdown(closeStreamingMarkdown(source), options);
}

function fenceOpen(line: string): Fence | undefined {
  const m = FENCE_OPEN.exec(line);
  if (m === null) return undefined;
  const run = m[1] ?? "";
  const info = m[2] ?? "";
  const char = run.charAt(0);
  // 백틱 울타리의 정보 문자열에는 백틱이 들어갈 수 없다(인라인 코드로 본다)
  if (char === "`" && info.includes("`")) return undefined;
  return { char, length: run.length };
}

function isFenceClose(line: string, fence: Fence): boolean {
  const m = FENCE_CLOSE.exec(line);
  if (m === null) return false;
  const run = m[1] ?? "";
  return run.charAt(0) === fence.char && run.length >= fence.length;
}

function isFenceLine(line: string): boolean {
  return fenceOpen(line) !== undefined || FENCE_CLOSE.test(line);
}

/** 줄들을 훑고 끝에서 열려 있는 울타리를 돌려준다 */
function fenceAtEnd(lines: readonly string[]): Fence | undefined {
  let fence: Fence | undefined;
  for (const line of lines) {
    if (fence === undefined) fence = fenceOpen(line);
    else if (isFenceClose(line, fence)) fence = undefined;
  }
  return fence;
}

/** 표 행으로 이어질 수 있는 미완성 줄인지. 앞 줄이 `|`를 가졌거나 줄이 `|`로 시작하고, 끝이 `|`가 아니다. */
function isOpenTableRow(partial: string, prev: string): boolean {
  const rowLike = partial.trimStart().startsWith("|") || prev.includes("|");
  return rowLike && !partial.trimEnd().endsWith("|");
}

/** 끝에서부터 빈 줄, 울타리 줄 다음, 목록·제목 줄 머리까지가 마지막 문단(인라인 표식의 범위)이다 */
function paragraphStart(lines: readonly string[]): number {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || isFenceLine(line)) return i + 1;
    if (BLOCK_START.test(line)) return i;
  }
  return 0;
}

function closeInline(text: string): string {
  return closeEmphasis(closeCodeSpans(closeLinks(text)));
}

/** 열린 링크 `[글](주소`는 주소를 떼고 글만 남긴다. 주소가 완성되면 링크가 된다. */
function closeLinks(text: string): string {
  return text.replace(OPEN_LINK, "$1");
}

/** 백틱 묶음 길이가 같은 다음 묶음과 짝을 짓는다(CommonMark 코드 범위). 짝이 없는 마지막 묶음을 닫거나 지운다. */
function scanCodeSpans(text: string): {
  readonly spans: readonly Span[];
  readonly unclosed: Run | undefined;
} {
  const runs: Run[] = [];
  for (const m of text.matchAll(/\x60+/g)) {
    runs.push({ start: m.index, end: m.index + m[0].length });
  }
  const spans: Span[] = [];
  let unclosed: Run | undefined;
  let consumed = 0;
  for (const open of runs) {
    if (open.start < consumed) continue;
    const size = open.end - open.start;
    const close = runs.find((run) => run.start >= open.end && run.end - run.start === size);
    if (close === undefined) {
      unclosed = open;
      continue;
    }
    spans.push([open.start, close.end]);
    consumed = close.end;
  }
  return { spans, unclosed };
}

function closeCodeSpans(text: string): string {
  const { unclosed } = scanCodeSpans(text);
  if (unclosed === undefined) return text;
  // 끝에 여는 묶음만 남았으면 빈 코드 범위라 지운다. 내용이 뒤에 있으면 같은 길이로 닫는다.
  if (unclosed.end === text.length) return text.slice(0, unclosed.start);
  return text + "`".repeat(unclosed.end - unclosed.start);
}

function maskOf(text: string, spans: readonly Span[]): boolean[] {
  const masked = Array.from({ length: text.length }, () => false);
  for (const [start, end] of spans) {
    for (let k = start; k < end; k += 1) masked[k] = true;
  }
  return masked;
}

const isWhite = (c: string): boolean => c === "" || /\s/u.test(c);
const isPunct = (c: string): boolean => /[\p{P}\p{S}]/u.test(c);
const isWordChar = (c: string): boolean => /[\p{L}\p{N}]/u.test(c);

/** `*`와 `_`의 연속 묶음을 CommonMark의 여는·닫는 규칙으로 가른다. 코드 범위 안과 `\` 뒤는 제외한다. */
function delimiters(text: string, masked: readonly boolean[]): Delim[] {
  const out: Delim[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if ((ch !== "*" && ch !== "_") || masked[i] === true) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < text.length && text.charAt(j) === ch && masked[j] !== true) j += 1;
    const prev = text.charAt(i - 1);
    const next = text.charAt(j);
    if (prev !== "\\") {
      const left = !isWhite(next) && (!isPunct(next) || isWhite(prev) || isPunct(prev));
      const right = !isWhite(prev) && (!isPunct(prev) || isWhite(next) || isPunct(next));
      const canOpen = ch === "*" ? left : left && (!right || isPunct(prev));
      const canClose = ch === "*" ? right : right && (!left || isPunct(next));
      if (canOpen || canClose) {
        out.push({ char: ch, len: j - i, canOpen, canClose, closable: !isWordChar(prev) });
      }
    }
    i = j;
  }
  return out;
}

/** 짝이 맞지 않은 여는 표식을 안쪽부터 닫는다. 닫힌 강조는 건드리지 않는다. */
function closeEmphasis(text: string): string {
  const masked = maskOf(text, scanCodeSpans(text).spans);
  const stack: Opener[] = [];
  for (const d of delimiters(text, masked)) {
    let rem = d.len;
    while (d.canClose && rem > 0) {
      const k = stack.findLastIndex((o) => o.char === d.char);
      const opener = k === -1 ? undefined : stack[k];
      if (opener === undefined) break;
      const use = Math.min(opener.len, rem);
      opener.len -= use;
      rem -= use;
      // 짝 사이에 있던 여는 표식은 이제 글자가 된다
      stack.splice(k + 1);
      if (opener.len === 0) stack.pop();
    }
    if (d.canOpen && rem > 0) stack.push({ char: d.char, len: rem, closable: d.closable });
  }
  const pending = stack.filter((o) => o.closable && o.len > 0);
  if (pending.length === 0) return text;
  // 닫는 표식은 글자 뒤에 와야 닫힌다. 끝의 공백은 떼고 붙인다.
  const closers = pending
    .toReversed()
    .map((o) => o.char.repeat(o.len))
    .join("");
  return text.trimEnd() + closers;
}
