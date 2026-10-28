import type { ThreadId } from "@xeon/contracts/conversation";
import type { WebFailure } from "../errors.ts";

// L2.web.spec §4.4.4. 세션당 호출 상한(기본 search 100, fetch 300, 0은 상한 없음). 카운터는 세션별 프로세스 메모리다.
// 세는 단위는 서비스 호출이고 `urls` 일괄 fetch는 URL 수만큼 센다. 캐시 적중도 센다.

export type LimitedKind = "search" | "fetch";

export interface SessionLimits {
  /**
   * 호출 n건을 더한다. 상한을 넘으면 더하지 않고 `session_limit` 실패를 돌려준다.
   * 세션이 없는 호출(호스트, 세션 밖 그룹 호출)은 세지 않는다
   */
  take(
    kind: LimitedKind,
    threadId: ThreadId | undefined,
    count: number,
    limit: number,
  ): WebFailure | undefined;
  used(kind: LimitedKind, threadId: ThreadId): number;
}

function keyOf(kind: LimitedKind, threadId: ThreadId): string {
  return `${kind}:${threadId}`;
}

export function createSessionLimits(): SessionLimits {
  const counts = new Map<string, number>();
  return {
    take(kind, threadId, count, limit) {
      if (threadId === undefined) return undefined;
      const key = keyOf(kind, threadId);
      const used = counts.get(key) ?? 0;
      if (limit > 0 && used + count > limit) {
        return {
          code: "session_limit",
          message: `The session already used ${used} of ${limit} ${kind} calls.`,
          retryable: false,
          detail: { kind, used, limit },
        };
      }
      counts.set(key, used + count);
      return undefined;
    },
    used: (kind, threadId) => counts.get(keyOf(kind, threadId)) ?? 0,
  };
}
