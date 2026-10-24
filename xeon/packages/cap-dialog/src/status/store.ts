import type { StatusItem } from "@xeon/contracts/capabilities";

// L2.dialog.spec §4.4. 스레드마다 세그먼트 스냅숏을 메모리에 둔다. 재시작하면 비고 피드 구독으로 다시 채운다.

/** 스레드 하나가 가질 수 있는 세그먼트 수. 그룹 코드 오류가 메모리를 키우지 않게 막는다 */
const MAX_ITEMS_PER_THREAD = 256;
/** 휘발 이벤트가 싣는 세그먼트 수(spec §3.7). 넘는 항목은 이벤트에서 빠지고 `list`에는 남는다 */
export const MAX_EVENT_ITEMS = 32;
const DEFAULT_ORDER = 500;

export interface StatusStore {
  /** 세그먼트를 만들거나 바꾼다. 스레드 한도를 넘는 새 id면 false다 */
  set(threadId: string, item: StatusItem): boolean;
  clear(threadId: string, id: string): void;
  /** 표시 순서(order, id 바이트 순)로 정렬한 전체 세그먼트 */
  all(threadId: string): readonly StatusItem[];
}

function compare(left: StatusItem, right: StatusItem): number {
  const order = (left.order ?? DEFAULT_ORDER) - (right.order ?? DEFAULT_ORDER);
  if (order !== 0) return order;
  if (left.id < right.id) return -1;
  return left.id > right.id ? 1 : 0;
}

export function createStatusStore(): StatusStore {
  const threads = new Map<string, Map<string, StatusItem>>();
  return {
    set(threadId, item) {
      let items = threads.get(threadId);
      if (items === undefined) {
        items = new Map();
        threads.set(threadId, items);
      }
      if (!items.has(item.id) && items.size >= MAX_ITEMS_PER_THREAD) return false;
      items.set(item.id, item);
      return true;
    },
    clear(threadId, id) {
      const items = threads.get(threadId);
      items?.delete(id);
      if (items?.size === 0) threads.delete(threadId);
    },
    all(threadId) {
      return [...(threads.get(threadId)?.values() ?? [])].toSorted(compare);
    },
  };
}

/** `l2.dialog.status.segments` 한 항목이 세그먼트 id와 맞는가. 끝이 `*`면 접두 일치이고 `*` 하나는 모두다 */
export function segmentMatches(pattern: string, id: string): boolean {
  if (pattern.endsWith("*")) return id.startsWith(pattern.slice(0, -1));
  return pattern === id;
}

/** 설정이 고른 세그먼트만 남긴다. 같은 id는 한 번만 나온다(입력이 id 키라 이미 유일하다) */
export function selectSegments(
  items: readonly StatusItem[],
  patterns: readonly string[],
): readonly StatusItem[] {
  return items.filter((item) => patterns.some((pattern) => segmentMatches(pattern, item.id)));
}
