// 호스트 안에서 두루 쓰는 작은 함수. 아래 층 패키지를 import하지 않는다.

/** 객체의 자기 열거 가능 속성을 얕게 옮긴다. 와이어 메시지(`Record<string, unknown>`)로 넘길 때 쓴다 */
export function toRecord(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value));
}

export function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export function stackOf(caught: unknown): string | null {
  return caught instanceof Error && caught.stack !== undefined ? caught.stack : null;
}

/** 항목을 차례로 하나씩 처리한다. 앞 항목이 끝나야 다음을 시작한다(루프 안 await 대신) */
export function sequentially<T>(
  items: readonly T[],
  fn: (item: T) => Promise<void>,
): Promise<void> {
  return items.reduce<Promise<void>>(
    (chain, item) => chain.then(() => fn(item)),
    Promise.resolve(),
  );
}
