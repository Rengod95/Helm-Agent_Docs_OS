import { useSyncExternalStore } from "react";

// 오른쪽 well을 넓게 편 탭(artView, AGE-77). 넓은 폭(`EndTabDef.wideWidth`)을 둔 탭만 넓어지고, 펴 둔 탭이 아닌 탭은 늘 좁은 폭이다.
// 다른 탭으로 옮기면 그 탭은 좁게 보이고, 펴 둔 탭으로 돌아오면 다시 넓다.
// 셸의 well 폭 계산(end-panel, shell의 비키기와 토스트 자리)과 탭 안의 "넓게" 단추가 같은 값을 읽도록 모듈 하나에 둔다.

let wideTab: string | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** 넓게 편 탭의 id. 없으면 null */
export function useWellWide(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => wideTab,
    () => wideTab,
  );
}

/** 넓게 편 탭을 바꾼다(null이면 좁게). 같은 값이면 아무것도 하지 않는다 */
export function setWellWide(next: string | null): void {
  if (next === wideTab) return;
  wideTab = next;
  for (const listener of listeners) listener();
}
