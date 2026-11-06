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

const TRUNCATED_NOTICE = "[fresnel:output_truncated]";

export interface ToolOutputView {
  readonly text: string;
  /** 보인 줄 수 */
  readonly shownLines: number;
  /** 전체 줄 수. 잘리지 않았으면 null */
  readonly totalLines: number | null;
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

export function toolOutputOf(
  content: string | readonly OutputBlock[],
  details: JsonValue | undefined,
  placeholder: string,
): ToolOutputView {
  const parts: string[] = [];
  if (typeof content === "string") parts.push(content);
  else {
    for (const block of content) {
      if (typeof block.text === "string") {
        // 엔진의 영어 안내 줄은 화면 문구("N줄 중 M줄만 보여요")로 대신한다
        if (block.text.startsWith(TRUNCATED_NOTICE)) continue;
        parts.push(block.text);
      } else if (block.type === "image") parts.push(placeholder);
    }
  }
  const full = parts.join("\n");
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
  if (!cut && engineTotal === null) return { text, shownLines, totalLines: null };
  const total = Math.max(engineTotal ?? fullLines, fullLines);
  return { text, shownLines, totalLines: total > shownLines ? total : null };
}
