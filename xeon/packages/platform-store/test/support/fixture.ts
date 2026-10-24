/** 필드를 더한 픽스처 객체. `await using`으로 닫으면 저장소가 닫힌다 */
export function disposableWith<T extends object>(
  store: AsyncDisposable,
  extra: T,
): T & AsyncDisposable {
  return { ...extra, [Symbol.asyncDispose]: (): PromiseLike<void> => store[Symbol.asyncDispose]() };
}

/** 거부된 Promise의 사유를 값으로 받는다. 거부되지 않으면 undefined */
export function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    (): undefined => undefined,
    (caught: unknown): unknown => caught,
  );
}
