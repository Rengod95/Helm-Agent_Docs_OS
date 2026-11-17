// 알림 흐름 제어 시험의 픽스처(notify-gate.ts). `request.stream` 처리기는 `releaseOne`을 부를 때까지 끝나지 않는다.
// 처리가 끝나야 자식이 `event.done`을 보내므로, 이 픽스처는 확인이 늦은 자식이다. 같은 모듈 인스턴스를 시험과 자식이 함께 쓴다.
import type { ExtensionEntry } from "@fresnel/contracts/extensions";

const waiting: (() => void)[] = [];

/**
 * 시험 하나를 시작한다. 이전 시험의 처리기는 기다림 목록에서 뺀다. 그 처리기는 끝나지 않은 채 남으므로, 옛 자식이 다시 움직여
 * 이 시험의 목록을 채우지 않는다
 */
export function startFlowCase(): void {
  waiting.splice(0);
}

/** 기다리는 처리기 하나를 끝낸다. 끝낼 것이 없으면 거짓이다 */
export function releaseOne(): boolean {
  const next = waiting.shift();
  if (next === undefined) return false;
  next();
  return true;
}

export const extension: ExtensionEntry = ({ register }) => {
  register("ng", {}, (g) => {
    g.on(
      "request.stream",
      () =>
        new Promise<void>((resolve) => {
          waiting.push(resolve);
        }),
    );
  });
};
