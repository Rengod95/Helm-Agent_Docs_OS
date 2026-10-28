import { Bug } from "@xeon/contracts";
import {
  CapabilityError,
  DEFAULT_RETRYABLE,
  type CapabilityId,
  type CommonErrorCode,
} from "@xeon/contracts/capabilities";
import type { JsonValue } from "@xeon/contracts/conversation";
import type { Result } from "@xeon/contracts";

// L2.web.spec §5. 내부 실패는 값(WebFailure)으로 다루고, 서비스 경계에서만 CapabilityError로 거부한다
// (F.capabilities.spec §3.6: 서비스 메서드는 CapabilityError로만 거부한다).

/** CapabilityErrorData에서 호출 문맥(capability, method)을 뺀 모양. 공통 코드 또는 메서드 고유 코드를 `code`에 담는다 */
export interface WebFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly retryAfterMs?: number;
  readonly provider?: string;
  readonly detail?: JsonValue;
}

function isCommonCode(code: string): code is CommonErrorCode {
  return Object.hasOwn(DEFAULT_RETRYABLE, code);
}

export function deniedFailure(
  reason: string,
  message: string,
  extra: Readonly<Record<string, JsonValue>> = {},
): WebFailure {
  return { code: "denied", message, detail: { reason, ...extra } };
}

export function invalidInput(
  message: string,
  extra?: Readonly<Record<string, JsonValue>>,
): WebFailure {
  return extra === undefined
    ? { code: "invalid_input", message }
    : { code: "invalid_input", message, detail: { ...extra } };
}

export function toCapabilityError(
  capability: CapabilityId,
  method: string,
  failure: WebFailure,
): CapabilityError {
  const retryable =
    failure.retryable ?? (isCommonCode(failure.code) ? DEFAULT_RETRYABLE[failure.code] : false);
  return new CapabilityError({
    capability,
    method,
    code: failure.code,
    message: failure.message,
    retryable,
    ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
    ...(failure.provider === undefined ? {} : { provider: failure.provider }),
    ...(failure.detail === undefined ? {} : { detail: failure.detail }),
  });
}

function isAbortError(caught: unknown): boolean {
  return caught instanceof Error && caught.name === "AbortError";
}

/**
 * 메서드 본문을 실행하고 실패 값을 CapabilityError로 거부한다. 던져진 CapabilityError와 Bug는 그대로 두고, 취소는
 * `aborted`로 바꾼다. 그 밖의 예기치 않은 예외는 다시 던진다(삼키지 않는다).
 */
export async function guarded<T>(
  capability: CapabilityId,
  method: string,
  run: () => Promise<Result<T, WebFailure>>,
): Promise<T> {
  let outcome: Result<T, WebFailure>;
  try {
    outcome = await run();
  } catch (caught) {
    if (caught instanceof CapabilityError || caught instanceof Bug) throw caught;
    if (isAbortError(caught)) {
      throw toCapabilityError(capability, method, {
        code: "aborted",
        message: "The operation was aborted.",
      });
    }
    throw caught;
  }
  if (!outcome.ok) throw toCapabilityError(capability, method, outcome.error);
  return outcome.value;
}
