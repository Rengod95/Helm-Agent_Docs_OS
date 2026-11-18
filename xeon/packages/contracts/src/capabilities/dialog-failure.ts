import type { JsonValue } from "../conversation/index.ts";
import { DEFAULT_RETRYABLE, type CommonErrorCode } from "./errors.ts";

// 대화 기능(dialog 도메인: 질문·알림·상태·명령·첨부)이 던지는 실패 클래스. 서비스 경계에서 `CapabilityError`로 바뀐다(F.capabilities.spec §3.6).
// 클래스만 F에 둔다. 경계 변환(`toCapabilityError`·`guarded`)은 파일 시스템 실패(`FileError`, services)를 알아야 해서 core-tools에 남고,
// cap-dialog는 `DialogCore`로 받는다(F의 import 순서: capabilities는 services를 import하지 않는다).

/** 서비스 경계에서 `CapabilityError`로 바뀌는 실패 */
export class DialogFailure extends Error {
  override readonly name: string = "DialogFailure";
  /** 공통 코드 또는 메서드 고유 코드 */
  readonly code: string;
  readonly retryable: boolean;
  readonly detail: JsonValue | undefined;

  constructor(
    code: string,
    message: string,
    options: { readonly retryable?: boolean; readonly detail?: JsonValue } = {},
  ) {
    super(message);
    this.code = code;
    this.retryable = options.retryable ?? commonRetryable(code);
    this.detail = options.detail;
  }
}

function isCommonCode(code: string): code is CommonErrorCode {
  return Object.hasOwn(DEFAULT_RETRYABLE, code);
}

function commonRetryable(code: string): boolean {
  return isCommonCode(code) ? DEFAULT_RETRYABLE[code] : false;
}
