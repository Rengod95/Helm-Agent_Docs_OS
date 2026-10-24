import type { LoopError } from "@xeon/contracts/services";

/**
 * `LoopPort`의 포트 메서드는 Result를 쓰지 않고 turn을 열기 전 실패를 Promise 거부로 알린다(L1.loop.spec §3.1 주석).
 * 거부 값은 Error여야 하므로(typescript/prefer-promise-reject-errors) LoopError를 `loopError`에 싣는다.
 * `kind`도 같은 값으로 두어 호출자가 `error.kind`로 판별할 수 있다.
 */
export class LoopRejection extends Error {
  override readonly name: string = "LoopRejection";
  readonly loopError: LoopError;
  readonly kind: LoopError["kind"];

  constructor(loopError: LoopError) {
    super(`loop rejected: ${loopError.kind}`);
    this.loopError = loopError;
    this.kind = loopError.kind;
  }
}
