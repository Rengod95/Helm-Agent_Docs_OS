import { applyRanges } from "@fresnel/contracts/conversation";
import type { ItemId, ItemRecord, ThreadId } from "@fresnel/contracts/conversation";
import { WIRE_LIMITS, type WireParams } from "@fresnel/contracts/wire";
import type { DisplayMaskPort } from "../display-mask.ts";
import { renderItemMarkdown, renderUnreadableMarkdown } from "./thread-markdown.ts";

// F.wire-settings.spec §3.4.7 [제안]. thread.export의 쪽 나누기와 파일 이름을 맡는 순수 함수다.
// 쪽의 본문은 item을 하나씩 이어 붙여 만든다. 쪽 예산(UTF-8 바이트)을 넘지 않게 item 경계에서 끊고,
// item 하나가 예산보다 크면 markdown은 앞부분만 싣고 표지를 붙이며 json은 생략 표지 객체로 바꾼다.
// 화면 가림은 호출자가 `reveal`로 한다. 이 모듈은 값을 보지 않는다.

/** 쪽 하나의 본문 예산(UTF-8 바이트). 프레임 한도 1 MiB에서 응답 뼈대의 여유 64 KiB를 뺀 값이다(thread.read의 예산과 같은 계산) */
export const THREAD_EXPORT_BUDGET_BYTES: number = WIRE_LIMITS.maxFrameBytes - 64 * 1024;

export type ThreadExportFormat = WireParams<"thread.export">["format"];

const encoder = new TextEncoder();
const CUT_NOTE = "_(item shortened: response size limit reached)_\n\n";

/** 파일 이름 줄기의 상한(UTF-16 단위). `.json`을 붙여도 스키마의 200자 안에 든다 */
const STEM_MAX_UNITS = 120;
const UNSAFE_NAME_CHARS: ReadonlySet<string> = new Set([
  "\\",
  "/",
  ":",
  "*",
  "?",
  '"',
  "<",
  ">",
  "|",
  "[",
  "]",
]);

export interface ExportPageRequest {
  readonly format: ThreadExportFormat;
  /** 가지 전체. 오래된 것부터 정렬되어 있다 */
  readonly items: readonly ItemRecord[];
  /** 이 쪽이 시작하는 색인(`after` 다음 item). 첫 쪽이면 0 */
  readonly start: number;
  /** 첫 쪽(`after` 없음)이면 참이다. 머리말(markdown)이나 여는 `[`(json)을 싣는다 */
  readonly leading: boolean;
  /** markdown 머리말. `leading`일 때만 싣는다 */
  readonly header: string;
  /** item을 화면 가림을 거친 모양으로 바꾼다. 가릴 수 없으면 null이다 */
  readonly reveal: (item: ItemRecord) => ItemRecord | null;
  readonly budgetBytes: number;
}

export interface ExportPage {
  readonly chunk: string;
  /** 쪽이 더 있으면 이 쪽의 마지막 item id다(다음 호출의 `after`) */
  readonly next: ItemId | undefined;
  readonly itemCount: number;
}

function bytesOf(text: string): number {
  return encoder.encode(text).byteLength;
}

function codePointBytes(code: number): number {
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/** 바이트 수가 `maxBytes`를 넘지 않는 가장 긴 앞부분. 코드 포인트 경계에서 끊는다 */
function prefixWithinBytes(text: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const ch of text) {
    const size = codePointBytes(ch.codePointAt(0) ?? 0);
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += ch.length;
  }
  return text.slice(0, end);
}

function omittedJson(item: ItemRecord, reason: "unreadable" | "too_large"): string {
  return JSON.stringify({ itemId: item.itemId, omitted: reason });
}

/** item 하나의 본문 조각. JSON은 앞에 `,\n`을 붙이되 문서의 첫 item(색인 0)은 뺀다 */
function pieceOf(
  request: ExportPageRequest,
  index: number,
  item: ItemRecord,
  pieceBudget: number,
): string {
  const shown = request.reveal(item);
  if (request.format === "json") {
    const separator = index === 0 ? "" : ",\n";
    const body = shown === null ? omittedJson(item, "unreadable") : JSON.stringify(shown);
    const piece = `${separator}${body}`;
    return bytesOf(piece) <= pieceBudget ? piece : `${separator}${omittedJson(item, "too_large")}`;
  }
  const body = shown === null ? renderUnreadableMarkdown(item.kind) : renderItemMarkdown(shown);
  return bytesOf(body) <= pieceBudget ? body : cutMarkdown(body, pieceBudget);
}

const BACKTICK = "`";

/** 줄 머리의 백틱 펜스(세 개 이상). 펜스가 아니면 undefined다 */
function fenceOf(line: string): string | undefined {
  let run = 0;
  while (line[run] === BACKTICK) run += 1;
  return run >= 3 ? BACKTICK.repeat(run) : undefined;
}

