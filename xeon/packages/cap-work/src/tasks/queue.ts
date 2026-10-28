// L2.work.spec §4.1.1. 스레드마다 쓰기를 직렬화하는 비동기 큐. 앞 작업이 실패해도 다음 작업은 이어서 돈다.

export interface ThreadQueue {
  run<T>(threadId: string, task: () => T | Promise<T>): Promise<T>;
}

export function createThreadQueue(): ThreadQueue {
  const tails = new Map<string, Promise<void>>();
  return {
    async run<T>(threadId: string, task: () => T | Promise<T>): Promise<T> {
      const previous = tails.get(threadId);
      const gate = Promise.withResolvers<void>();
      tails.set(threadId, gate.promise);
      try {
        if (previous !== undefined) await previous;
        return await task();
      } finally {
        gate.resolve();
        if (tails.get(threadId) === gate.promise) tails.delete(threadId);
      }
    },
  };
}
