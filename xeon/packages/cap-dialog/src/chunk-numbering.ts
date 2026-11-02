import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";

// 휘발 조각 번호 `n`의 발급기(F.records.spec §4.3). `n`은 (threadId, turnId)마다 0부터 1씩 센다.
// 같은 키를 쓰는 발신자가 둘 이상이면 발급기를 하나만 나눠 써야 번호가 겹치지 않는다.
// `dialog.status`와 `scope.handler_failed`는 둘 다 turnId가 null이라 같은 키를 쓴다.

/** 휘발 조각 번호를 발급한다. 메모리에만 있고 재시작하면 0부터 다시 센다(휘발 이벤트는 재생하지 않는다) */
export interface ChunkNumbering {
  /** 이 (threadId, turnId)의 다음 번호다. 처음 부르면 0이고 부를 때마다 1씩 오른다 */
  next(threadId: ThreadId, turnId: TurnId | null): number;
}

/** 새 발급기를 만든다. 키마다 따로 세고 지우지 않는다. thread마다 한 칸씩 쌓이는 것은 지금 두 발신자의 카운터와 같다 */
export function createChunkNumbering(): ChunkNumbering {
  const counters = new Map<ThreadId, Map<TurnId | null, number>>();
  return {
    next(threadId, turnId) {
      const byTurn = counters.get(threadId) ?? new Map<TurnId | null, number>();
      counters.set(threadId, byTurn);
      const n = byTurn.get(turnId) ?? 0;
      byTurn.set(turnId, n + 1);
      return n;
    },
  };
}
