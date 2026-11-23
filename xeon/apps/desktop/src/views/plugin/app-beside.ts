import { useSyncExternalStore } from "react";

// 대화 옆에 둔 앱(AGE-78, L4.desktop-ux §6.25 "앱"). 앱 작업 공간의 "대화 옆에"가 화면 키(`<확장>/<화면 id>`)를 두고,
// 오른쪽 패널의 "앱" 탭(`APP_BESIDE_TAB`)이 그 화면을 그린다. 화면 트리 어디서나 같은 값을 읽도록 모듈 하나에 둔다
// (`playground-tab-store.ts`와 같은 식). 저장하지 않는다: 앱을 다시 켜면 비어 있다.

/** 오른쪽 패널의 "앱" 탭 id. 등록은 `desktop-registry.tsx`다 */
export const APP_BESIDE_TAB = "app-beside";

let current: string | undefined;
const listeners = new Set<() => void>();

function set(next: string | undefined): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** 화면 하나를 대화 옆에 둔다. 이미 둔 것이 있으면 바꾼다 */
export function placeBeside(screenKey: string): void {
  set(screenKey);
}

export function useBesideApp(): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}
