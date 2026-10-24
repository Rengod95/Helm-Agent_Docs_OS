/**
 * 항목을 차례로 비동기 처리한다. 앞 항목이 끝나야 다음을 시작한다(no-await-in-loop를 쓰지 않는 순차 실행).
 * 도구 호출 재개처럼 순서가 의미를 갖는 곳에 쓴다.
 */
export function forEachSequential<T>(
  items: readonly T[],
  fn: (item: T) => Promise<void>,
): Promise<void> {
  return items.reduce<Promise<void>>(
    (previous, item) => previous.then(() => fn(item)),
    Promise.resolve(),
  );
}
