// 계획 본문 같은 글을 그릴 때 쓰는 Markdown 부분 집합의 순수 파서. React를 쓰지 않는다(그리기는 markdown-view.tsx, 시험은 test/views/markdown-blocks.test.ts).
// 지원: ATX 제목(#~######), 문단(연속 줄을 한 문단으로, 줄바꿈은 살린다), 글머리 목록(-, *, +), 번호 목록(1. 또는 1)),
// 구분선(---), 펜스 코드(``` 또는 ~~~, 닫히지 않으면 끝까지 코드), 인라인 `코드`, **굵게**, *기울임*, _기울임_, [글](주소).
// 링크는 글만 남기고 주소는 버린다(아무 토큰에도 주소가 없다). HTML은 해석하지 않는다. 짝이 안 맞는 표지는 글자 그대로 둔다.
// 인용(>), 중첩 목록, 표, 강조 중첩은 지원하지 않는다. 그 글은 글자 그대로 보인다.
// 어떤 입력도 던지지 않는다. 짝 찾기는 앞으로만 가고, 짝을 한 번 못 찾은 표지 종류는 다시 찾지 않아 입력 길이에 비례한다.

/** 블록. 제목은 단계 1~6, 목록 항목은 인라인 토큰의 배열이다 */
export type Block =
  | {
      readonly type: "heading";
      readonly level: 1 | 2 | 3 | 4 | 5 | 6;
      readonly inlines: readonly Inline[];
    }
  | { readonly type: "paragraph"; readonly inlines: readonly Inline[] }
  | { readonly type: "bullets"; readonly items: readonly (readonly Inline[])[] }
  | {
      readonly type: "numbered";
      readonly start: number;
      readonly items: readonly (readonly Inline[])[];
    }
  | { readonly type: "code"; readonly text: string }
  | { readonly type: "rule" };

/** 인라인 토큰. 굵게와 기울임은 안에 다시 표지를 풀지 않은 글을 담는다 */
export type Inline =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "strong"; readonly text: string }
  | { readonly type: "em"; readonly text: string }
  | { readonly type: "code"; readonly text: string };

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
const BULLET = /^\s*[-*+]\s+(.*)$/u;
const ORDERED = /^\s*(\d{1,9})[.)]\s+(.*)$/u;
const NON_SPACE = /\S/u;
const WORD = /[\p{L}\p{N}]/u;

/** 글을 블록으로 나눈다. 빈 글은 블록이 없다 */
export function parseMarkdown(text: string): Block[] {
  const lines = text.split(/\r\n|\r|\n/u);
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lineAt(lines, index);
    const fence = fenceOf(line);
    const heading = headingOf(line);
    const item = listItemOf(line);
    if (line.trim() === "") {
      index += 1;
    } else if (fence !== null) {
      // 닫는 줄이 없으면 글 끝까지가 코드다
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !closesFence(lineAt(lines, index), fence)) {
        body.push(lineAt(lines, index));
        index += 1;
      }
      index += 1;
      blocks.push({ type: "code", text: body.join("\n") });
    } else if (heading !== null) {
      blocks.push({ type: "heading", level: heading.level, inlines: parseInline(heading.text) });
      index += 1;
    } else if (isRule(line)) {
      blocks.push({ type: "rule" });
      index += 1;
    } else if (item !== null) {
      const list = readList(lines, index, item);
      blocks.push(list.block);
      index = list.next;
    } else {
      const para: string[] = [line.trim()];
      index += 1;
      while (index < lines.length && continuesParagraph(lineAt(lines, index))) {
        para.push(lineAt(lines, index).trim());
        index += 1;
      }
      blocks.push({ type: "paragraph", inlines: parseInline(para.join("\n")) });
    }
  }
  return blocks;
}

/** 한 글의 인라인 표지를 토큰으로 나눈다. 코드 `…`를 먼저 떼고, 남은 조각에서 굵게·기울임·링크를 찾는다 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let start = 0;
  let tick = text.indexOf("`");
  while (tick !== -1) {
    const run = runLength(text, tick, "`");
    if (run > 1) {
      // 두 개 이상의 백틱은 코드 표지가 아니라 글이다
      tick = text.indexOf("`", tick + run);
      continue;
    }
    const close = text.indexOf("`", tick + 1);
    if (close === -1) break;
    appendSpans(out, text.slice(start, tick));
    appendInline(out, { type: "code", text: text.slice(tick + 1, close) });
    start = close + 1;
    tick = text.indexOf("`", start);
  }
  appendSpans(out, text.slice(start));
  return out;
}

/** 줄 묶음 끝에서 아직 닫히지 않은 펜스의 표지(``` 같은 글). 모두 닫혔으면 null */
export function openFenceAfter(lines: readonly string[]): string | null {
  let open: string | null = null;
  for (const line of lines) {
    if (open === null) open = fenceOf(line);
    else if (closesFence(line, open)) open = null;
  }
  return open;
}

