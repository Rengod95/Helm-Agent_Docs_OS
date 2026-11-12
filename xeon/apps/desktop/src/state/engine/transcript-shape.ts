import { assertNever } from "@fresnel/contracts";
// src/state/engine/transcript-shape.ts
// 대화 줄 모델(`views/transcript-rows.ts`)이 읽는 확정 item의 모양. 줄을 나누고 묶는 데 필요한 것(종류, 블록 순서, 도구 호출 id·이름·인자)만 담는다.
// 확정 item은 기록 뒤 바뀌지 않으므로 item 참조별로 기억하고, 목록은 (item id 배열, item 맵, 자식 대화 여부)가 같으면 같은 참조를 준다.
// 스펙: docs/xeon/L4/desktop-ux/spec.md §16.2.
import type { ItemId, ItemRecord, JsonObject } from "@fresnel/contracts/conversation";
import { selectOpenThread } from "./selectors.ts";
import type { EngineMirror } from "./state.ts";

/** 어시스턴트 item 안 블록 하나. `index`는 content 안 자리다 */
export type ShapeBlock =
  | { readonly kind: "text"; readonly index: number }
  | { readonly kind: "thinking"; readonly index: number }
  | {
      readonly kind: "call";
      readonly index: number;
      readonly callId: string;
      readonly name: string;
      readonly args: JsonObject;
    };

/** 확정 item 하나의 모양. `hidden`은 화면에 그리지 않는 item(시스템 프롬프트, 표시하지 않는 확장 item, 자식 대화의 지시문 등)이다 */
export type ItemShape =
  | { readonly kind: "user"; readonly id: ItemId }
  | { readonly kind: "assistant"; readonly id: ItemId; readonly blocks: readonly ShapeBlock[] }
  /** 짝이 되는 호출이 화면에 없는 도구 결과 */
  | { readonly kind: "result"; readonly id: ItemId }
  | { readonly kind: "custom"; readonly id: ItemId }
  | { readonly kind: "hidden"; readonly id: ItemId };

const NO_SHAPES: readonly ItemShape[] = Object.freeze([]);

function blocksOf(item: ItemRecord & { readonly kind: "assistant" }): readonly ShapeBlock[] {
  return item.message.content.flatMap((block, index): ShapeBlock[] => {
    switch (block.type) {
      case "text":
        return block.text === "" ? [] : [{ kind: "text", index }];
      case "thinking":
        return block.thinking === "" ? [] : [{ kind: "thinking", index }];
      case "toolCall":
        return [{ kind: "call", index, callId: block.id, name: block.name, args: block.arguments }];
      default:
        return assertNever(block, "ContentBlock");
    }
  });
}

function shapeOf(item: ItemRecord, spawned: boolean, calls: ReadonlySet<string>): ItemShape {
  const id = item.itemId;
  switch (item.kind) {
    case "user":
      // 위임으로 만든 자식 대화의 사용자 말은 엔진이 넣은 지시문이다 [결정: 오케스트레이터 기본값, rtE R-3]
      return spawned ? { kind: "hidden", id } : { kind: "user", id };
    case "assistant": {
      // 내용 없이 실패한 답은 보일 것이 없다. 실패 원인은 대화 아래 경고 한 곳에만 보인다
      const blocks = blocksOf(item);
      return blocks.length === 0 ? { kind: "hidden", id } : { kind: "assistant", id, blocks };
    }
    case "toolResult":
      return calls.has(item.message.toolCallId) ? { kind: "hidden", id } : { kind: "result", id };
    case "custom":
      return item.message.display ? { kind: "custom", id } : { kind: "hidden", id };
    case "system":
      return { kind: "hidden", id };
    default:
      return assertNever(item, "ItemRecord");
  }
}

type Cached = {
  readonly itemIds: readonly ItemId[];
  readonly items: Readonly<Record<string, ItemRecord>>;
  readonly spawned: boolean;
  readonly shapes: readonly ItemShape[];
};
let cached: Cached | null = null;

/** 열린 대화의 확정 item 모양(목록 순서). 대화가 열려 있지 않으면 빈 목록이다 */
export function selectTranscriptShapes(s: EngineMirror): readonly ItemShape[] {
  const transcript = s.transcript;
  if (transcript?.status !== "ready" || transcript.itemIds.length === 0) return NO_SHAPES;
  const spawned = selectOpenThread(s)?.spawnedBy !== undefined;
  if (
    cached !== null &&
    cached.itemIds === transcript.itemIds &&
    cached.items === transcript.items &&
    cached.spawned === spawned
  ) {
    return cached.shapes;
  }
  const calls = new Set<string>();
  for (const id of transcript.itemIds) {
    const item = transcript.items[id];
    if (item?.kind !== "assistant") continue;
    for (const block of item.message.content) if (block.type === "toolCall") calls.add(block.id);
  }
  const shapes = transcript.itemIds.flatMap((id): ItemShape[] => {
    const item = transcript.items[id];
    return item === undefined ? [] : [shapeOf(item, spawned, calls)];
  });
  cached = { itemIds: transcript.itemIds, items: transcript.items, spawned, shapes };
  return shapes;
}
