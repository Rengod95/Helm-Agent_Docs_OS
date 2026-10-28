// 분기·수명주기 시험의 도우미: 한 turn을 끝까지 돌리고 활성 가지의 item을 읽는다.
import { isId, type EventId, type ThreadId } from "@xeon/contracts/conversation";
import type { ItemRow } from "@xeon/contracts/records";
import {
  endTurn,
  expectOk,
  fullStep,
  startTurn,
  type Harness,
  type ToolCallPlan,
  type TurnIds,
} from "./harness.ts";

/** 한 turn: user item, (도구 호출이 있으면 assistant toolUse, toolResult), 마지막 assistant item */
export function completeTurn(
  h: Harness,
  threadId: ThreadId,
  calls: readonly ToolCallPlan[] = [],
): TurnIds {
  const turn = startTurn(h, threadId);
  fullStep(h, turn, 0, calls);
  if (calls.length > 0) fullStep(h, turn, 1, []);
  endTurn(h, turn);
  return turn;
}

export function branchItemsOf(h: Harness, threadId: ThreadId): readonly ItemRow[] {
  return expectOk(h.service.query.branchItems(threadId));
}

export function itemAt(h: Harness, threadId: ThreadId, index: number): ItemRow {
  const items = branchItemsOf(h, threadId);
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${String(index)}`);
  return item;
}

export function leafOfThread(h: Harness, threadId: ThreadId): EventId {
  const row = h.store.raw
    .query<{ leaf_event_id: string }, [string]>(
      "SELECT leaf_event_id FROM p_threads WHERE thread_id = ?",
    )
    .get(threadId);
  if (row === null) throw new Error("no thread row");
  const leaf = row.leaf_event_id;
  if (!isId("evt", leaf)) throw new Error("leaf is not an event id");
  return leaf;
}
