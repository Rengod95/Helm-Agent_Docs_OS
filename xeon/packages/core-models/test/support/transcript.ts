import { Bug } from "@xeon/contracts";
import type { Message, TranscriptContext } from "@xeon/contracts/conversation";

/**
 * F의 TranscriptContext는 pi-ai 정규화 함수만 만드는 브랜드 타입이다. F의 브랜드 심볼이 pi-ai와 따로 선언되어 있어
 * (contracts pi.ts 머리말) 값을 만드는 길이 없다. 타입 술어 하나로 좁힌다. 시험 전용이다.
 */
function isTranscriptContext(value: { messages: Message[] }): value is TranscriptContext {
  return Array.isArray(value.messages);
}

export function transcriptOf(messages: Message[]): TranscriptContext {
  const context = { messages };
  if (!isTranscriptContext(context)) throw new Bug("transcriptOf needs a message list");
  return context;
}
