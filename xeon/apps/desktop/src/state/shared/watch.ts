// src/state/shared/watch.ts
import { attempt } from "@xeon/contracts";
import type { ReadonlyStore } from "./readonly-store.ts";

/**
 * React 밖 구독의 유일한 방법. 고른 값이 Object.is로 바뀔 때만 onChange를 부른다.
 * 콜백이 던져도 다음 리스너(React 구독 포함)가 건너뛰어지지 않도록 attempt로 받고 report로 넘긴다.
 */
export function watch<T, U>(
  store: ReadonlyStore<T>,
  select: (state: T) => U,
  onChange: (next: U, previous: U) => void,
  report: (cause: unknown) => void,
): () => void {
  let previous = select(store.getState());
  return store.subscribe((state) => {
    const next = select(state);
    if (Object.is(next, previous)) return;
    const old = previous;
    previous = next;
    const result = attempt(() => onChange(next, old));
    if (!result.ok) report(result.error.cause);
  });
}
