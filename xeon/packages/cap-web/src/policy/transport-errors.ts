import { assertNever } from "@xeon/contracts";
import type { WebFailure } from "../errors.ts";
import { deniedFailure } from "../errors.ts";
import type { TransportFailure } from "../ports/transport.ts";

/** 전송 실패를 능력 오류 값으로 바꾼다. 연결 시점 검사가 거부한 주소는 `denied`다(§4.6.3) */
export function transportFailureToWeb(failure: TransportFailure, host: string): WebFailure {
  switch (failure.kind) {
    case "blocked":
      return deniedFailure("address_blocked_at_connect", failure.message, { host });
    case "timeout":
      return { code: "timeout", message: `The request to ${host} timed out.`, detail: { host } };
    case "aborted":
      return { code: "aborted", message: "The operation was aborted." };
    case "too_large":
      return {
        code: "too_large",
        message: `The response is larger than ${failure.maxBytes} bytes.`,
        retryable: false,
        detail: { maxBytes: failure.maxBytes },
      };
    case "network":
      return {
        code: "upstream_error",
        message: `The request to ${host} failed: ${failure.message}`,
        detail: { host },
      };
    default:
      return assertNever(failure, "TransportFailure");
  }
}
