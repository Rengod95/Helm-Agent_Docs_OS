import type { JsonValue } from "@fresnel/contracts/conversation";

/** 본문 조각. item-view의 `Block`과 같이 느슨하게 받는다 */
export interface OutputBlock {
  readonly type: string;
  readonly text?: string;
}

// 도구 결과 본문을 화면에 얼마나, 어떻게 보일지 정한다(S11, 화면 없이 시험). 길면 줄 수로 자르고 "N줄 중 M줄"을 알린다.
// 엔진이 이미 자른 결과는 호출 결과의 `details.truncation`(`core-tools/src/bound.ts`)으로 전체 줄 수를 받는다.

/** 펼친 출력에 싣는 줄 수. 넘으면 앞부분만 싣는다. 높이는 화면이 따로 묶고 안쪽에서 스크롤한다 */
export const OUTPUT_VIEW_MAX_LINES = 200;
/** 줄 수와 별개로 싣는 글자 수 상한(한 줄이 매우 긴 출력 보호) */
const OUTPUT_VIEW_MAX_CHARS = 20000;

/** 엔진의 잘림 안내 줄. 앞의 것은 옛 기록의 꼴이다 */
function isTruncatedNotice(text: string): boolean {
  return text.startsWith("[fresnel:output_truncated]") || text.startsWith("[Showing lines ");
}

/** 엔진이 앞부분을 뺄 때 글 머리에 붙이는 줄(`workspace.ts` `renderRun`). 경로가 있으면 전체 출력 파일이다 */
const LEADING_OMITTED = /^\[Leading output omitted(?:, full output: ([^\]\n]+))?\]\n?/;

export interface ToolOutputView {
  readonly text: string;
  /** 보인 줄 수 */
  readonly shownLines: number;
  /** 전체 줄 수. 잘리지 않았으면 null */
  readonly totalLines: number | null;
  /** 엔진이 앞부분을 뺐는가(앞부분 생략 줄이 있었다). 그 줄은 글에서 뺐다 */
  readonly leadingOmitted: boolean;
  /** 앞부분 전체 출력의 파일 경로. 경로가 없거나 앞부분을 빼지 않았으면 null */
  readonly fullOutputPath: string | null;
}

function isObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function engineTotalLines(details: JsonValue | undefined): number | null {
  if (!isObject(details)) return null;
  const truncation = details["truncation"];
  if (!isObject(truncation)) return null;
  const total = truncation["totalLines"];
  return typeof total === "number" ? total : null;
}

function lineCount(text: string): number {
  if (text === "") return 0;
  const parts = text.split("\n");
  return parts[parts.length - 1] === "" ? parts.length - 1 : parts.length;
}

const ESC = 0x1b;
const BEL = 0x07;

/**
 * 터미널 제어 순서를 뺀다: CSI(`ESC [` 매개 바이트 뒤 끝 바이트 0x40–0x7E, 색·커서), OSC(`ESC ]` … BEL 또는 `ESC \\`, 창 제목·링크),
 * nF(`ESC ( B`). 그 밖의 ESC는 ESC 하나만 뺀다. 엔진은 명령 결과를 같은 규칙으로 이미 거르지만(core-workspace P21) 실행 중 출력 꼬리와
 * 엔진이 거르지 않는 도구(MCP 등) 결과는 여기서 거른다. 색은 그리지 않고 글만 남긴다(desktop-ux C-15의 ANSI 색은 [미결]이라 기본값으로 뺀다, chatQa).
 * 빼지 않으면 ESC는 보이지 않고 `[31m` 같은 꼬리만 출력에 남는다
 */
export function stripAnsi(text: string): string {
  if (!text.includes(String.fromCharCode(ESC))) return text;
  const kept: string[] = [];
  let from = 0;
  let at = 0;
  while (at < text.length) {
    if (text.charCodeAt(at) !== ESC) {
      at += 1;
      continue;
    }
    kept.push(text.slice(from, at));
    const next = text[at + 1];
    let end = at + 2;
    if (next === "[") {
      while (end < text.length) {
        const code = text.charCodeAt(end);
        end += 1;
        if (code >= 0x40 && code <= 0x7e) break;
      }
    } else if (next === "]") {
      while (end < text.length) {
        const code = text.charCodeAt(end);
        if (code === BEL) {
          end += 1;
          break;
        }
        if (code === ESC && text[end + 1] === "\\") {
          end += 2;
          break;
        }
        end += 1;
      }
    } else if (text.charCodeAt(at + 1) >= 0x20 && text.charCodeAt(at + 1) <= 0x2f) {
      // nF 순서(`ESC ( B` 글자 모음 고르기): 중간 바이트 0x20–0x2F 뒤 끝 바이트 하나
      end = at + 1;
      while (end < text.length && text.charCodeAt(end) >= 0x20 && text.charCodeAt(end) <= 0x2f) {
        end += 1;
      }
      end = Math.min(end + 1, text.length);
    } else {
      // 그 밖의 ESC는 ESC 하나만 뺀다(엔진 `sanitizeOutput`, core-workspace P21과 같은 규칙)
      end = at + 1;
    }
    from = end;
    at = end;
  }
  kept.push(text.slice(from));
  return kept.join("");
}

export function toolOutputOf(
  content: string | readonly OutputBlock[],
  details: JsonValue | undefined,
  placeholder: string,
): ToolOutputView {
  const pieces: string[] = [];
  if (typeof content === "string") pieces.push(content);
  else {
    for (const block of content) {
      if (typeof block.text === "string") {
        // 엔진의 영어 안내 줄은 화면 문구("N줄 중 M줄만 보여요")로 대신한다
        if (isTruncatedNotice(block.text)) continue;
        pieces.push(block.text);
      } else if (block.type === "image") pieces.push(placeholder);
    }
  }
  // 앞부분 생략 줄은 글에서 떼고, 떼었다는 사실과 전체 출력 경로만 남긴다
  const parts: string[] = [];
  let leading: { readonly path: string | null } | null = null;
  for (const piece of pieces) {
    const found = LEADING_OMITTED.exec(piece);
    if (found === null) {
      parts.push(piece);
      continue;
    }
    if (leading === null) leading = { path: found[1] ?? null };
    const rest = piece.slice(found[0].length);
    if (rest !== "") parts.push(rest);
  }
  const full = stripAnsi(parts.join("\n"));
  const engineTotal = engineTotalLines(details);
  const fullLines = lineCount(full);
  let text = full;
  let cut = false;
  const lines = full.split("\n");
  if (lines.length > OUTPUT_VIEW_MAX_LINES) {
    text = lines.slice(0, OUTPUT_VIEW_MAX_LINES).join("\n");
    cut = true;
  }
  if (text.length > OUTPUT_VIEW_MAX_CHARS) {
    text = text.slice(0, OUTPUT_VIEW_MAX_CHARS);
    cut = true;
  }
  const shownLines = lineCount(text);
  const omission = { leadingOmitted: leading !== null, fullOutputPath: leading?.path ?? null };
  if (!cut && engineTotal === null) return { text, shownLines, totalLines: null, ...omission };
  const total = Math.max(engineTotal ?? fullLines, fullLines);
  return {
    text,
    shownLines,
    totalLines: total > shownLines ? total : null,
    ...omission,
  };
}
