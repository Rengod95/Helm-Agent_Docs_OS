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

export type RunFailureCode =
  | "commit_failed"
  | "model_unavailable"
  | "context_unavailable"
  | "tools_unavailable"
  | "invariant";

/**
 * agent-core 싱크·훅에서 던져 run을 멈추는 값(L1.loop.spec §3.3 "리스너 예외", §4.2 규칙 6).
 * 래퍼가 run 거부를 잡아 T6 `failed`, `error: "loop_rejected"`로 바꾼다. 흐름 제어용 throw라
 * eng.typescript.guide TY-11 허용 경우 3(라이브러리 콜백 계약)에 해당하며 호출부는 `throw failure` 형태로만 던진다.
 */
export class RunFailure extends Error {
  override readonly name: string = "RunFailure";
  readonly code: RunFailureCode;

  constructor(code: RunFailureCode, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}
