import { Bug } from "@xeon/contracts";
import { CapabilityError } from "@xeon/contracts/capabilities";
import type { WebFailure } from "./errors.ts";
import { WebHttpError } from "./policy/guarded-http.ts";

// provider 코드(플러그인)가 던진 값을 능력 오류 값으로 바꾼다. provider는 외부 코드라 무엇이든 던질 수 있다.
// 던진 원인은 호출한 쪽이 주입된 Logger로 기록한다(TY-25).

function isAbortError(caught: unknown): boolean {
  return caught instanceof Error && caught.name === "AbortError";
}

export function failureOfThrown(caught: unknown, provider: string): WebFailure {
  // Bug는 불변 조건 위반이다. 다음 후보로 넘기지 않고 그대로 올린다
  if (caught instanceof Bug) throw caught;
  if (caught instanceof CapabilityError) {
    const data = caught.data;
    return {
      code: data.code,
      message: data.message,
      retryable: data.retryable,
      provider,
      ...(data.retryAfterMs === undefined ? {} : { retryAfterMs: data.retryAfterMs }),
      ...(data.detail === undefined ? {} : { detail: data.detail }),
    };
  }
  if (caught instanceof WebHttpError) return { ...caught.failure, provider };
  if (isAbortError(caught))
    return { code: "aborted", message: "The operation was aborted.", provider };
  return {
    code: "upstream_error",
    message: `${provider} failed: ${caught instanceof Error ? caught.message : "unexpected error"}`,
    provider,
  };
}
