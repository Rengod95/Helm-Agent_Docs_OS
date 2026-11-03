import type { ItemRecord, Message, UserMessage } from "@fresnel/contracts/conversation";

// L1.context.spec §4.10 컴팩션 뒤 호출된 스킬 본문 재주입(C-11). 요약에 접힌 범위에서 모델이 `skill_view`로 읽은 스킬 본문을
// 최근에 읽은 순서대로 `SKILL_REINJECT_COUNT`개까지 요약 뒤에 다시 놓는다. 도구를 다시 실행하지 않고 기록된 결과 원문을 쓴다.
// 스킬 색인 블록은 `knowledge.context`(§4.9a)가, 최근 읽은 파일은 `recent-files.ts`가 맡고 이 파일은 읽은 스킬 본문만 맡는다.

/** 재주입할 스킬 본문의 최대 개수 [제안: Claude Code의 스킬 본문 상한을 개수로 옮긴 값] */
export const SKILL_REINJECT_COUNT = 5;
/** 스킬 본문 하나의 재주입 상한(글자). 넘으면 앞부분만 남기고 표지를 붙인다 [제안] */
export const SKILL_BODY_MAX_CHARS = 16_000;

const VIEW_TOOL = "skill_view";
const MANAGE_TOOL = "skill_manage";

interface ViewEntry {
  readonly name: string;
  readonly text: string;
  readonly timestamp: number;
}

function stringArg(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function textOf(message: Extract<Message, { readonly role: "toolResult" }>): string {
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

function clipped(text: string): string {
  if (text.length <= SKILL_BODY_MAX_CHARS) return text;
  const omitted = text.length - SKILL_BODY_MAX_CHARS;
  return `${text.slice(0, SKILL_BODY_MAX_CHARS)}\n[... ${String(omitted)} more characters omitted]`;
}

/**
 * 접힌 범위(`items[0, firstKeptIndex)`)에서 마지막에 읽은 스킬 본문 메시지를 읽은 순서대로 돌려준다. 같은 스킬(이름과 지원 파일)을 다시 읽으면
 * 마지막으로 옮겨 간다. 그 뒤 `skill_manage`로 고쳐진 스킬, 그리고 남은 범위(`firstKeptIndex` 이후)에서 다시 읽거나 고친 스킬은 이미 모델이 보거나 낡았으므로 뺀다
 */
export function skillBodyMessages(
  items: readonly (ItemRecord | undefined)[],
  firstKeptIndex: number,
): UserMessage[] {
  const calls = new Map<
    string,
    { readonly tool: string; readonly name: string; readonly key: string }
  >();
  const views = new Map<string, ViewEntry>();
  const dropSkill = (name: string): void => {
    for (const [key, entry] of views) if (entry.name === name) views.delete(key);
  };
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined || item.status === "in_progress") continue;
    const inKept = index >= firstKeptIndex;
    if (item.kind === "assistant") {
      for (const block of item.message.content) {
        if (block.type !== "toolCall") continue;
        if (block.name !== VIEW_TOOL && block.name !== MANAGE_TOOL) continue;
        const name = stringArg(block.arguments, "name");
        if (name === undefined) continue;
        const key = `${name}\u0000${stringArg(block.arguments, "file") ?? ""}`;
        calls.set(block.id, { tool: block.name, name, key });
        // 남은 범위의 호출은 모델이 이미 보고 있다
        if (inKept) views.delete(key);
      }
      continue;
    }
    if (item.kind !== "toolResult" || item.message.isError) continue;
    const call = calls.get(item.message.toolCallId);
    if (call === undefined) continue;
    if (call.tool === MANAGE_TOOL) {
      dropSkill(call.name);
    } else if (!inKept) {
      views.delete(call.key);
      views.set(call.key, {
        name: call.name,
        text: textOf(item.message),
        timestamp: item.message.timestamp,
      });
    }
  }
  return [...views.values()].slice(-SKILL_REINJECT_COUNT).map((view) => ({
    role: "user",
    content: [
      {
        type: "text",
        text: `[Skill re-injected after compaction: ${view.name}]\n${clipped(view.text)}`,
      },
    ],
    timestamp: view.timestamp,
  }));
}
