import type { ThreadId } from "@xeon/contracts/conversation";

// L4.host-service.spec HS-77, §10 미결 31(닫힘 M2 마감 재검토 3). thread마다 하나씩만 도는 구간. 수동 컴팩션(요약 모델 호출, 수 초)과
// turn을 여는 일(`TurnPort.submit`, `TurnPort.resume`)이 같은 thread에서 겹치지 않게 차례로 돌린다. 컴팩션은 열린 turn이 없음을
// 확인한 뒤 요약하고 커밋하므로, 그 사이에 다른 연결의 `turn.start`가 turn을 열면 루프가 쥔 가지 끝과 어긋난다.
// 다른 thread끼리는 서로 기다리지 않는다.

export interface ThreadGate {
  /** 같은 thread에서 앞서 들어온 `work`가 모두 끝난 뒤에 `work`를 돌린다. 앞의 `work`가 실패해도 뒤는 돈다 */
  run<T>(threadId: ThreadId, work: () => Promise<T>): Promise<T>;
}

export function createThreadGate(): ThreadGate {
  // thread마다 가장 나중에 들어온 `work`가 끝나면 풀리는 약속. 이 약속은 거부되지 않는다(끝남만 알린다)
  const tails = new Map<ThreadId, Promise<void>>();
  return {
    async run(threadId, work) {
      const previous = tails.get(threadId);
      const done = Promise.withResolvers<void>();
      const tail = previous === undefined ? done.promise : previous.then(() => done.promise);
      tails.set(threadId, tail);
      if (previous !== undefined) await previous;
      try {
        return await work();
      } finally {
        done.resolve();
        // 뒤에 들어온 `work`가 없으면 표에서 지운다(thread마다 항목이 남지 않게)
        if (tails.get(threadId) === tail) tails.delete(threadId);
      }
    },
  };
}
