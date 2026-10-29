import { POINTS, type Fold, type Handler, type PointName } from "@xeon/contracts/extensions";
import type { MetricsCounter } from "./counter.ts";

/**
 * on 핸들러를 감싸 계수를 올린다(L3.group-kit.spec §4.9). first 지점의 정의 반환은 `denies`, chain 지점의 정의 반환은
 * `chainPatches`, 던진 오류는 `handlerErrors`다. 값과 오류는 바꾸지 않는다: 오류는 그대로 다시 던진다.
 *
 * 감싼 함수는 Proxy의 apply 덫이다. 원래 핸들러의 타입 `Handler<N, S>`을 그대로 가지므로 단언이 필요 없다.
 */
export function countedHandler<N extends PointName, S>(
  point: N,
  handler: Handler<N, S>,
  counter: MetricsCounter,
): Handler<N, S> {
  const fold = POINTS[point].fold;
  return new Proxy(handler, {
    apply(target, thisArg, args: readonly unknown[]) {
      let result: unknown;
      try {
        result = Reflect.apply(target, thisArg, args);
      } catch (caught) {
        counter.bump("handlerErrors");
        throw caught;
      }
      if (result instanceof Promise) {
        return result.then(
          (value: unknown) => {
            countReturn(fold, value, counter);
            return value;
          },
          (caught: unknown) => {
            counter.bump("handlerErrors");
            throw caught;
          },
        );
      }
      countReturn(fold, result, counter);
      return result;
    },
  });
}

/** 정의된 반환만 센다. undefined는 "결정하지 않음"이라 세지 않는다 */
function countReturn(fold: Fold, value: unknown, counter: MetricsCounter): void {
  if (value === undefined) return;
  if (fold === "first") counter.bump("denies");
  else if (fold === "chain") counter.bump("chainPatches");
}
