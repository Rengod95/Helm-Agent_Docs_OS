import { assertNever } from "@fresnel/contracts";
import type { Message } from "@fresnel/contracts/conversation";
import type { Redactor } from "@fresnel/contracts/services";

// L0.secrets.spec §3.5.1, M3-REQ-59. 모델 입력 단계의 사후 가림. 이미 기록된 행에 나중에 등록된 시크릿이 남아 있어도
// provider 요청에는 가려서 싣는다. 저장된 행은 바꾸지 않는다(새 메시지를 돌려준다).
//
// 캐시 접두: 가림은 문자열마다 현재 등록부와 고정 규칙만으로 정해지므로(표지 문자열 고정, 호출 횟수나 시각에 안 변함)
// 등록부가 같으면 요청마다 같은 바이트가 나온다. 등록부가 바뀌면 값이 든 자리에서만 바이트가 바뀌어 접두가 한 번 깨진다.
// 이는 값이 이미 나간 접두를 다시 보내지 않기 위해 피할 수 없다.
//
// 건드리지 않는 것: system 메시지(런타임이 쓴 접두), 이미지 바이트, thinking 블록(provider가 서명으로 검증해 바꾸면 거부한다),
// 서명·id 같은 불투명 필드, 도구 결과의 details(provider로 가지 않는다).

export type MessageMasker = Pick<Redactor, "mask" | "maskDeep">;

function maskText(masker: MessageMasker, text: string): string {
  return masker.mask(text).text;
}

function maskUser(masker: MessageMasker, message: Extract<Message, { role: "user" }>): Message {
  if (typeof message.content === "string") {
    return { ...message, content: maskText(masker, message.content) };
  }
  return {
    ...message,
    content: message.content.map((block) =>
      block.type === "text" ? { ...block, text: maskText(masker, block.text) } : block,
    ),
  };
}

function maskAssistant(
  masker: MessageMasker,
  message: Extract<Message, { role: "assistant" }>,
): Message {
  return {
    ...message,
    content: message.content.map((block) => {
      if (block.type === "text") return { ...block, text: maskText(masker, block.text) };
      if (block.type === "toolCall") {
        return { ...block, arguments: masker.maskDeep(block.arguments).value };
      }
      return block;
    }),
  };
}

function maskToolResult(
  masker: MessageMasker,
  message: Extract<Message, { role: "toolResult" }>,
): Message {
  return {
    ...message,
    content: message.content.map((block) =>
      block.type === "text" ? { ...block, text: maskText(masker, block.text) } : block,
    ),
  };
}

/** 모델에 보낼 메시지를 가린다. 가릴 것이 없는 메시지도 새 객체일 수 있다 */
export function maskMessages(masker: MessageMasker, messages: readonly Message[]): Message[] {
  return messages.map((message) => {
    switch (message.role) {
      case "user":
        return maskUser(masker, message);
      case "assistant":
        return maskAssistant(masker, message);
      case "toolResult":
        return maskToolResult(masker, message);
      case "system":
        return message;
      default:
        return assertNever(message, "maskMessages");
    }
  });
}
