// src/state/engine/thread-reader.ts
import { attemptAsync, err, ok, repeatAsync } from "@xeon/contracts";
import type { ItemRecord } from "@xeon/contracts/conversation";
import type { HostConnection, StoreId } from "@xeon/contracts/wire";
import type { TranscriptPort } from "./link.ts";

export type ThreadReaderDeps = {
  readonly connection: HostConnection;
  /** 거울의 cursor.storeId. position.storeId와 다르면 결과를 버린다(F.wire-settings.spec 3.4.6 2-4) */
  readonly storeId: () => StoreId | null;
};

/** 한 번에 읽는 상한. 이보다 오래된 item은 읽지 않는다(L4.desktop.spec 4.10 B2: 긴 대화 1,000개 기준) */
export const MAX_SNAPSHOT_ITEMS = 1000;
const PAGE = 200;

/**
 * thread.read로 열린 thread의 스냅샷을 만든다. 첫 페이지(가장 새 item)의 position이 이어 붙이는 기준이고
 * 이전 페이지의 item은 바뀌지 않으므로 뒤 페이지의 position은 쓰지 않는다(3.4.6 3번).
 */
export function createThreadReaderPort(deps: ThreadReaderDeps): TranscriptPort {
  return {
    async load(threadId) {
      const first = await attemptAsync(() =>
        deps.connection.request("thread.read", { threadId, limit: PAGE }),
      );
      if (!first.ok) return err({ kind: "failed" });
      const olderHasMore = { value: false };
      const storeId = deps.storeId();
      if (storeId === null || first.value.position.storeId !== storeId)
        return err({ kind: "unavailable" });
      // 오래된 페이지를 차례로 읽는다. 페이지 배열을 모았다가 마지막에 한 번 이어 붙인다(오래된 것이 앞)
      const pages: (readonly ItemRecord[])[] = [first.value.items];
      const failed = await repeatAsync<boolean>(async () => {
        const loaded = pages.reduce((n, page) => n + page.length, 0);
        const before = pages[0]?.[0]?.itemId;
        const hasMore = pages.length === 1 ? first.value.hasMore : olderHasMore.value;
        if (!hasMore || before === undefined || loaded >= MAX_SNAPSHOT_ITEMS)
          return { value: false };
        const page = await attemptAsync(() =>
          deps.connection.request("thread.read", { threadId, limit: PAGE, before }),
        );
        if (!page.ok) return { value: true };
        pages.unshift(page.value.items);
        olderHasMore.value = page.value.hasMore;
        return undefined;
      });
      if (failed) return err({ kind: "failed" });
      return ok({ asOfSeq: first.value.position.seq, items: pages.flat() });
    },
  };
}
