import type { Clock } from "@xeon/contracts";
import { sha256Hex } from "../util/hash.ts";

// L2.web.spec §4.3.1 (2). 프로세스 메모리의 검색 결과 메모: LRU 500항목, TTL은 `l2.web.cache.searchTtlMinutes`.

const DEFAULT_CAPACITY = 500;

export interface MemoHit<T> {
  readonly value: T;
  /** 저장 뒤 지난 시간 */
  readonly ageMs: number;
  readonly ttlMs: number;
}

export interface SearchMemo<T> {
  /** 만료된 항목은 지우고 undefined를 돌려준다. 맞은 항목은 가장 최근으로 옮긴다 */
  lookup(key: string): MemoHit<T> | undefined;
  /** ttlMs가 0이면 저장하지 않는다 */
  store(key: string, value: T, ttlMs: number): void;
  size(): number;
}

export function createSearchMemo<T>(
  clock: Clock,
  capacity: number = DEFAULT_CAPACITY,
): SearchMemo<T> {
  const entries = new Map<
    string,
    { readonly value: T; readonly storedAt: number; readonly ttlMs: number }
  >();
  return {
    lookup(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      const ageMs = clock.now() - entry.storedAt;
      if (ageMs >= entry.ttlMs) {
        entries.delete(key);
        return undefined;
      }
      entries.delete(key);
      entries.set(key, entry);
      return { value: entry.value, ageMs, ttlMs: entry.ttlMs };
    },
    store(key, value, ttlMs) {
      if (ttlMs <= 0) return;
      entries.delete(key);
      entries.set(key, { value, storedAt: clock.now(), ttlMs });
      while (entries.size > capacity) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
    },
    size: () => entries.size,
  };
}

/** 검색 메모 키의 재료(§4.3.1): 체인 식별, 동시 질의 수, 정규화 쿼리, 필터, limit 버킷, content, freshness */
export interface SearchMemoKeyInput {
  /** 시도 순서의 provider ID들. 명시 선택이면 원소 하나 */
  readonly chain: readonly string[];
  /** `l2.web.search.parallel`. 같은 체인이라도 동시 질의 수가 다르면 답한 provider 묶음이 달라질 수 있다 */
  readonly parallel: number;
  readonly query: string;
  readonly objective: string | undefined;
  readonly recency: string | undefined;
  readonly domains: { readonly allow: readonly string[]; readonly deny: readonly string[] };
  readonly content: string;
  readonly limitBucket: 10 | 20;
}

/** limit이 10 이하면 10, 11~20이면 20으로 올려 provider에 요청한다 */
export function limitBucket(limit: number): 10 | 20 {
  return limit <= 10 ? 10 : 20;
}

export function searchMemoKey(input: SearchMemoKeyInput): string {
  return sha256Hex(
    JSON.stringify([
      input.chain,
      input.parallel,
      input.query.trim().replace(/\s+/g, " "),
      input.objective ?? null,
      input.recency ?? null,
      [...input.domains.allow].toSorted(),
      [...input.domains.deny].toSorted(),
      input.content,
      input.limitBucket,
    ]),
  );
}
