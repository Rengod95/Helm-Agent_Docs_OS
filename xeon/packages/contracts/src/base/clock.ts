/** 현재 시각(Unix epoch ms). 테스트는 각 패키지 test/ 안의 고정 시계를 주입한다. */
export interface Clock {
  now(): number;
}

export type TimerHandle = number;

/** 지연 실행. 운영 구현은 L0 platform-os, 테스트 대역은 각 패키지 test/ 안에 둔다. */
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

/** [0, 1) 균등 난수 공급원. 테스트는 각 패키지 test/ 안의 시드 고정 구현을 주입한다. */
export type RandomSource = () => number;
