import { err, ok, parse, type Result } from "@xeon/contracts";
import type { ItemRecord, ThreadId } from "@xeon/contracts/conversation";
import {
  ItemRecordedPayloadSchema,
  type DurableEventEnvelope,
  type ReadFailure,
  type SessionService,
} from "@xeon/contracts/records";
import { WIRE_LIMITS, type StoreId, type WireParams, type WireResult } from "@xeon/contracts/wire";
import type { ThreadReadFailure } from "../types.ts";

// F.wire-settings.spec §3.4.6. thread.read: 현재 가지의 내구 item을 오래된 것부터 돌려주는 읽기 전용 조회.
// 구현은 L1.persistence의 `readBranch`(루트 → leaf 순서의 이벤트)에서 `item.recorded`의 item만 골라 쪽을 자른다.

/** `limit`을 생략했을 때의 쪽 크기(F wire §3.4.6 3항) */
const THREAD_READ_DEFAULT_LIMIT = 200;

/**
 * 한 응답의 item 직렬화 크기 예산. 프레임 한도(1 MiB)에서 응답 뼈대와 `position`이 쓸 여유를 뺀 값이다.
 * 예산을 넘으면 오래된 쪽부터 잘라 적게 돌려주고 `hasMore`를 참으로 둔다(§3.4.6 3항)
 */
const THREAD_READ_BUDGET_BYTES: number = WIRE_LIMITS.maxFrameBytes - 64 * 1024;

const encoder = new TextEncoder();

function sizeOf(item: ItemRecord): number {
  return encoder.encode(JSON.stringify(item)).byteLength;
}

/** 이벤트 하나가 담은 item. item.recorded가 아니면 undefined. 저장된 payload가 스키마와 다르면 읽기 실패다 */
function itemOf(event: DurableEventEnvelope): Result<ItemRecord | undefined, ReadFailure> {
  if (event.kind !== "item.recorded") return ok(undefined);
  const payload = parse(ItemRecordedPayloadSchema, event.payload);
  if (!payload.ok) return err({ kind: "row_invalid", where: "events.payload(item.recorded)" });
  return ok(payload.value.item);
}

/**
 * 현재 가지의 item 전부와 그 시점의 head. `headSeq()` 읽기와 가지 읽기의 시작(`for await`가 첫 `next()`를 바로 부른다)은 같은 동기 구간이다:
 * 가지는 첫 `next()`에서 한 번에 읽히므로(`readBranch`가 사슬을 한 질의로 가져온다) 두 값이 같은 저장소 상태를 본다.
 * 그 사이에 await가 끼면 head와 item이 어긋나므로 이 순서를 바꾸지 않는다.
 */
async function readBranchItems(
  session: SessionService,
  threadId: ThreadId,
): Promise<Result<{ readonly head: number; readonly items: readonly ItemRecord[] }, ReadFailure>> {
  const headRead = session.feed.headSeq();
  if (!headRead.ok) return headRead;
  const head = headRead.value;
  const recorded: DurableEventEnvelope[] = [];
  for await (const read of session.readBranch(threadId)) {
    if (!read.ok) return read;
    if (read.value.seq <= head && read.value.kind === "item.recorded") recorded.push(read.value);
  }
  // detached 필드(큰 본문)는 blob에서 되돌린 사본으로 읽는다
  const hydrated = await Promise.all(recorded.map((event) => session.hydrate(event)));
  const items: ItemRecord[] = [];
  for (const event of hydrated) {
    const item = itemOf(event);
    if (!item.ok) return item;
    if (item.value !== undefined) items.push(item.value);
  }
  return ok({ head, items });
}

/** 예산 안에서 `end` 바로 앞까지 가장 새 item부터 최대 `limit`개를 고른다. 하나는 항상 담는다 */
function pageOf(
  items: readonly ItemRecord[],
  end: number,
  limit: number,
): { readonly start: number } {
  let start = end;
  let bytes = 0;
  while (start > 0 && end - start < limit) {
    const candidate = items[start - 1];
    if (candidate === undefined) break;
    const size = sizeOf(candidate);
    if (end - start > 0 && bytes + size > THREAD_READ_BUDGET_BYTES) break;
    bytes += size;
    start -= 1;
  }
  return { start };
}

export async function readThread(
  session: SessionService,
  storeId: StoreId,
  params: WireParams<"thread.read">,
): Promise<Result<WireResult<"thread.read">, ThreadReadFailure>> {
  const { threadId, before } = params;
  const found = session.query.thread(threadId);
  if (!found.ok) return found;
  if (found.value === undefined) return err({ kind: "thread_not_found", threadId });

  const branch = await readBranchItems(session, threadId);
  if (!branch.ok) return branch;
  const { head, items } = branch.value;

  let end = items.length;
  if (before !== undefined) {
    const at = items.findIndex((item) => item.itemId === before);
    if (at < 0) {
      // 이 thread의 item인데 현재 가지에 없으면 not_on_branch, 아예 없으면 item_not_found다
      const recorded = session.query.itemEvent(threadId, before);
      if (!recorded.ok) return recorded;
      return err({
        kind: "invalid_target",
        reason: recorded.value === undefined ? "item_not_found" : "not_on_branch",
      });
    }
    end = at;
  }
  const { start } = pageOf(items, end, params.limit ?? THREAD_READ_DEFAULT_LIMIT);
  return ok({
    threadId,
    items: items.slice(start, end),
    position: { storeId, seq: head },
    hasMore: start > 0,
  });
}
