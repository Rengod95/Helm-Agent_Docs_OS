import type { ItemPages } from "@fresnel/core-persistence";
import { err, ok, type Result } from "@fresnel/contracts";
import type { ItemId, ItemRecord } from "@fresnel/contracts/conversation";
import {
  WIRE_LIMITS,
  type StoreId,
  type WireParams,
  type WireResult,
} from "@fresnel/contracts/wire";
import type { ThreadReadFailure } from "../types.ts";

// F.wire-settings.spec §3.4.6. thread.read: 현재 가지의 내구 item을 오래된 것부터 돌려주는 읽기 전용 조회.
// 쪽 읽기는 L1.persistence의 `branchItemRecords`(`itemPagesOf`)에 맡긴다: 쪽에 든 item의 이벤트만 읽고 그 blob만 되돌리며, fork한 thread는
// 출처 thread의 fork 지점까지 이어서 돌려주고, head는 item과 같은 읽기 트랜잭션에서 잰다(M2 마감 G2-11, §3.4.6 3.1항).
// 호스트가 하는 일은 응답 크기 예산에 맞춰 오래된 쪽을 덜어 내는 것뿐이다.

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

/** 한 번에 되읽는 쪽 크기. `thread.read`의 `limit` 상한과 같다 */
const AROUND_PAGE = 500;

/**
 * 가운데 창(W-16). `around` item을 가운데 두고 앞 `floor(limit/2)`개, 뒤 나머지를 돌려준다. 뒤가 모자라면 앞으로 채운다(가지 끝에서 자른다).
 * 쪽 질의는 `before`만 알아서 가장 새 item에서 거슬러 올라가 `around`를 만날 때까지 읽는다: 읽는 쪽 수는 가지 길이에 비례한다 [제안: L1에
 * `around` 질의가 생기면 이 걸음을 없앤다]. 메모리에는 `around`보다 새로운 item 가운데 가장 오래된 `limit - 1`개만 쥔다(앞이 모자랄 때 뒤로 채운다).
 * `around`가 없거나 이 가지에 없으면 계약대로 빈 `items`다(`ThreadReadParamsSchema.around`). 예산을 넘으면 `around`에서 먼 쪽부터 덜어 낸다.
 */
async function readAround(
  pages: ItemPages,
  storeId: StoreId,
  params: WireParams<"thread.read">,
  around: ItemId,
): Promise<Result<WireResult<"thread.read">, ThreadReadFailure>> {
  const { threadId } = params;
  const limit = params.limit ?? THREAD_READ_DEFAULT_LIMIT;
  const wantedAfter = limit - 1 - Math.floor(limit / 2);
  // 가지에 있는 item인지 먼저 본다. 없으면 가지 전체를 거슬러 가지 않는다
  const probe = await pages.branchItemRecords({ threadId, limit: 1, before: around });
  if (!probe.ok) {
    if (probe.error.kind !== "invalid_target") return err(probe.error);
    const head = await pages.branchItemRecords({ threadId, limit: 1 });
    if (!head.ok) return err(head.error);
    return ok({
      threadId,
      items: [],
      position: { storeId, seq: head.value.headSeq },
      hasMore: false,
    });
  }
  let anchor: ItemRecord | undefined;
  let newer: readonly ItemRecord[] = [];
  let headSeq = probe.value.headSeq;
  let cursor: ItemId | undefined;
  for (let first = true; anchor === undefined; first = false) {
    // oxlint-disable-next-line no-await-in-loop -- 앞 쪽의 가장 오래된 item이 다음 쪽의 경계다 (F.wire-settings.spec §3.4.6)
    const page = await pages.branchItemRecords({
      threadId,
      limit: AROUND_PAGE,
      ...(cursor === undefined ? {} : { before: cursor }),
    });
    if (!page.ok) return err(page.error);
    if (first) headSeq = page.value.headSeq;
    const index = page.value.items.findIndex((item) => item.itemId === around);
    const oldest = page.value.items[0];
    if (index >= 0) {
      anchor = page.value.items[index];
      newer = [...page.value.items.slice(index + 1), ...newer].slice(0, limit - 1);
    } else {
      newer = [...page.value.items, ...newer].slice(0, limit - 1);
      if (oldest === undefined || !page.value.hasMore) break;
      cursor = oldest.itemId;
    }
  }
  if (anchor === undefined) {
    return ok({ threadId, items: [], position: { storeId, seq: headSeq }, hasMore: false });
  }
  const olderCount = limit - 1 - Math.min(newer.length, wantedAfter);
  const older =
    olderCount > 0
      ? await pages.branchItemRecords({ threadId, limit: olderCount, before: around })
      : undefined;
  if (older !== undefined && !older.ok) return err(older.error);
  const before = older?.value.items ?? [];
  let items = [...before, anchor, ...newer.slice(0, limit - 1 - before.length)];
  let anchorAt = before.length;
  let hasMore = older === undefined ? probe.value.items.length > 0 : older.value.hasMore;
  let bytes = items.reduce((sum, item) => sum + sizeOf(item), 0);
  while (bytes > THREAD_READ_BUDGET_BYTES && items.length > 1) {
    const dropOld = anchorAt > items.length - 1 - anchorAt;
    const dropped = dropOld ? items[0] : items[items.length - 1];
    if (dropped === undefined) break;
    bytes -= sizeOf(dropped);
    if (dropOld) {
      items = items.slice(1);
      anchorAt -= 1;
      hasMore = true;
    } else {
      items = items.slice(0, -1);
    }
  }
  return ok({ threadId, items, position: { storeId, seq: headSeq }, hasMore });
}

export async function readThread(
  pages: ItemPages,
  storeId: StoreId,
  params: WireParams<"thread.read">,
): Promise<Result<WireResult<"thread.read">, ThreadReadFailure>> {
  const { threadId, before } = params;
  if (params.around !== undefined) return await readAround(pages, storeId, params, params.around);
  const limit = params.limit ?? THREAD_READ_DEFAULT_LIMIT;
  const page = await pages.branchItemRecords({
    threadId,
    limit,
    ...(before === undefined ? {} : { before }),
  });
  if (!page.ok) return err(page.error);
  // 바이트 예산은 되돌린 크기로만 알 수 있어, 예산을 넘으면 이 쪽 안에서 오래된 것을 덜어 낸다
  const { start } = pageOf(page.value.items, limit);
  return ok({
    threadId,
    items: page.value.items.slice(start),
    position: { storeId, seq: page.value.headSeq },
    hasMore: page.value.hasMore || start > 0,
  });
}