/** 앞부분에서 펜스가 열린 채 남으면 그 펜스를 닫는 줄을 돌려준다. 닫혀 있으면 빈 문자열이다 */
function openFenceCloser(text: string): string {
  let open: string | undefined;
  for (const line of text.split("\n")) {
    const fence = fenceOf(line);
    if (fence === undefined) continue;
    if (open === undefined) open = fence;
    else if (fence.length >= open.length && line.trim() === fence) open = undefined;
  }
  return open === undefined ? "" : `\n${open}`;
}

/**
 * 예산을 넘는 markdown 절을 앞부분으로 줄이고 표지를 붙인다. 줄인 자리가 펜스 안이면 펜스를 닫아,
 * 뒤에 오는 항목이 코드 블록으로 보이지 않게 한다. 닫는 줄까지 예산에 들도록 앞부분을 조금씩 더 줄인다.
 */
function cutMarkdown(body: string, budget: number): string {
  const note = `\n\n${CUT_NOTE}`;
  const room = budget - bytesOf(note);
  let width = Math.max(0, room);
  let prefix = prefixWithinBytes(body, width);
  let closer = openFenceCloser(prefix);
  while (bytesOf(prefix + closer) > room && width > 0) {
    width = Math.max(0, width - bytesOf(closer) - 1);
    prefix = prefixWithinBytes(body, width);
    closer = openFenceCloser(prefix);
  }
  return `${prefix}${closer}${note}`;
}

/**
 * 쪽 하나를 만든다. 예산 안에서 `start`부터 item을 담는다. 첫 item은 늘 담는다(item 하나는 예산 안에 든다).
 * 머리말(첫 쪽)과 꼬리(마지막 쪽의 JSON `]`)는 예산에서 먼저 뺀다. 꼬리의 자리는 쪽이 끝나지 않아도 남겨 둔다.
 */
export function renderExportPage(request: ExportPageRequest): ExportPage {
  const json = request.format === "json";
  const head = request.leading ? (json ? "[" : request.header) : "";
  const tail = json ? "]" : "";
  const headBytes = bytesOf(head);
  const tailBytes = bytesOf(tail);
  const pieceBudget = request.budgetBytes - headBytes - tailBytes;
  const parts: string[] = [head];
  let used = headBytes;
  let index = request.start;
  let count = 0;
  while (index < request.items.length) {
    const item = request.items[index];
    if (item === undefined) break;
    const piece = pieceOf(request, index, item, pieceBudget);
    const size = bytesOf(piece);
    if (count > 0 && used + size + tailBytes > request.budgetBytes) break;
    parts.push(piece);
    used += size;
    count += 1;
    index += 1;
  }
  const more = index < request.items.length;
  if (!more) parts.push(tail);
  const last = count > 0 ? request.items[index - 1] : undefined;
  return { chunk: parts.join(""), next: more ? last?.itemId : undefined, itemCount: count };
}

/** 제목을 한 줄로 다듬는다. 줄바꿈과 연속 공백은 한 칸이다 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 파일 이름에 쓸 수 없는 글자를 `_`로 바꾸고 앞의 점을 뗀 줄기다. 길이는 `STEM_MAX_UNITS` 이하다 */
function safeStem(text: string): string {
  let replaced = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    replaced += UNSAFE_NAME_CHARS.has(ch) || code < 0x20 || code === 0x7f ? "_" : ch;
  }
  const trimmed = replaced.replace(/^[.\s]+/, "").trim();
  let stem = "";
  for (const ch of trimmed) {
    if (stem.length + ch.length > STEM_MAX_UNITS) break;
    stem += ch;
  }
  return stem;
}

export interface ExportLabel {
  /** 머리말에 쓰는 제목. 가릴 값이 있으면 가린 글이다 */
  readonly shown: string;
  /** 파일 이름 줄기. 제목에 가릴 값이 있거나 쓸 수 없으면 thread id다 */
  readonly stem: string;
}

/**
 * 제목의 표시와 파일 이름 줄기. 제목은 thread.list처럼 그대로 두지 않고 화면 가림 구간을 적용한다.
 * 가릴 값이 있는 제목은 파일 이름에 쓰지 않고 thread id를 쓴다(값이 이름에 새지 않게 한다).
 */
export function exportLabelOf(
  display: DisplayMaskPort,
  threadId: ThreadId,
  title: string | null,
): ExportLabel {
  const raw = title ?? "";
  if (raw.trim() === "") return { shown: threadId, stem: threadId };
  const ranges = display.displayRanges(raw);
  const shown = oneLine(applyRanges(raw, ranges));
  if (ranges.length > 0) return { shown, stem: threadId };
  const stem = safeStem(shown);
  return { shown, stem: stem === "" ? threadId : stem };
}

/** 파일 이름. markdown은 `.md`, json은 `.json`이다 */
export function exportFileName(stem: string, format: ThreadExportFormat): string {
  return `${stem}.${format === "markdown" ? "md" : "json"}`;
}
