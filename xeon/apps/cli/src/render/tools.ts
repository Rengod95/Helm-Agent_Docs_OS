import type { ImageContent, TextContent } from "@xeon/contracts/conversation";
import { displayWidth, truncateToWidth } from "./width.ts";

// L4.cli.spec §3.5, §4.5. 도구 결과 3채널 표시 규칙.
//   UI용(details): 우선 사용. BUILTIN_TOOL_RENDERERS에 그 도구가 있고 render가 줄을 돌려주면 그 줄을 쓴다.
//   모델용(content): UI용이 없거나 렌더러가 undefined를 돌려주면 텍스트 파트를 앞 20줄까지, 이미지 파트는 `[image <mimeType>]`.
//   구조화(structuredContent): 텍스트 모드에서 보이지 않는다.
// details의 모양은 도구 쪽 spec(L2.workspace)이 정한다. 여기서는 모양을 가정하지 않고 맞지 않으면 undefined로 넘긴다 [가정].

export interface ToolResultRenderer {
  readonly toolName: string;
  /** details(UI 채널)를 줄로 바꾼다. 모양이 맞지 않으면 undefined를 돌려 일반 규칙으로 넘긴다. */
  render(details: unknown, width: number): readonly string[] | undefined;
}

/** 모델용 채널을 보일 때 앞에서부터 보이는 줄 수 */
export const CONTENT_LINE_LIMIT = 20;

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function textLines(text: string): string[] {
  return text.length === 0 ? [] : text.split("\n");
}

function clip(line: string, width: number): string {
  if (width <= 1 || displayWidth(line) <= width) return line;
  return truncateToWidth(line, width);
}

function numberField(record: Readonly<Record<string, unknown>>, name: string): number | undefined {
  const value = record[name];
  return typeof value === "number" ? value : undefined;
}

function stringField(record: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = record[name];
  return typeof value === "string" ? value : undefined;
}

const readRenderer: ToolResultRenderer = {
  toolName: "read",
  render(details, width) {
    const record = asRecord(details);
    const path = record === undefined ? undefined : stringField(record, "path");
    if (record === undefined || path === undefined) return undefined;
    const kind = stringField(record, "kind");
    const text = stringField(record, "text");
    if (kind === "image") return [clip(`${path} (image)`, width)];
    const total = text === undefined ? 0 : textLines(text).length;
    return [clip(`${path} (${total}줄)`, width)];
  },
};

const lsRenderer: ToolResultRenderer = {
  toolName: "ls",
  render(details, width) {
    const record = asRecord(details);
    const entries = record?.["entries"];
    if (!Array.isArray(entries)) return undefined;
    const lines: string[] = [];
    for (const entry of entries) {
      const item = asRecord(entry);
      const name = item === undefined ? undefined : stringField(item, "name");
      if (item === undefined || name === undefined) return undefined;
      lines.push(clip(stringField(item, "kind") === "directory" ? `${name}/` : name, width));
    }
    return lines;
  },
};

const bashRenderer: ToolResultRenderer = {
  toolName: "bash",
  render(details, width) {
    const record = asRecord(details);
    const exitCode = record === undefined ? undefined : numberField(record, "exitCode");
    if (record === undefined || exitCode === undefined) return undefined;
    const durationMs = numberField(record, "durationMs");
    const head =
      durationMs === undefined ? `exit ${exitCode}` : `exit ${exitCode} (${durationMs}ms)`;
    const output = stringField(record, "output");
    const body = output === undefined ? [] : textLines(output).slice(-CONTENT_LINE_LIMIT);
    return [head, ...body.map((line) => clip(line, width))];
  },
};

export const BUILTIN_TOOL_RENDERERS: readonly ToolResultRenderer[] = [
  readRenderer,
  lsRenderer,
  bashRenderer,
];

/** 모델용 채널(content)의 일반 표시. 텍스트는 앞 20줄, 이미지는 한 줄 */
export function contentLines(content: readonly (TextContent | ImageContent)[]): readonly string[] {
  const lines: string[] = [];
  for (const block of content) {
    if (block.type === "image") lines.push(`[image ${block.mimeType}]`);
    else lines.push(...textLines(block.text));
  }
  if (lines.length <= CONTENT_LINE_LIMIT) return lines;
  const hidden = lines.length - CONTENT_LINE_LIMIT;
  return [...lines.slice(0, CONTENT_LINE_LIMIT), `… (${hidden}줄 더 있음)`];
}

/** details가 있고 렌더러가 줄을 돌려주면 그 줄, 아니면 content의 앞 20줄 */
export function resultLines(
  toolName: string,
  details: unknown,
  content: readonly (TextContent | ImageContent)[],
  width: number,
): readonly string[] {
  if (details !== null && details !== undefined) {
    const renderer = BUILTIN_TOOL_RENDERERS.find((candidate) => candidate.toolName === toolName);
    const rendered = renderer?.render(details, width);
    if (rendered !== undefined) return rendered;
  }
  return contentLines(content);
}
