import { err, ok, type Result } from "@xeon/contracts";
import { commitKeyPart } from "@xeon/contracts/records";
import type {
  ApprovalDecision,
  ApprovalRemember,
  ApprovalRequest,
  ApprovalResolution,
  ApprovalResponse,
} from "@xeon/contracts/services";
import type { JsonValue } from "@xeon/contracts/conversation";
import { isJsonObject, sha256HexSync } from "../util.ts";

// L1.tools.spec §3.6 응답 규칙, §3.9 requestId 규칙, §4.7 기억 범위. M1은 kind "tool"만 응답을 받는다.

const REQUEST_KEY_MAX = 48;
const REQUEST_ID_MAX = 64;
/** requestKeyFor가 길이나 문자 때문에 해시로 바꾼 키. 커밋 키 부분으로 다시 바꾸지 않는다 */
const HASHED_REQUEST_KEY = /^h_[0-9a-f]{40}$/;

/**
 * 승인 요청의 멱등 키(1~48자). 도구 승인은 toolCallId에서 만든다. toolCallId는 모델 provider가 정하는 밖의 값이라
 * 커밋 키 알파벳 밖의 문자를 가질 수 있다. 그래서 커밋 키 부분 변환(`commitKeyPart`, eng.transactions.design §4.7, U-13)을
 * 거치고, 48자를 넘으면 원문의 해시로 줄인다(결정적)
 */
export function requestKeyFor(toolCallId: string): string {
  const part = commitKeyPart(toolCallId, sha256HexSync);
  if (part.length <= REQUEST_KEY_MAX) return part;
  return `h_${sha256HexSync(toolCallId).slice(0, 40)}`;
}

/**
 * approval.requested의 커밋 키. requestKey는 호출자가 넘기는 밖의 값이라 커밋 키 부분 변환(`commitKeyPart`)을 거쳐 넣는다
 * (`requestKeyFor`가 이미 해시로 줄인 키는 그대로). 전체가 64자를 넘으면 해시로 바꾼다
 */
export function requestCommitKey(surfaceThreadId: string, requestKey: string): string {
  const part = HASHED_REQUEST_KEY.test(requestKey)
    ? requestKey
    : commitKeyPart(requestKey, sha256HexSync);
  const plain = `approval:${surfaceThreadId}:${part}:request`;
  if (plain.length <= REQUEST_ID_MAX) return plain;
  const hash = sha256HexSync(`${surfaceThreadId}:${part}`);
  return `approval:${hash.slice(0, 32)}:request`;
}

export function resolveCommitKey(approvalId: string): string {
  return `approval:${approvalId}:resolve`;
}

export type ResponseError =
  | { readonly kind: "decision_not_allowed"; readonly decision: ApprovalDecision }
  | { readonly kind: "remember_not_offered"; readonly remember: ApprovalRemember }
  | { readonly kind: "unsupported_kind"; readonly requestKind: ApprovalRequest["body"]["kind"] };

export interface AppliedResponse {
  readonly decision: "allow" | "deny";
  readonly answer: JsonValue | null;
  /** 실제 적용한 기억 범위. always는 2차 전까지 thread로 낮춘다 */
  readonly remember: ApprovalRemember;
  readonly requestedRemember: ApprovalRemember | null;
}

/** 요청 kind에 맞는 응답인지 검사한다. M1은 tool만 받는다 */
export function validateResponse(
  request: ApprovalRequest,
  response: ApprovalResponse,
): Result<AppliedResponse, ResponseError> {
  if (request.body.kind !== "tool") {
    return err({ kind: "unsupported_kind", requestKind: request.body.kind });
  }
  const { decision } = response;
  if (decision !== "allow" && decision !== "deny") {
    return err({ kind: "decision_not_allowed", decision });
  }
  const asked = response.remember ?? "once";
  if (!request.remember.includes(asked)) {
    return err({ kind: "remember_not_offered", remember: asked });
  }
  return ok({
    decision,
    // deny일 때만 { feedback }을 받는다. 그 밖의 answer는 버린다
    answer: decision === "deny" && isJsonObject(response.answer) ? response.answer : null,
    remember: asked === "always" ? "thread" : asked,
    requestedRemember: response.remember ?? null,
  });
}

const DENIED_BY_USER = "[xeon:denied_by_user] The user denied this tool call.";
const DENIED_CANCELLED =
  "[xeon:approval_cancelled] The approval request was cancelled before an answer.";

/** 사용자가 거부했을 때 모델에 보일 사유. feedback이 있으면 덧붙인다 */
export function denialReason(resolution: ApprovalResolution): string {
  if (resolution.resolvedBy === "cancelled" || resolution.resolvedBy === "superseded") {
    return DENIED_CANCELLED;
  }
  if (resolution.resolvedBy === "noninteractive") {
    return "[xeon:noninteractive_ask_denied] This tool call needs approval, but nobody can answer in a non-interactive run.";
  }
  const feedback = isJsonObject(resolution.answer) ? resolution.answer["feedback"] : undefined;
  return typeof feedback === "string" && feedback.length > 0
    ? `${DENIED_BY_USER} Feedback: ${feedback}`
    : DENIED_BY_USER;
}
