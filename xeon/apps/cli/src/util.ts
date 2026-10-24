// CLI 안에서 두루 쓰는 작은 함수. 워크스페이스 패키지를 import하지 않는다.

/** 항목을 차례로 하나씩 처리한다. 앞 항목이 끝나야 다음을 시작한다(루프 안 await 대신, 순서가 의미인 쓰기에 쓴다) */
export function sequentially<T>(
  items: readonly T[],
  fn: (item: T) => Promise<void>,
): Promise<void> {
  return items.reduce<Promise<void>>(
    (chain, item) => chain.then(() => fn(item)),
    Promise.resolve(),
  );
}
