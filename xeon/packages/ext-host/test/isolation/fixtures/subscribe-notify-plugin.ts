// 격리 구독 시험의 픽스처. `request.stream`을 `coalesce`로 구독하고, 받은 봉투의 `eventKey`와 `dropped`를 `seen`에 적는다.
// 첫 전달은 `release`를 부를 때까지 끝나지 않는다. 같은 모듈 인스턴스를 엔진 안 시험과 격리 자식이 함께 쓴다.
import type { ExtensionEntry } from "@fresnel/contracts/extensions";

export interface SeenEnvelope {
  readonly eventKey: string;
  readonly dropped: number | undefined;
}

export const seen: SeenEnvelope[] = [];

let first = true;
let unblock: () => void = () => undefined;
let blocked: Promise<void> = Promise.resolve();

/** 시험 하나를 준비한다. 기록을 비우고 첫 전달을 막는다 */
export function arm(): void {
  seen.splice(0);
  first = true;
  blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
}

/** 막아 둔 첫 전달을 끝낸다 */
export function release(): void {
  unblock();
}

export const extension: ExtensionEntry = ({ register }) => {
  register("sn", {}, (g) => {
    g.subscribe(
      ["request.stream"],
      async (event) => {
        seen.push({ eventKey: event.eventKey, dropped: event.dropped });
        if (first) {
          first = false;
          await blocked;
        }
      },
      { sample: "coalesce" },
    );
  });
};
