import { describe, expect, test } from "bun:test";
import type {
  AssistantMessage,
  JsonObject,
  ItemRecord,
  ToolResultMessage,
  Usage,
} from "@fresnel/contracts/conversation";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import {
  SKILL_BODY_MAX_CHARS,
  SKILL_REINJECT_COUNT,
  skillBodyMessages,
} from "../src/skill-bodies.ts";

// L1.context.spec §4.10 컴팩션 뒤 호출된 스킬 본문 재주입(C-11). 접힌 범위의 `skill_view` 결과를 요약 뒤에 다시 놓는다.

const ids = fixedIdFactory(7000);
const usage: Usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** 호출 item과 결과 item 한 쌍 */
function call(
  tool: string,
  args: JsonObject,
  text: string,
  isError = false,
): readonly ItemRecord[] {
  const callId = ids.next("itm");
  const assistant: AssistantMessage = {
    role: "assistant",
    content: [{ type: "toolCall", id: callId, name: tool, arguments: args }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-x",
    usage,
    stopReason: "toolUse",
    timestamp: 2,
  };
  const result: ToolResultMessage = {
    role: "toolResult",
    toolCallId: callId,
    toolName: tool,
    content: [{ type: "text", text }],
    isError,
    timestamp: 3,
  };
  return [
    {
      itemId: ids.next("itm"),
      status: "completed",
      kind: "assistant",
      message: assistant,
      partIds: [],
    },
    {
      itemId: ids.next("itm"),
      status: "completed",
      kind: "toolResult",
      message: result,
      effectId: null,
    },
  ];
}

function texts(items: readonly ItemRecord[], firstKept: number): string[] {
  return skillBodyMessages(items, firstKept).map((message) => {
    if (typeof message.content === "string") return message.content;
    return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  });
}

const MARK = "[Skill re-injected after compaction:";

describe("skill body re-injection after compaction", () => {
  test("a skill read in the folded range comes back as a user message with its body", () => {
    const items = [
      ...call("skill_view", { name: "deploy" }, "DEPLOY steps"),
      ...call("read", { path: "x" }, "x"),
    ];
    expect(texts(items, items.length)).toEqual([`${MARK} deploy]\nDEPLOY steps`]);
    expect(skillBodyMessages(items, items.length).map((message) => message.role)).toEqual(["user"]);
  });

  test("a skill read again in the kept range is not re-injected", () => {
    const items = [
      ...call("skill_view", { name: "a" }, "A body"),
      ...call("skill_view", { name: "b" }, "B body"),
      ...call("skill_view", { name: "a" }, "A again"),
    ];
    // 앞 두 쌍(4 item)이 접힌 범위다
    expect(texts(items, 4)).toEqual([`${MARK} b]\nB body`]);
  });

  test("a skill edited with skill_manage after it was read is dropped", () => {
    const items = [
      ...call("skill_view", { name: "a" }, "A old"),
      ...call("skill_view", { name: "b" }, "B body"),
      ...call("skill_manage", { action: "edit", name: "a" }, "ok"),
    ];
    expect(texts(items, items.length)).toEqual([`${MARK} b]\nB body`]);
  });

  test("a support file is a separate entry from the skill body, and reading again moves it last", () => {
    const items = [
      ...call("skill_view", { name: "a" }, "A body"),
      ...call("skill_view", { name: "a", file: "notes.md" }, "NOTES"),
      ...call("skill_view", { name: "a" }, "A body v2"),
    ];
    expect(texts(items, items.length)).toEqual([`${MARK} a]\nNOTES`, `${MARK} a]\nA body v2`]);
  });

  test("errored results are skipped and only the last five skills are kept", () => {
    const items = [
      ...call("skill_view", { name: "bad" }, "not found", true),
      ...["s1", "s2", "s3", "s4", "s5", "s6"].flatMap((name) =>
        call("skill_view", { name }, `${name} body`),
      ),
    ];
    expect(SKILL_REINJECT_COUNT).toBe(5);
    expect(texts(items, items.length)).toEqual(
      ["s2", "s3", "s4", "s5", "s6"].map((name) => `${MARK} ${name}]\n${name} body`),
    );
  });

  test("a body longer than the cap is clipped with the omitted-characters marker", () => {
    const body = `${"L".repeat(SKILL_BODY_MAX_CHARS)}${"T".repeat(40)}`;
    const items = call("skill_view", { name: "big" }, body);
    expect(texts(items, items.length)).toEqual([
      `${MARK} big]\n${"L".repeat(SKILL_BODY_MAX_CHARS)}\n[... 40 more characters omitted]`,
    ]);
  });
});
