import { eachAsync } from "@xeon/contracts";

/** 앞 단계가 끝나야 다음을 시작하는 반복(시험에서 순서가 의미를 가질 때) */
export async function times(
  count: number,
  step: (index: number) => Promise<unknown>,
): Promise<void> {
  await eachAsync(
    Array.from({ length: count }, (_, index) => index),
    async (index) => {
      await step(index);
      return undefined;
    },
  );
}

export async function each<T>(
  items: readonly T[],
  step: (item: T) => Promise<unknown>,
): Promise<void> {
  await eachAsync(items, async (item) => {
    await step(item);
    return undefined;
  });
}
