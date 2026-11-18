import { assertNever, Bug } from "@fresnel/contracts";
import {
  CapabilityError,
  DEFAULT_RETRYABLE,
  WorkspaceFailure,
  type CapabilityId,
  type CommonErrorCode,
} from "@fresnel/contracts/capabilities";
import type { JsonValue } from "@fresnel/contracts/conversation";
import {
  ExecutionError,
  FileError,
  type ExecutionErrorCode,
  type FileErrorCode,
} from "@fresnel/contracts/services";

// L2.workspace.spec §4.1. 포크 본문과 경로 검사는 WorkspaceFailure, FileError, ExecutionError를 던지고,
// 서비스 경계(guarded)가 CapabilityError로 바꾼다. 서비스 메서드는 CapabilityError로만 거부한다(F.capabilities.spec §3.6).
// WorkspaceFailure 클래스는 F(`@fresnel/contracts/capabilities`)가 정의하고 이 패키지와 기능 패키지가 같은 것을 쓴다(instanceof 동일성).
// 여기 함수들은 FileError·ExecutionError 값을 알아야 하므로 코어에 둔다.

export { WorkspaceFailure };

/** 표: FileErrorCode → CapabilityError.code (spec §4.1) */
export function fileErrorCode(code: FileErrorCode): CommonErrorCode {
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

/**
 * 표: ExecutionErrorCode → CapabilityError.code (spec §4.1). Fresnel 추가 코드 넷은 표에 없어 가장 보수적인 쪽으로
 * 정한다: 막은 것은 denied(`detail.by`로 출처), 샌드박스 래핑 실패는 internal.
 */
export function executionErrorCode(code: ExecutionErrorCode): CommonErrorCode {
  switch (code) {
    case "aborted":
      return "aborted";
    case "timeout":
      return "timeout";
    case "shell_unavailable":
      return "unavailable";
    case "spawn_error":
    case "callback_error":
    case "unknown":
    case "sandbox_failed":
      return "internal";
    case "env_denied":
    case "secret_unavailable":
    case "sandbox_unavailable":
      return "denied";
    default:
      return assertNever(code, "ExecutionErrorCode");
  }
}

/** denied의 `detail.by`. 어느 층이 막았는지 */
function deniedBy(code: ExecutionErrorCode): JsonValue | undefined {
  switch (code) {
    case "env_denied":
      return { by: "exec", reason: code };
    case "secret_unavailable":
      return { by: "secrets", reason: code };
    case "sandbox_unavailable":
    case "sandbox_failed":
      return { by: "sandbox", reason: code };
    case "aborted":
    case "timeout":
    case "shell_unavailable":
    case "spawn_error":
    case "callback_error":
    case "unknown":
      return undefined;
    default:
      return assertNever(code, "ExecutionErrorCode");
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
  if (caught instanceof WorkspaceFailure) {
    return make(caught.code, caught.message, caught.retryable, caught.detail);
  }
  if (caught instanceof FileError) {
    const code = fileErrorCode(caught.code);
    return make(code, caught.message, DEFAULT_RETRYABLE[code]);
  }
  if (caught instanceof ExecutionError) {
    const code = executionErrorCode(caught.code);
    return make(code, caught.message, DEFAULT_RETRYABLE[code], deniedBy(caught.code));
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
