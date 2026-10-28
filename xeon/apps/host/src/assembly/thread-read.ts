import type { ItemPages } from "@xeon/core-persistence";
import { err, ok, type Result } from "@xeon/contracts";
import type { ItemRecord } from "@xeon/contracts/conversation";
import { WIRE_LIMITS, type StoreId, type WireParams, type WireResult } from "@xeon/contracts/wire";
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

export async function readThread(
  pages: ItemPages,
  storeId: StoreId,
  params: WireParams<"thread.read">,
): Promise<Result<WireResult<"thread.read">, ThreadReadFailure>> {
  const { threadId, before } = params;
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
