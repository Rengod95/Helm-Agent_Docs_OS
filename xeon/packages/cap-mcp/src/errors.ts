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
  /** 호출을 시작한 뒤 실패까지 걸린 시간(밀리초). 연결이 끊긴 문구에 쓴다 */
  readonly elapsedMs?: number;
}

const CALL_LIMIT_NOTE = "(설정: MCP 호출 제한 시간, l2.mcp.callTimeoutMs)";

/** 문구의 주어: "서버 qa", 도구 호출이면 "서버 qa의 도구 echo". 서버 이름 뒤에 조사를 붙이지 않는다(id마다 받침이 다르다) */
function subjectOf(context: McpFailureContext): string {
  return context.tool === undefined
    ? `서버 ${context.server}`
    : `서버 ${context.server}의 도구 ${context.tool}`;
}

/** "호출한 지 1초 안에"(1초가 안 되면) 또는 "호출한 지 N초 뒤" */
function elapsedOf(elapsedMs: number): string {
  return elapsedMs < 1000
    ? "호출한 지 1초 안에"
    : `호출한 지 ${String(Math.round(elapsedMs / 1000))}초 뒤`;
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
        context.elapsedMs === undefined
          ? `서버 ${context.server}의 연결이 끊겼어요. 자동으로 다시 연결해요`
          : `${subject} 호출 중에 연결이 끊겼어요 (${elapsedOf(context.elapsedMs)}). 자동으로 다시 연결해요`,
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

// ── 호출 전에 거절하는 문구 ─────────────────────────────────────────────────
// 서버 id와 도구 이름 뒤에는 받침에 따라 달라지는 조사(은/는, 이/가, 을/를)를 붙이지 않는다. "에", "의", "로"는 쓴다(`서버 qa의`).

/** 호출이 막힌 사유의 한국어 말 */
const BLOCKED_REASON_TEXT: Readonly<Record<string, string>> = {
  approval_required: "기동 승인을 기다리는 중",
  denied_by_policy: "차단 목록에 있음",
  not_in_allowlist: "허용 목록에 없음",
  managed_only: "관리 정책이 허용한 서버만 쓸 수 있음",
  untrusted_project: "작업 폴더를 신뢰하지 않음",
  sandbox_unavailable: "이 기기에서 격리할 수 없음",
};

export function serverUnknownText(server: string): string {
  return `MCP 서버를 찾을 수 없어요: ${server}`;
}

export function serverBlockedText(server: string, reason: string | undefined): string {
  const why = reason === undefined ? undefined : BLOCKED_REASON_TEXT[reason];
  return `서버 ${server}의 시작이 막혀 있어 호출할 수 없어요${why === undefined ? "" : ` (사유: ${why})`}`;
}

const NOT_READY_TEXT: Readonly<Record<string, string>> = {
  connecting: "에 연결하는 중이라 호출할 수 없어요. 잠시 뒤에 다시 시도해 주세요",
  reconnecting: "에 다시 연결하는 중이라 호출할 수 없어요. 잠시 뒤에 다시 시도해 주세요",
  failed: "의 시작이 실패한 상태라 호출할 수 없어요. 설정의 MCP 서버에서 다시 시작해 보세요",
  disabled: "의 연결이 꺼져 있어 호출할 수 없어요",
};

/** 연결되지 않은 서버를 호출했을 때의 문구. `state`는 서버 상태 이름이다 */
export function serverNotReadyText(server: string, state: string): string {
  return `서버 ${server}${NOT_READY_TEXT[state] ?? "에 연결되어 있지 않아 호출할 수 없어요"}`;
}

export function serverNotConnectedText(server: string): string {
  return `서버 ${server}에 연결되어 있지 않아 호출할 수 없어요`;
}

export function toolUnknownText(server: string, tool: string): string {
  return `서버 ${server}에 이름이 ${tool}인 도구가 없어요`;
}

export function toolHiddenText(server: string, tool: string): string {
  return `서버 ${server}의 도구 ${tool} 호출은 서버 정의에서 노출하지 않기로 해서 거절했어요`;
}

export function toolDeniedByModeText(server: string, tool: string): string {
  return `서버 ${server}의 도구 ${tool} 호출은 승인 모드가 거부(deny)라서 거절했어요 (설정: l2.mcp.approvalMode)`;
}

export function inputRoundsText(max: number): string {
  return `서버가 사용자 입력을 ${String(max)}번보다 많이 요청해서 멈췄어요`;
}

export function roundLimitText(round: number, max: number): string {
  return `입력 ${String(round)}번째 차례가 한도 ${String(max)}번을 넘었어요`;
}
