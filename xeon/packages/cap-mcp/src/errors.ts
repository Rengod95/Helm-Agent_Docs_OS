import { assertNever } from "@xeon/contracts";
import { CapabilityError, McpClient, DEFAULT_RETRYABLE } from "@xeon/contracts/capabilities";
import type { JsonValue } from "@xeon/contracts/conversation";
import type { McpFailure } from "./adapter.ts";
import type { McpMasker } from "./ports/secrets.ts";

// L2.mcp.spec §3.2 MCP_ERRORS와 공통 코드. 서비스 메서드는 CapabilityError로만 거부한다(F.capabilities.spec §3.6).

export type McpErrorCode =
  | "server_unknown"
  | "server_blocked"
  | "server_disconnected"
  | "tool_unknown"
  | "input_rounds_exceeded"
  | "input_unsupported"
  | "protocol_error"
  | "invalid_input"
  | "denied"
  | "timeout"
  | "aborted"
  | "upstream_error"
  | "unavailable"
  | "internal";

const RETRYABLE: Readonly<Record<McpErrorCode, boolean>> = {
  server_unknown: false,
  server_blocked: false,
  server_disconnected: true,
  tool_unknown: false,
  input_rounds_exceeded: false,
  input_unsupported: false,
  protocol_error: false,
  invalid_input: DEFAULT_RETRYABLE.invalid_input,
  denied: DEFAULT_RETRYABLE.denied,
  timeout: DEFAULT_RETRYABLE.timeout,
  aborted: DEFAULT_RETRYABLE.aborted,
  upstream_error: DEFAULT_RETRYABLE.upstream_error,
  unavailable: DEFAULT_RETRYABLE.unavailable,
  internal: DEFAULT_RETRYABLE.internal,
};

export function mcpError(
  method: string,
  code: McpErrorCode,
  message: string,
  detail?: JsonValue,
): CapabilityError {
  return new CapabilityError({
    capability: McpClient.id,
    method,
    code,
    message,
    retryable: RETRYABLE[code],
    ...(detail === undefined ? {} : { detail }),
  });
}

/** 어댑터가 돌려준 실패를 CapabilityError로 바꾼다. 메시지는 저장·전달 전에 마스킹한다 */
export function failureToError(
  method: string,
  failure: McpFailure,
  masker: McpMasker,
): CapabilityError {
  const message = masker.mask(failure.message);
  switch (failure.code) {
    case "timeout":
      return mcpError(method, "timeout", message);
    case "aborted":
      return mcpError(method, "aborted", message);
    case "server_disconnected":
      return mcpError(method, "server_disconnected", message);
    case "input_rounds_exceeded":
      return mcpError(method, "input_rounds_exceeded", message);
    case "server_error":
      return mcpError(
        method,
        "upstream_error",
        message,
        failure.rpcCode === undefined ? undefined : { rpcCode: failure.rpcCode },
      );
    case "connect_failed":
      return mcpError(method, "unavailable", message);
    case "protocol_error":
      return mcpError(method, "protocol_error", message);
    default:
      return assertNever(failure.code, "failureToError");
  }
}
