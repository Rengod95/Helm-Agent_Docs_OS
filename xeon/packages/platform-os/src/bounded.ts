// L0.os.spec §3.14, M3-REQ-52. 진단 배열 상한. 확장 진단, 경고 목록처럼 끝없이 자랄 수 있는 배열을 막는다.
// 기본값 [결정: 오케스트레이터 기본값]: 256개. 넘으면 오래된 것부터 버리고 버린 수를 센다.

export const DEFAULT_DIAGNOSTICS_CAP = 256;

export interface BoundedList<T> {
  push(item: T): void;
  /** 남은 항목, 오래된 것이 앞이다 */
  items(): readonly T[];
  /** 지금까지 상한 때문에 버린 항목 수 */
  dropped(): number;
}

export function createBoundedList<T>(cap: number = DEFAULT_DIAGNOSTICS_CAP): BoundedList<T> {
  const limit = Math.max(1, Math.floor(cap));
  const buffer: T[] = [];
  let dropped = 0;
  return {
    push(item) {
      buffer.push(item);
      if (buffer.length > limit) {
        buffer.shift();
        dropped += 1;
      }
    },
    items: () => [...buffer],
    dropped: () => dropped,
  };
}