/** 줄이 펜스 표지 `fence`를 닫는 줄인가 */
export function closesFence(line: string, fence: string): boolean {
  const body = line.trim();
  return body.length >= fence.length && body === fence.charAt(0).repeat(body.length);
}

// ---------- 블록 내부 ----------

type Hit = { readonly token: Inline; readonly end: number };
type SpanMark = "strong" | "star" | "underscore" | "link";
type SpanState = { readonly off: Set<SpanMark>; linkBlockedUntil: number };
type ListItem = { readonly ordered: boolean; readonly number: number; readonly text: string };

function lineAt(lines: readonly string[], index: number): string {
  return lines[index] ?? "";
}

/** 펜스 줄이면 그 표지(같은 글자가 3개 이상 이어진 것), 아니면 null. 백틱 펜스의 정보 글에는 백틱이 없어야 한다 */
function fenceOf(line: string): string | null {
  const body = line.trimStart();
  const ch = body.charAt(0);
  if (ch !== "`" && ch !== "~") return null;
  const run = runLength(body, 0, ch);
  if (run < 3) return null;
  if (ch === "`" && body.slice(run).includes("`")) return null;
  return body.slice(0, run);
}

/** ATX 제목. `#` 뒤에 빈칸이 있거나 줄이 끝나야 하고, 닫는 `#`은 뗀다 */
function headingOf(
  line: string,
): { readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly text: string } | null {
  const body = line.trimStart();
  let hashes = 0;
  while (body.charAt(hashes) === "#") hashes += 1;
  const level = HEADING_LEVELS[hashes - 1];
  if (level === undefined) return null;
  const rest = body.slice(hashes);
  if (rest !== "" && !/^\s/u.test(rest)) return null;
  return { level, text: withoutClosingHashes(rest.trim()) };
}

/** "제목 ##"의 닫는 `#`을 뗀다. "C#"처럼 빈칸 없이 붙은 `#`은 글이다 */
function withoutClosingHashes(text: string): string {
  let end = text.length;
  while (end > 0 && text.charAt(end - 1) === "#") end -= 1;
  if (end === text.length) return text;
  if (end > 0 && !/\s/u.test(text.charAt(end - 1))) return text;
  return text.slice(0, end).trimEnd();
}

/** 구분선: 같은 글자(-, *, _)가 빈칸을 섞어 3개 이상 */
function isRule(line: string): boolean {
  const body = line.replaceAll(/\s/gu, "");
  const ch = body.charAt(0);
  return (
    body.length >= 3 && (ch === "-" || ch === "*" || ch === "_") && body === ch.repeat(body.length)
  );
}

function listItemOf(line: string): ListItem | null {
  const bullet = BULLET.exec(line);
  if (bullet !== null) return { ordered: false, number: 0, text: bullet[1] ?? "" };
  const ordered = ORDERED.exec(line);
  if (ordered === null) return null;
  return { ordered: true, number: Number(ordered[1] ?? "0"), text: ordered[2] ?? "" };
}

/** 문단이나 목록 항목이 이 줄을 이어 받는가. 빈 줄, 그리고 다른 블록을 여는 줄은 아니다 */
function continuesParagraph(line: string): boolean {
  return (
    line.trim() !== "" &&
    fenceOf(line) === null &&
    headingOf(line) === null &&
    !isRule(line) &&
    listItemOf(line) === null
  );
}

/** 목록 하나를 읽는다. 항목 뒤의 이어지는 줄은 그 항목에 붙고, 빈 줄 뒤라도 같은 종류의 항목이면 같은 목록이다 */
function readList(
  lines: readonly string[],
  from: number,
  head: ListItem,
): { readonly block: Block; readonly next: number } {
  const groups: string[][] = [];
  let item: ListItem = head;
  let cursor = from;
  for (;;) {
    const group = [item.text];
    cursor += 1;
    while (cursor < lines.length && continuesParagraph(lineAt(lines, cursor))) {
      group.push(lineAt(lines, cursor).trim());
      cursor += 1;
    }
    groups.push(group);
    const next = listItemAfter(lines, cursor, head.ordered);
    if (next === null) break;
    item = next.item;
    cursor = next.line;
  }
  const items = groups.map((group) => parseInline(group.join("\n")));
  const block: Block = head.ordered
    ? { type: "numbered", start: head.number, items }
    : { type: "bullets", items };
  return { block, next: cursor };
}

/** 빈 줄을 건너뛰고 다음 줄이 같은 종류의 항목이면 그 항목과 줄 번호를 준다 */
function listItemAfter(
  lines: readonly string[],
  from: number,
  ordered: boolean,
): { readonly item: ListItem; readonly line: number } | null {
  let line = from;
  while (line < lines.length && lineAt(lines, line).trim() === "") line += 1;
  if (line >= lines.length) return null;
  const item = listItemOf(lineAt(lines, line));
  return item !== null && item.ordered === ordered ? { item, line } : null;
}

