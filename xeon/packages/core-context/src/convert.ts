import type {
  AgentMessage,
  ItemRecord,
  Message,
  UserMessage,
  XeonCustomMessage,
} from "@xeon/contracts/conversation";

// L1.context.spec §4.1 3번. ItemRecord, 컴팩션 요약, 떠난 가지 요약을 모델에 보낼 Message로 바꾼다.
// 요약 본문 형식은 pi coding-agent/src/core/messages.ts의 compactionSummary·branchSummary 변환을 그대로 따른다.

export const COMPACTION_SUMMARY_PREFIX =
  "The conversation history before this point was compacted into the following summary:\n\n<summary>\n";
const COMPACTION_SUMMARY_SUFFIX = "\n</summary>";
export const BRANCH_SUMMARY_PREFIX =
  "The following is a summary of a branch that this conversation came back from:\n\n<summary>\n";
const BRANCH_SUMMARY_SUFFIX = "</summary>";

/** custom 메시지는 display와 상관없이 content만 사용자 메시지로 보낸다. details와 customType은 모델에 보내지 않는다 */
export function customToUser(message: XeonCustomMessage): UserMessage {
  return { role: "user", content: message.content, timestamp: message.timestamp };
}

/** thread.compacted의 요약을 사용자 메시지 하나로. timestamp는 컴팩션 이벤트의 recordedAt이라 다시 만들어도 같다 */
export function compactionSummaryMessage(summary: string, timestamp: number): UserMessage {
  return {
    role: "user",
    content: [
      { type: "text", text: COMPACTION_SUMMARY_PREFIX + summary + COMPACTION_SUMMARY_SUFFIX },
    ],
    timestamp,
  };
}

/** thread.branch_summarized의 요약을 그 위치의 사용자 메시지 하나로 */
export function branchSummaryMessage(summary: string, timestamp: number): UserMessage {
  return {
    role: "user",
    content: [{ type: "text", text: BRANCH_SUMMARY_PREFIX + summary + BRANCH_SUMMARY_SUFFIX }],
    timestamp,
  };
}

export function itemToMessage(item: ItemRecord): Message {
  return item.kind === "custom" ? customToUser(item.message) : item.message;
}

/**
 * agent-core AgentLoopConfig.convertToLlm에 넣는 변환. 던지지 않는다(agent-core types.ts 계약).
 * AgentMessage에서 custom을 뺀 나머지는 이미 Message이므로 그대로 둔다
 */
export function convertToLlm(messages: readonly AgentMessage[]): Message[] {
  const converted: Message[] = [];
  for (const message of messages) {
    converted.push(message.role === "custom" ? customToUser(message) : message);
  }
  return converted;
}
