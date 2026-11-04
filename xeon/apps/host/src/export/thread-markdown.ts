import { assertNever } from "@fresnel/contracts";
import type {
  AssistantMessage,
  ImageContent,
  ItemRecord,
  ItemStatus,
  TextContent,
  ToolCall,
  ToolResultMessage,
} from "@fresnel/contracts/conversation";

// F.wire-settings.spec §3.4.7 [제안]. thread.export의 markdown 본문을 만드는 순수 함수다.
// 입력은 화면 가림을 거친 item이다(호출자가 `maskItemRecord`로 만든다). 이 모듈은 값을 다시 찾거나 가리지 않는다.
// 생각(thinking) 블록과 확장 메시지의 `details`는 내보내지 않는다.

/** 도구 결과 본문의 글자 상한(코드 포인트). 넘는 부분은 표지를 붙이고 줄인다 */
export const TOOL_RESULT_CHAR_LIMIT: number = 2000;

const ROLE_HEADING = {
  user: "User",
  assistant: "Assistant",
  system: "System",
  toolResult: "Tool result",
  custom: "Extension message",
} as const;

const STATUS_LABEL: Readonly<Record<ItemStatus, string | null>> = {
  in_progress: null,
  completed: null,
  failed: "failed",
  interrupted: "interrupted",
};

type Block = TextContent | ImageContent;

/** 한 item의 역할 제목. 가릴 수 없는 item도 종류만으로 제목을 붙인다 */
function roleHeading(kind: ItemRecord["kind"]): string {
  return ROLE_HEADING[kind];
}

/** 제목 줄, 상태 줄(있으면), 본문을 하나의 절로 묶는다. 본문이 비면 표지를 쓴다 */
function section(heading: string, note: string, body: string): string {
  const text = body === "" ? "_(empty)_" : body;
  return `## ${heading}\n\n${note}${text}\n\n`;
}

/** 글 블록 하나. 이미지는 종류와 MIME만 한 줄로 낸다(데이터는 싣지 않는다) */
function blockText(block: Block): string {
  return block.type === "text" ? block.text : `[image: ${block.mimeType}]`;
}

function contentText(content: string | readonly Block[]): string {
  if (typeof content === "string") return content;
  return content.map(blockText).join("\n\n");
}

/** 도구 호출 하나: 이름과 인자 JSON(화면 가림을 거친 값)을 펜스 블록으로 낸다 */
function toolCallText(call: ToolCall): string {
  const args = JSON.stringify(call.arguments, null, 2);
  return `Tool call: \`${call.name}\`\n\n${fenced(args, "json")}`;
}

function assistantText(message: AssistantMessage): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text") parts.push(block.text);
    else if (block.type === "toolCall") parts.push(toolCallText(block));
  }
  if (message.errorMessage !== undefined) parts.push(`error: ${message.errorMessage}`);
  return parts.join("\n\n");
}

/** 도구 결과의 머리 줄. 오류면 표시를 붙인다 */
function toolResultHeading(message: ToolResultMessage): string {
  return `${ROLE_HEADING.toolResult}: ${message.toolName}${message.isError ? " (error)" : ""}`;
}

function toolResultText(message: ToolResultMessage): string {
  const limited = firstCodePoints(contentText(message.content), TOOL_RESULT_CHAR_LIMIT);
  if (limited.text === "") return "_(no result)_";
  const body = fenced(limited.text, "");
  return limited.cut ? `${body}\n\n_(truncated after ${TOOL_RESULT_CHAR_LIMIT} characters)_` : body;
}

/**
 * item 하나의 markdown 절. 화면 가림을 거친 모양을 받는다.
 * 제목은 역할이고, 상태가 완료가 아니면 상태 줄을 더한다.
 */
export function renderItemMarkdown(item: ItemRecord): string {
  const status = STATUS_LABEL[item.status];
  const note = status === null ? "" : `_status: ${status}_\n\n`;
  switch (item.kind) {
    case "user":
      return section(roleHeading("user"), note, contentText(item.message.content));
    case "assistant":
      return section(roleHeading("assistant"), note, assistantText(item.message));
    case "system":
      return section(roleHeading("system"), note, contentText(item.message.content));
    case "toolResult":
      return section(toolResultHeading(item.message), note, toolResultText(item.message));
    case "custom":
      return section(
        `${roleHeading("custom")}: ${item.message.customType}`,
        note,
        contentText(item.message.content),
      );
    default:
      return assertNever(item, "ItemRecord");
  }
}

/** 가릴 수 없어 읽을 수 없는 item의 절. 종류(원본의 `kind`)만 제목에 쓴다 */
export function renderUnreadableMarkdown(kind: ItemRecord["kind"]): string {
  return section(roleHeading(kind), "", "[unreadable item]");
}

/** 문서 머리말: 제목 줄과 대화 ID, 항목 수. `title`은 한 줄로 다듬어 넘긴다 */
export function renderMarkdownHeader(input: {
  readonly title: string;
  readonly threadId: string;
  readonly itemTotal: number;
}): string {
  return `# ${input.title}\n\n- Thread ID: ${input.threadId}\n- Items: ${input.itemTotal}\n\n`;
}

/** 본문을 담는 펜스. 본문 안의 가장 긴 백틱 줄보다 한 개 더 길게 잡는다 */
function fenced(text: string, info: string): string {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(text) + 1));
  return `${fence}${info}\n${text}\n${fence}`;
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  let run = 0;
  for (const ch of text) {
    if (ch === "`") {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  return longest;
}

/** 앞 `limit`개 코드 포인트와, 그 뒤에 글이 더 있었는지 */
function firstCodePoints(
  text: string,
  limit: number,
): { readonly text: string; readonly cut: boolean } {
  let count = 0;
  let end = 0;
  for (const ch of text) {
    if (count === limit) break;
    count += 1;
    end += ch.length;
  }
  return { text: text.slice(0, end), cut: end < text.length };
}
