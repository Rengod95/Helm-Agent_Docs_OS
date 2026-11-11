// src/state/engine/message-text.ts
import type {
  ImageContent,
  ItemRecord,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@fresnel/contracts/conversation";

type ContentBlock = TextContent | ImageContent | ThinkingContent | ToolCall;

/**
 * 메시지 복사용 원문. 사용자 메시지와 어시스턴트 메시지의 글 파트(`text`)를 차례로 이어 붙인다(사이는 줄바꿈이다).
 * 생각(`thinking`), 도구 호출, 이미지는 넣지 않는다. 글이 없는 item(이미지만 있는 입력, 도구 호출만 있는 응답, 빈 글)과
 * 사용자·어시스턴트가 아닌 item(시스템, 도구 결과, 확장 기록)은 null이다. 거울 값은 화면 가림 표식을 이미 적용한 것이라 그대로 쓴다.
 */
export function messageCopyText(item: ItemRecord): string | null {
  if (item.kind === "user") {
    const content = item.message.content;
    return typeof content === "string" ? nonEmpty(content) : joinedText(content);
  }
  if (item.kind === "assistant") return joinedText(item.message.content);
  return null;
}

function joinedText(blocks: readonly ContentBlock[]): string | null {
  const texts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text" && block.text !== "") texts.push(block.text);
  }
  return texts.length === 0 ? null : texts.join("\n");
}

function nonEmpty(text: string): string | null {
  return text === "" ? null : text;
}
