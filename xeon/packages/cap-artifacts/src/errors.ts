import { CapabilityError, type CapabilityId } from "@xeon/contracts/capabilities";
import type { JsonValue } from "@xeon/contracts/conversation";
import type { ReadFailure, StoreError } from "@xeon/contracts/records";

// 서비스 메서드는 CapabilityError로만 거부한다(F.capabilities.spec §3.6). 내부 규칙은 값으로 다루고 경계에서 한 번 바꾼다.

export function reject(
  capability: CapabilityId,
  method: string,
  code: string,
  message: string,
  options: { readonly retryable?: boolean; readonly detail?: JsonValue } = {},
): CapabilityError {
  return new CapabilityError({
    capability,
    method,
    code,
    message,
    retryable: options.retryable ?? false,
    ...(options.detail === undefined ? {} : { detail: options.detail }),
  });
}

/** 저장소 실패(커밋, 읽기). 잠깐 막힌 경우(busy)만 다시 시도할 수 있다 */
export function storeRejection(
  capability: CapabilityId,
  method: string,
  error: StoreError | ReadFailure,
): CapabilityError {
  return reject(capability, method, "storage_unavailable", `The store failed: ${error.kind}.`, {
    retryable: error.kind === "busy",
  });
}
