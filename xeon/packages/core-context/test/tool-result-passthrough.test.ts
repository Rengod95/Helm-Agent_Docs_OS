import { expect, test } from "bun:test";
import type {
  AssistantMessage,
  ItemRecord,
  Message,
  ToolResultMessage,
  Usage,
} from "@fresnel/contracts/conversation";
import { assembleOptions, userItem } from "./support/builders.ts";
import { harness } from "./support/harness.ts";
import { valueOf } from "./support/result.ts";

// AGE-77 F-20: 모델이 "도구 결과 안에 <instructions> 블록(슬래시 명령 설명)이 있다"고 말했다. 모델 요청 본문을 만드는 컨텍스트 조립이
// 도구 결과에 아무것도 붙이지 않는다는 것을 값으로 확인한다. 조립이 만든 도구 결과 메시지는 기록된 글과 같고, 어떤 메시지에도 그 표지가 없다.

const usage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const RESULT_TEXT = "line one\nline two\n";

test("the assembled tool result is exactly the recorded text, and nothing in the request carries an instructions block", async () => {
  const h = await harness();
  h.log.append("thread.started", {});
  h.log.append("item.recorded", userItem(h.log, "src 안을 읽어 줘"));
  const callId = h.log.ids.next("itm");
  const call: AssistantMessage = {
    role: "assistant",
    content: [{ type: "toolCall", id: callId, name: "read", arguments: { path: "a.txt" } }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-x",
    usage,
    stopReason: "toolUse",
    timestamp: 2,
  };
  const callRecord: { item: ItemRecord } = {
    item: {
      itemId: h.log.ids.next("itm"),
      status: "completed",
      kind: "assistant",
      message: call,
      partIds: [],
    },
  };
  h.log.append("item.recorded", callRecord);
  const result: ToolResultMessage = {
    role: "toolResult",
    toolCallId: callId,
    toolName: "read",
    content: [{ type: "text", text: RESULT_TEXT }],
    isError: false,
    timestamp: 3,
  };
  const resultRecord: { item: ItemRecord } = {
    item: {
      itemId: h.log.ids.next("itm"),
      status: "completed",
      kind: "toolResult",
      message: result,
      effectId: null,
    },
  };
  h.log.append("item.recorded", resultRecord);

  const out = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  const assembled: Message | undefined = out.messages.find(
    (message) => message.role === "toolResult",
  );
  expect(assembled).toEqual(result);
  const everything = JSON.stringify(out);
  expect(everything).not.toContain("<instructions>");
  expect(everything).not.toContain("system-reminder");
});
