import { ok, parse, type Result } from "@xeon/contracts";
import type { ItemId, ThreadId } from "@xeon/contracts/conversation";
import { ItemRecordedPayloadSchema, type ReadFailure } from "@xeon/contracts/records";
import type { AgentsSession } from "./deps.ts";

/**
 * 자식 turn의 최종 보고: 마지막 어시스턴트 item의 텍스트 파트를 이어 붙인 것(L1.agents.spec §4.6 1번).
 * 도구 결과, 생각, 중간 메시지는 넣지 않는다. item이 없거나 어시스턴트가 아니면 null
 */
export async function readFinalText(
  session: Pick<AgentsSession, "query" | "hydrate">,
  childThreadId: ThreadId,
  itemId: ItemId,
): Promise<Result<string | null, ReadFailure>> {
  const found = session.query.latestEvent(childThreadId, "item.recorded", {
    pointer: "/item/itemId",
    equals: itemId,
  });
  if (!found.ok) return found;
  if (found.value === undefined) return ok(null);
  const hydrated = await session.hydrate(found.value);
  const recorded = parse(ItemRecordedPayloadSchema, hydrated.payload);
  if (!recorded.ok) return ok(null);
  const { item } = recorded.value;
  if (item.kind !== "assistant") return ok(null);
  const parts: string[] = [];
  for (const block of item.message.content) {
    if (block.type === "text") parts.push(block.text);
  }
  return ok(parts.length === 0 ? null : parts.join("\n"));
}
