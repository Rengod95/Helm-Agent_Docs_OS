/**
 * 항목을 차례로 하나씩 await한다. fn이 "stop"을 돌려주면 멈춘다.
 * 순차 실행 자체가 의미인 곳(fold의 핸들러 순서, 해제 순서, 한 번에 하나씩 하는 정리)에만 쓴다.
 * `no-await-in-loop` 예외를 이 함수 한 곳에 모은다.
 */
export async function eachInOrder<T>(
  items: Iterable<T>,
  fn: (item: T) => Promise<"stop" | "continue">,
): Promise<void> {
  for (const item of items) {
    // oxlint-disable-next-line no-await-in-loop -- 순차 await가 이 함수의 목적이다 (X.primitives.spec §4.2)
    const next = await fn(item);
    if (next === "stop") return;
  }
}
