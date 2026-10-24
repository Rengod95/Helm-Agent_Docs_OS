// src/state/shared/readonly-store.ts
import type { StoreApi } from "zustand/vanilla";

/** 읽기 전용 면. setState가 없으므로 상태 모듈 밖에서 쓸 수 없다 */
export type ReadonlyStore<T> = Pick<StoreApi<T>, "getState" | "getInitialState" | "subscribe">;

export function readonlyView<T>(api: StoreApi<T>): ReadonlyStore<T> {
  return { getState: api.getState, getInitialState: api.getInitialState, subscribe: api.subscribe };
}
