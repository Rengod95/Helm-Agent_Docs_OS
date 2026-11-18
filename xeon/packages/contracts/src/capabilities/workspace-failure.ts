import type { JsonValue } from "../conversation/index.ts";
import { DEFAULT_RETRYABLE, type CommonErrorCode } from "./errors.ts";

// L2.workspace.spec §4.1. 작업 공간 기능의 본문과 경로 검사는 WorkspaceFailure를 던지고, 서비스 경계(`guarded`)가 CapabilityError로 바꾼다.
// 이 파일은 클래스만 둔다. FileError·ExecutionError를 CapabilityError 코드로 바꾸는 함수는 services 층의 값을 쓰므로
// capabilities 층에 둘 수 없다(test/import-order.test.ts). 그 함수와 `guarded`는 코어 패키지가 두고 기능 묶음으로 넘긴다.

/** 이 패키지 안에서 던지는 실패. 서비스 경계에서 `CapabilityError`로 바뀐다 */
export class WorkspaceFailure extends Error {
  override readonly name: string = "WorkspaceFailure";
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
