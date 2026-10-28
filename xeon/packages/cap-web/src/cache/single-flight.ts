// L2.web.spec §4.3.1 (1). 같은 키로 동시에 들어온 요청은 진행 중인 호출 하나를 함께 기다린다. `cachePolicy: "none"`도 적용한다.
// 앞선 호출자가 취소해 그 결과가 취소 값이면, 아직 취소되지 않은 뒤 호출자는 자기 호출로 다시 시작한다.
// 결과 타입마다 인스턴스를 따로 만든다(search와 fetch는 서로 다른 공유 표를 쓴다).

export interface SingleFlight<T> {
  run(
    key: string,
    factory: () => Promise<T>,
    options: { readonly signal: AbortSignal; readonly wasCancelled: (value: T) => boolean },
  ): Promise<T>;
  /** 진행 중인 키 수(시험용) */
  size(): number;
}

export function createSingleFlight<T>(): SingleFlight<T> {
  const inflight = new Map<string, Promise<T>>();

  async function run(
    key: string,
    factory: () => Promise<T>,
    options: { readonly signal: AbortSignal; readonly wasCancelled: (value: T) => boolean },
  ): Promise<T> {
    const existing = inflight.get(key);
    if (existing !== undefined) {
      const shared = await existing;
      if (!options.wasCancelled(shared) || options.signal.aborted) return shared;
      return run(key, factory, options);
    }
    const started = factory();
    inflight.set(key, started);
    try {
      return await started;
    } finally {
      if (inflight.get(key) === started) inflight.delete(key);
    }
  }

  return { run, size: () => inflight.size };
}
