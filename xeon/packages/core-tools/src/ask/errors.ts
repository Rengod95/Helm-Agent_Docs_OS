import { assertNever, Bug } from "@fresnel/contracts";
import {
  CapabilityError,
  DEFAULT_RETRYABLE,
  DialogFailure,
  type CapabilityId,
  type CommonErrorCode,
} from "@fresnel/contracts/capabilities";
import type { JsonValue } from "@fresnel/contracts/conversation";
import { FileError, type FileErrorCode } from "@fresnel/contracts/services";

// 이 패키지 안에서 던지는 실패와 서비스 경계 변환. 서비스 메서드는 CapabilityError로만 거부한다(F.capabilities.spec §3.6).
// `DialogFailure` 클래스는 F contracts에 있다(cap-dialog도 같은 클래스를 쓴다). 경계 변환은 `FileError`를 알아야 해서 여기 둔다.
// cap-dialog는 같은 함수를 `DialogCore`(`dialogCore`)로 받는다.

export { DialogFailure };

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

/** 던져진 값을 이 기능 메서드의 CapabilityError로 바꾼다. 버그(Bug)와 이미 바뀐 오류는 그대로 둔다 */
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