/** `from`에서 시작하는 같은 글자의 연속 길이 */
function runLength(text: string, from: number, ch: string): number {
  let end = from;
  while (text.charAt(end) === ch) end += 1;
  return end - from;
}

// ---------- 인라인 내부 ----------

/** 코드 조각이 없는 글의 굵게·기울임·링크를 out에 더한다 */
function appendSpans(out: Inline[], text: string): void {
  const state: SpanState = { off: new Set<SpanMark>(), linkBlockedUntil: -1 };
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const hit = matchAt(text, index, state);
    if (hit === null) {
      index += 1;
      continue;
    }
    appendText(out, text.slice(start, index));
    appendInline(out, hit.token);
    index = hit.end;
    start = index;
  }
  appendText(out, text.slice(start));
}

function matchAt(text: string, index: number, state: SpanState): Hit | null {
  const ch = text.charAt(index);
  if (ch === "*" && text.charAt(index + 1) === "*") return matchStrong(text, index, state);
  if (ch === "*" || ch === "_") return matchEmphasis(text, index, ch, state);
  if (ch === "[") return matchLink(text, index, state);
  return null;
}

/** `**굵게**`. 여는 자리 뒤는 빈칸이 아니어야 하고, 닫는 `**` 앞은 빈칸이 아니어야 한다 */
function matchStrong(text: string, index: number, state: SpanState): Hit | null {
  if (state.off.has("strong") || !isNonSpaceAt(text, index + 2)) return null;
  const close = findClose(text, index + 3, "**", (at) => isNonSpaceAt(text, at - 1));
  if (close === -1) {
    state.off.add("strong");
    return null;
  }
  return { token: { type: "strong", text: text.slice(index + 2, close) }, end: close + 2 };
}

/** `*기울임*`, `_기울임_`. `_`는 글자 사이에 있으면 기울임이 아니다(snake_case) */
function matchEmphasis(text: string, index: number, mark: "*" | "_", state: SpanState): Hit | null {
  const key: SpanMark = mark === "*" ? "star" : "underscore";
  if (state.off.has(key)) return null;
  const before = text.charAt(index - 1);
  const after = text.charAt(index + 1);
  const opens =
    mark === "*"
      ? after !== "*" && before !== "*" && NON_SPACE.test(after)
      : NON_SPACE.test(after) && !WORD.test(before);
  if (!opens) return null;
  const close = findClose(text, index + 2, mark, (at) => isEmphasisCloser(text, at, mark));
  if (close === -1) {
    state.off.add(key);
    return null;
  }
  return { token: { type: "em", text: text.slice(index + 1, close) }, end: close + 1 };
}

function isEmphasisCloser(text: string, at: number, mark: "*" | "_"): boolean {
  if (!isNonSpaceAt(text, at - 1)) return false;
  if (mark === "*") return text.charAt(at - 1) !== "*" && text.charAt(at + 1) !== "*";
  return !WORD.test(text.charAt(at + 1));
}

/** `[글](주소)`는 글만 토큰이 된다. 주소는 어디에도 남기지 않는다 */
function matchLink(text: string, index: number, state: SpanState): Hit | null {
  if (state.off.has("link") || index < state.linkBlockedUntil) return null;
  const close = text.indexOf("]", index + 1);
  if (close === -1) {
    state.off.add("link");
    return null;
  }
  // 여는 자리가 close 전이면 모두 같은 `]`를 만나므로 같은 이유로 실패한다
  if (text.charAt(close + 1) !== "(") {
    state.linkBlockedUntil = close;
    return null;
  }
  const end = text.indexOf(")", close + 2);
  if (end === -1) {
    state.off.add("link");
    return null;
  }
  const label = text.slice(index + 1, close);
  if (label === "") return null;
  return { token: { type: "text", text: label }, end: end + 1 };
}

/** from부터 mark가 나오는 자리를 차례로 보고 ok가 참인 첫 자리를 준다. 없으면 -1 */
function findClose(text: string, from: number, mark: string, ok: (at: number) => boolean): number {
  let at = text.indexOf(mark, from);
  while (at !== -1 && !ok(at)) at = text.indexOf(mark, at + 1);
  return at;
}

function isNonSpaceAt(text: string, index: number): boolean {
  return index >= 0 && index < text.length && NON_SPACE.test(text.charAt(index));
}

/** 글 토큰은 앞의 글 토큰과 합치고, 빈 글은 넣지 않는다 */
function appendText(out: Inline[], text: string): void {
  if (text !== "") appendInline(out, { type: "text", text });
}

function appendInline(out: Inline[], token: Inline): void {
  const last = out.at(-1);
  if (token.type === "text") {
    if (token.text === "") return;
    if (last?.type === "text") {
      out[out.length - 1] = { type: "text", text: last.text + token.text };
      return;
    }
  }
  out.push(token);
}
