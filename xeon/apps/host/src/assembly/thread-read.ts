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
 * 현재 가지의 `item.recorded` 이벤트 전부(복원 전 사본)와 그 시점의 head. `headSeq()` 읽기와 가지 읽기의 시작(`for await`가 첫 `next()`를 바로 부른다)은
 * 같은 동기 구간이다: 가지는 첫 `next()`에서 한 번에 읽히므로(`readBranch`가 사슬을 한 질의로 가져온다) 두 값이 같은 저장소 상태를 본다.
 * 그 사이에 await가 끼면 head와 item이 어긋나므로 이 순서를 바꾸지 않는다. 큰 본문(detached 필드)은 여기서 되돌리지 않는다:
 * 돌려줄 쪽만 `hydratedItems`가 되돌린다.
 */
async function readBranchEvents(
  session: SessionService,
  threadId: ThreadId,
): Promise<
  Result<{ readonly head: number; readonly events: readonly DurableEventEnvelope[] }, ReadFailure>
> {
  const headRead = session.feed.headSeq();
  if (!headRead.ok) return headRead;
  const head = headRead.value;
  const events: DurableEventEnvelope[] = [];
  for await (const read of session.readBranch(threadId)) {
    if (!read.ok) return read;
    if (read.value.seq <= head && read.value.kind === "item.recorded") events.push(read.value);
  }
  return ok({ head, events });
}

/** 고른 쪽의 이벤트만 blob에서 되돌려 item으로 읽는다 */
async function hydratedItems(
  session: SessionService,
  events: readonly DurableEventEnvelope[],
): Promise<Result<readonly ItemRecord[], ReadFailure>> {
  const hydrated = await Promise.all(events.map((event) => session.hydrate(event)));
  const items: ItemRecord[] = [];
  for (const event of hydrated) {
    const item = itemOf(event);
    if (!item.ok) return item;
    if (item.value !== undefined) items.push(item.value);
  }
  return ok(items);
}

/** 예산 안에서 가장 새 item부터 최대 `limit`개를 고른다(`items`는 오래된 것부터). 하나는 항상 담는다 */
function pageOf(items: readonly ItemRecord[], limit: number): { readonly start: number } {
  const end = items.length;
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

  const branch = await readBranchEvents(session, threadId);
  if (!branch.ok) return branch;
  const { head, events } = branch.value;

  let end = events.length;
  if (before !== undefined) {
    // 이 thread의 item인데 현재 가지에 없으면 not_on_branch, 아예 없으면 item_not_found다
    const recorded = session.query.itemEvent(threadId, before);
    if (!recorded.ok) return recorded;
    const at = events.findIndex((event) => event.id === recorded.value);
    if (recorded.value === undefined || at < 0) {
      return err({
        kind: "invalid_target",
        reason: recorded.value === undefined ? "item_not_found" : "not_on_branch",
      });
    }
    end = at;
  }
  // 쪽 크기만큼만 되돌린다. 바이트 예산은 되돌린 크기로만 알 수 있어, 예산을 넘으면 그 안에서 오래된 쪽을 덜어 낸다
  const limit = params.limit ?? THREAD_READ_DEFAULT_LIMIT;
  const first = Math.max(0, end - limit);
  const hydrated = await hydratedItems(session, events.slice(first, end));
  if (!hydrated.ok) return hydrated;
  const { start } = pageOf(hydrated.value, limit);
  return ok({
    threadId,
    items: hydrated.value.slice(start),
    position: { storeId, seq: head },
    hasMore: first + start > 0,
  });
}
