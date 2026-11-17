import { ok, type Result } from "@fresnel/contracts";

// 결과를 돌려주는 일을 차례로 한다. 루프 안 await 대신 쓴다(검토 서비스와 마이그레이션 제출이 같이 쓴다).

/** 항목을 차례로 처리하고 값을 모은다. 첫 실패에서 멈추고 그 실패를 돌려준다 */
export function collectInOrder<T, U, E>(
  items: readonly T[],
  step: (item: T) => Promise<Result<readonly U[], E>>,
): Promise<Result<U[], E>> {
  return items.reduce<Promise<Result<U[], E>>>(
    async (chain, item) => {
      const done = await chain;
      if (!done.ok) return done;
      const next = await step(item);
      if (!next.ok) return next;
      return ok([...done.value, ...next.value]);
    },
    Promise.resolve(ok([])),
  );
}

/** 항목을 차례로 처리한다. 첫 실패에서 멈춘다 */
export function runInOrder<T, E>(
  items: readonly T[],
  step: (item: T) => Promise<Result<void, E>>,
): Promise<Result<void, E>> {
  return items.reduce<Promise<Result<void, E>>>(
    async (chain, item) => {
      const done = await chain;
      if (!done.ok) return done;
      return step(item);
    },
    Promise.resolve(ok(undefined)),
  );
}
