import { assertNever } from "@xeon/contracts";
import type { AssistantMessage, AssistantMessageEvent, StepId } from "@xeon/contracts/conversation";

// L1.loop.spec §3.3 도구 호출 id 염. 제공자가 응답마다 같은 id(`call_0` 등)를 다시 쓰면 X의 `tool:<id>` 요청 키,
// core-tools의 closedKey, 학습 제안 id가 서로 다른 호출에서 겹친다. 응답을 받은 자리에서 단계 id의 끝부분을 붙여 대화 안에서 유일하게 만든다.
// 영숫자·`_`·`-`만 쓰므로 제공자의 id 문자 제한(Anthropic `^[a-zA-Z0-9_-]+$`)을 지킨다.

const SALT_LENGTH = 8;

/** 단계 id(`stp_<ULID>`)의 끝 8자. ULID 뒤쪽은 무작위 부분이라 단계마다 다르다 */
export function toolCallSalt(stepId: StepId): string {
  return stepId.slice(-SALT_LENGTH);
}

/** 이미 이 단계 salt가 붙은 id는 다시 붙이지 않는다(재개·재생 때 같은 값이 나오게 한다) */
function saltedToolCallId(id: string, salt: string): string {
  const suffix = `_${salt}`;
  return id.endsWith(suffix) ? id : `${id}${suffix}`;
}

export function saltAssistantMessage(message: AssistantMessage, salt: string): AssistantMessage {
  if (!message.content.some((block) => block.type === "toolCall")) return message;
  return {
    ...message,
    content: message.content.map((block) =>
      block.type === "toolCall" ? { ...block, id: saltedToolCallId(block.id, salt) } : block,
    ),
  };
}

export function saltStreamEvent(event: AssistantMessageEvent, salt: string): AssistantMessageEvent {
  switch (event.type) {
    case "toolcall_end":
      return {
        ...event,
        toolCall: { ...event.toolCall, id: saltedToolCallId(event.toolCall.id, salt) },
        partial: saltAssistantMessage(event.partial, salt),
      };
    case "start":
    case "text_start":
    case "text_delta":
    case "text_end":
    case "thinking_start":
    case "thinking_delta":
    case "thinking_end":
    case "toolcall_start":
    case "toolcall_delta":
      return { ...event, partial: saltAssistantMessage(event.partial, salt) };
    case "done":
    case "error":
      return event;
    default:
      return assertNever(event, "AssistantMessageEvent");
  }
}
