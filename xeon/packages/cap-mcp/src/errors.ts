import { assertNever } from "@fresnel/contracts";
import { CapabilityError, McpClient, DEFAULT_RETRYABLE } from "@fresnel/contracts/capabilities";
import type { JsonValue } from "@fresnel/contracts/conversation";
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

/** 실패가 난 호출의 맥락. 한국어 문구에 서버 이름, 도구 이름, 제한 시간을 넣는다 */
export interface McpFailureContext {
  readonly server: string;
  readonly tool?: string;
  /** 이 호출에 적용한 제한 시간(밀리초). 시간 초과 문구에 쓴다 */
  readonly timeoutMs?: number;
}

const CALL_LIMIT_NOTE = "(설정: MCP 호출 제한 시간, l2.mcp.callTimeoutMs)";

/** 문구의 주어: "서버 qa", 도구 호출이면 "서버 qa의 도구 echo". 서버 이름 뒤에 조사를 붙이지 않는다(id마다 받침이 다르다) */
function subjectOf(context: McpFailureContext): string {
  return context.tool === undefined
    ? `서버 ${context.server}`
    : `서버 ${context.server}의 도구 ${context.tool}`;
}

function waitedOf(timeoutMs: number | undefined): string {
  return timeoutMs === undefined ? "제한 시간이 지나" : `${timeoutMs / 1000}초 뒤`;
}

/**
 * 어댑터가 돌려준 실패를 CapabilityError로 바꾼다. 문구는 한국어다. 서버가 준 영어 원문은 마스킹한 뒤에만 덧붙인다.
 * 메시지는 저장·전달 전에 마스킹한다
 */
export function failureToError(
  method: string,
  failure: McpFailure,
  masker: McpMasker,
  context: McpFailureContext,
): CapabilityError {
  const subject = subjectOf(context);
  const original = masker.mask(failure.message);
  switch (failure.code) {
    case "timeout":
      return mcpError(
        method,
        "timeout",
        `${subject} 호출이 응답하지 않아 ${waitedOf(context.timeoutMs)} 끊었어요 ${CALL_LIMIT_NOTE}`,
      );
    case "aborted":
      return mcpError(method, "aborted", `${subject} 호출을 중단했어요`);
    case "server_disconnected":
      return mcpError(
        method,
        "server_disconnected",
        `서버 ${context.server}의 연결이 끊겼어요. 자동으로 다시 연결해요`,
      );
    case "input_rounds_exceeded":
      return mcpError(
        method,
        "input_rounds_exceeded",
        `${subject} 호출이 사용자 입력을 너무 여러 번 요청했어요`,
      );
    case "server_error":
      return mcpError(
        method,
        "upstream_error",
        `${subject} 호출에서 오류가 났어요: ${original}`,
        failure.rpcCode === undefined ? undefined : { rpcCode: failure.rpcCode },
      );
    case "connect_failed":
      return mcpError(
        method,
        "unavailable",
        `서버 ${context.server}에 연결하지 못했어요: ${original}`,
      );
    case "protocol_error":
      return mcpError(
        method,
        "protocol_error",
        `${subject} 호출이 MCP 사양에 맞지 않는 응답을 받았어요`,
      );
    default:
      return assertNever(failure.code, "failureToError");
  }
}
