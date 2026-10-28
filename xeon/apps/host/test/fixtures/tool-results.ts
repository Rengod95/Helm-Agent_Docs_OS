import type { EventWire } from "@xeon/contracts/wire";

/** 도구 결과 item의 message를 JSON 텍스트로 모은다(앞 `limit`자). 시험이 본문 조각을 찾는 데 쓴다 */
export function toolResultTexts(events: readonly EventWire[], limit = 1500): string[] {
  const out: string[] = [];
  for (const event of events) {
    if (event.kind !== "item.recorded") continue;
    const payload: unknown = event.payload;
    if (typeof payload !== "object" || payload === null || !("item" in payload)) continue;
    const item = payload.item;
    if (typeof item !== "object" || item === null || !("kind" in item)) continue;
    if (item.kind !== "toolResult" || !("message" in item)) continue;
    out.push(JSON.stringify(item.message).slice(0, limit));
  }
  return out;
}
