import { assertNever, Bug } from "@xeon/contracts";
import {
  CapabilityError,
  DEFAULT_RETRYABLE,
  type CapabilityId,
  type CommonErrorCode,
} from "@xeon/contracts/capabilities";
import type { JsonValue } from "@xeon/contracts/conversation";
import { FileError, type FileErrorCode } from "@xeon/contracts/services";

// 이 패키지 안에서 던지는 실패와 서비스 경계 변환. 서비스 메서드는 CapabilityError로만 거부한다(F.capabilities.spec §3.6).

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

/** 파일 시스템 오류 코드를 공통 코드로 옮긴다(L2.workspace.spec §4.1 표와 같다) */
function fileErrorCode(code: FileErrorCode): CommonErrorCode {
  switch (code) {
    case "aborted":
      return "aborted";
    case "not_found":
      return "not_found";
    case "permission_denied":
      return "denied";
    case "not_directory":
    case "is_directory":
    case "invalid":
      return "invalid_input";
    case "not_supported":
      return "unsupported";
    case "unknown":
      return "internal";
    default:
      return assertNever(code, "FileErrorCode");
  }
}

function isAbortError(caught: unknown): boolean {
  return caught instanceof Error && caught.name === "AbortError";
}

/** 던져진 값을 이 능력 메서드의 CapabilityError로 바꾼다. 버그(Bug)와 이미 바뀐 오류는 그대로 둔다 */
export function toCapabilityError(
  capability: CapabilityId,
  method: string,
  caught: unknown,
): CapabilityError | Bug {
  if (caught instanceof CapabilityError || caught instanceof Bug) return caught;
  const make = (
    code: string,
    message: string,
    retryable: boolean,
    detail?: JsonValue,
  ): CapabilityError =>
    new CapabilityError({
      capability,
      method,
      code,
      message,
      retryable,
      ...(detail === undefined ? {} : { detail }),
    });
  if (caught instanceof DialogFailure) {
    return make(caught.code, caught.message, caught.retryable, caught.detail);
  }
  if (caught instanceof FileError) {
    const code = fileErrorCode(caught.code);
    return make(code, caught.message, DEFAULT_RETRYABLE[code]);
  }
  if (isAbortError(caught)) return make("aborted", "The operation was aborted.", false);
  const message = caught instanceof Error ? caught.message : "unexpected failure";
  return make("internal", message, false);
}

/** 메서드 본문을 실행하고 실패를 CapabilityError로 거부한다 */
export async function guarded<T>(
  capability: CapabilityId,
  method: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (caught) {
    throw toCapabilityError(capability, method, caught);
  }
}
