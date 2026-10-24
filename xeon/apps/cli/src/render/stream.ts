import { parse } from "@xeon/contracts";
import { ItemUpdatedPayloadSchema, type ItemId } from "@xeon/contracts/conversation";
import type { StreamChunkParams } from "@xeon/contracts/wire";

// L4.cli.spec §4.5. 휘발 조각(stream.chunk)을 진행 줄 텍스트로 바꾼다. 순수 함수.
//   item.updated{part_delta}: 본문(text) 조각은 그 item의 누적 텍스트에 이어 붙인다. thinking과 toolCall 인자 조각은 그리지 않는다.
//   item.updated{tool_progress}: 도구 진행을 한 줄로 바꿔 쓴다.
// 그 밖의 휘발 kind(turn.updated, step.updated, item.started, scope.handler_failed)는 그리지 않는다.

export interface ProgressUpdate {
  readonly itemId: ItemId;
  /** 그 item의 진행 줄 전체 텍스트 */
  readonly text: string;
}

export function progressOf(
  chunk: StreamChunkParams,
  current: ReadonlyMap<string, string>,
): ProgressUpdate | undefined {
  const { event } = chunk;
  if (event.kind !== "item.updated") return undefined;
  const parsed = parse(ItemUpdatedPayloadSchema, event.payload);
  if (!parsed.ok) return undefined;
  const { itemId, update } = parsed.value;
  if (update.kind === "part_delta") {
    if (update.delta.kind !== "text") return undefined;
    return { itemId, text: `${current.get(itemId) ?? ""}${update.delta.delta}` };
  }
  if (update.kind === "tool_progress") {
    for (const block of update.partialResult.content) {
      if (block.type !== "text") continue;
      const line = block.text.split("\n").find((candidate) => candidate.trim().length > 0);
      if (line !== undefined) return { itemId, text: `· ${line.trim()}` };
    }
    return undefined;
  }
  return undefined;
}
