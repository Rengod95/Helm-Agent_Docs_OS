import type { ItemRecord, Message, UserMessage } from "@xeon/contracts/conversation";

// L1.context.spec §4.10 컴팩션 뒤 최근 읽은 파일 재주입(M3-REQ-86). 요약에 접힌 범위의 `read` 결과 가운데 마지막에 읽은 파일을
// `l1.context.reinjectRecentFiles`개까지 요약 뒤에 다시 놓는다. 도구를 다시 실행하지 않고 기록된 결과 원문을 쓴다.

/** 파일 하나의 재주입 본문 상한(글자). 넘으면 앞부분만 남기고 표지를 붙인다 [제안] */
export const RECENT_FILE_MAX_CHARS = 16_000;

const READ_TOOL = "read";
const WRITE_TOOLS: ReadonlySet<string> = new Set(["write", "edit"]);

interface ReadEntry {
  readonly text: string;
  readonly timestamp: number;
}

function pathOf(args: Readonly<Record<string, unknown>>): string | undefined {
  const path = args["path"];
  return typeof path === "string" && path.length > 0 ? path : undefined;
}

function textOf(message: Extract<Message, { readonly role: "toolResult" }>): string {
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

function clipped(text: string): string {
  if (text.length <= RECENT_FILE_MAX_CHARS) return text;
  const omitted = text.length - RECENT_FILE_MAX_CHARS;
  return `${text.slice(0, RECENT_FILE_MAX_CHARS)}\n[... ${String(omitted)} more characters omitted]`;
}

/**
 * 접힌 범위(`items[0, firstKeptIndex)`)에서 마지막에 읽은 파일 `count`개의 본문 메시지를 읽은 순서대로 돌려준다.
 * 그 뒤 고쳐진 파일, 그리고 남은 범위(`firstKeptIndex` 이후)에서 다시 읽거나 고친 파일은 이미 모델이 보거나 낡았으므로 뺀다
 */
export function recentFileMessages(
  items: readonly (ItemRecord | undefined)[],
  firstKeptIndex: number,
  count: number,
): UserMessage[] {
  if (count <= 0) return [];
  const calls = new Map<string, { readonly tool: string; readonly path: string }>();
  const reads = new Map<string, ReadEntry>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined || item.status === "in_progress") continue;
    const inKept = index >= firstKeptIndex;
    if (item.kind === "assistant") {
      for (const block of item.message.content) {
        if (block.type !== "toolCall") continue;
        const path = pathOf(block.arguments);
        if (path === undefined) continue;
        if (block.name === READ_TOOL || WRITE_TOOLS.has(block.name)) {
          calls.set(block.id, { tool: block.name, path });
          // 남은 범위의 호출은 모델이 이미 보고 있다
          if (inKept) reads.delete(path);
        }
      }
      continue;
    }
    if (item.kind !== "toolResult" || item.message.isError) continue;
    const call = calls.get(item.message.toolCallId);
    if (call === undefined) continue;
    if (WRITE_TOOLS.has(call.tool)) {
      reads.delete(call.path);
    } else if (!inKept) {
      // 다시 읽으면 순서가 마지막으로 옮겨 간다
      reads.delete(call.path);
      reads.set(call.path, { text: textOf(item.message), timestamp: item.message.timestamp });
    }
  }
  return [...reads].slice(-count).map(([path, read]) => ({
    role: "user",
    content: [
      {
        type: "text",
        text: `[File re-injected after compaction: ${path}]\n${clipped(read.text)}`,
      },
    ],
    timestamp: read.timestamp,
  }));
}
