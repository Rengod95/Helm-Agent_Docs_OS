import { useSyncExternalStore } from "react";

// 승인 카드의 "N분 전"이 흐르도록 시각을 30초마다 새로 읽는다. 렌더는 저장된 값만 읽는다(렌더 중 Date.now를 부르지 않는다).
// 구독자가 없으면 타이머를 멈춘다.

const TICK_MS = 30_000;

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function tick(): void {
  now = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    now = Date.now();
    timer = setInterval(tick, TICK_MS);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const readNow = (): number => now;

/** 지금 시각(epoch ms). 30초마다 바뀐다 */
export function useClockNow(): number {
  return useSyncExternalStore(subscribe, readNow, readNow);
}
