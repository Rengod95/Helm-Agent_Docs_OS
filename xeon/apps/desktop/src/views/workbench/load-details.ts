// 항목마다 부르는 읽기(`ext.get`)를 동시에 `limit`개까지만 보낸다. 거부는 값으로 바꾸므로 한 항목의 실패가 나머지를 멈추지 않는다.
import { attemptAsync, Bug, type Result, type Thrown } from "@fresnel/contracts";

/** 항목 하나와 그 읽기 결과. 결과의 순서는 입력 순서와 같다 */
export interface Settled<T, R> {
  readonly item: T;
  readonly result: Result<R, Thrown>;
}

export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => PromiseLike<R>,
): Promise<readonly Settled<T, R>[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Bug(`mapLimited: limit must be a positive integer, got ${String(limit)}`);
  }
  // 일꾼들이 반복자 하나를 나눠 쓴다. next()는 동기 호출이라 두 일꾼이 같은 항목을 받지 않는다
  const queue = items.entries();
  const slots: Settled<T, R>[] = [];
  const worker = async (): Promise<void> => {
    const next = queue.next();
    if (next.done) return;
    const [index, item] = next.value;
    slots[index] = { item, result: await attemptAsync(() => run(item)) };
    await worker();
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return slots;
}
