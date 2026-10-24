const noop = (): void => {};

/** 프로세스 안 키별 직렬화. run이 던져도 다음 대기자는 이어서 실행한다 */
export function createKeyedMutex(): <T>(key: string, run: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<void>>();
  return async <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    let release: () => void = noop;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    tails.set(key, tail);
    await previous;
    try {
      return await run();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}
