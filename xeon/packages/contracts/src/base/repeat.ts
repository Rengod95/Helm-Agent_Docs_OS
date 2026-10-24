/** 한 번의 반복이 끝났다고 알리는 값. 계속하려면 undefined를 돌려준다. */
export type RepeatDone<T> = { readonly value: T };

/**
 * 앞 반복이 끝나야 다음을 시작하는 비동기 반복. `step`이 `{ value }`를 돌려주면 그 값으로 끝나고
 * `undefined`를 돌려주면 한 번 더 부른다. 순차 await가 이 함수의 목적이다.
 * 파일을 조각으로 읽거나 디렉터리 항목을 차례로 읽는 곳처럼 다음 위치가 앞 결과에 달린 반복에 쓴다.
 * `no-await-in-loop` 예외를 이 함수 한 곳에 모은다(eng.typescript.guide TY-22).
 */
export async function repeatAsync<T>(step: () => Promise<RepeatDone<T> | undefined>): Promise<T> {
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- 순차 await가 이 함수의 목적이다 (eng.typescript.guide TY-22)
    const next = await step();
    if (next !== undefined) return next.value;
  }
}

/**
 * 항목을 앞에서부터 하나씩 `step`에 넘긴다. `step`이 `{ value }`를 돌려주면 거기서 멈추고 그 값을 돌려준다.
 * 끝까지 `undefined`면 `undefined`를 돌려준다. 앞 항목이 끝나야 다음을 시작한다.
 */
export async function eachAsync<I, T>(
  items: Iterable<I>,
  step: (item: I) => Promise<RepeatDone<T> | undefined>,
): Promise<RepeatDone<T> | undefined> {
  for (const item of items) {
    // oxlint-disable-next-line no-await-in-loop -- 순차 await가 이 함수의 목적이다 (eng.typescript.guide TY-22)
    const next = await step(item);
    if (next !== undefined) return next;
  }
  return undefined;
}
