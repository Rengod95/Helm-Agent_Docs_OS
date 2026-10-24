import { parse } from "@xeon/contracts";
import {
  McpInputRequiredSchema,
  decodeMcpAnswer,
  planMcpQuestionBody,
  uniformMcpAnswer,
  type CallContinuation,
  type McpInputRequired,
} from "@xeon/contracts/capabilities";
import { QuestionAnswerSchema } from "@xeon/contracts/records";
import type {
  ApprovalOrigin,
  ApprovalRequestError,
  ApprovalRequestInput,
  OpenedApproval,
} from "@xeon/contracts/services";
import type { Result } from "@xeon/contracts";
import { describeFailure } from "./commit.ts";
import { requestKeyFor } from "./approvals/keys.ts";
import type { RawCall } from "./types.ts";
import { sha256HexSync } from "./util.ts";

// 결정 D5 (a), L1.tools.spec §4.3 `input_required` 출력 변형, L2.mcp.spec §4.6. 승인 id가 없는 변형(MCP의 `inputRequests`)을 질문 승인(kind
// `question`)으로 올리고, 사용자 답을 `inputResponses`로 되돌려 같은 호출을 `CallOptions.continuation`과 함께 다시 부를 수 있게 한다.
// 질문 옮기기와 답 되돌리기 규칙은 F `defs/mcp-questions.ts`가 가진다. 이 파일은 승인 서비스와 이어 붙이기만 한다.

/** 어댑터가 쓰는 승인 서비스의 부분. `ApprovalService`의 `open`·`wait`·`get`을 `runtime.ts`가 묶어 준다 */
export interface InputBridge {
  /** 승인 해결 대기. 호출 신호가 끊기면 그 승인을 닫고 "aborted"를 돌려준다 */
  readonly wait: (approvalId: string, signal: AbortSignal) => Promise<InputWaitResult>;
  readonly open: (
    input: ApprovalRequestInput,
  ) => Promise<Result<OpenedApproval, ApprovalRequestError>>;
  readonly get: (approvalId: string) => OpenedApproval | undefined;
}

/** 승인 해결을 기다린 결과. resolved면 도구를 같은 입력으로 다시 부른다 */
export type InputWaitResult = "resolved" | "aborted" | "unknown";

/** 출력이 가리키는 입력 요청의 종류 */
export type InputRequest =
  | { readonly kind: "approval"; readonly approvalId: string }
  | { readonly kind: "mcp"; readonly request: McpInputRequired }
  | { readonly kind: "invalid"; readonly detail: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 출력이 `status: "input_required"` 변형이면 종류를 가린다. 아니면 undefined(일반 결과).
 * 판별 필드는 `status`이고 L2 능력(dialog.ask, work.plans)은 자기가 올린 승인의 `approvalId`를 싣는다. `approvalId`가 없으면
 * MCP의 `McpInputRequired`여야 하고, 그 모양이 아니면 invalid다(일반 결과로 흘려 보내지 않는다)
 */
export function inputRequestOf(output: unknown): InputRequest | undefined {
  if (!isRecord(output) || output["status"] !== "input_required") return undefined;
  const approvalId = output["approvalId"];
  if (approvalId !== undefined) {
    return typeof approvalId === "string" && approvalId.length > 0
      ? { kind: "approval", approvalId }
      : { kind: "invalid", detail: "approvalId is not a non-empty string" };
  }
  const mcp = parse(McpInputRequiredSchema, output);
  return mcp.ok
    ? { kind: "mcp", request: mcp.value }
    : {
        kind: "invalid",
        detail: "the variant is neither an approval wait nor an MCP input request",
      };
}

/**
 * 직접 등록 도구(`DirectToolRegistration.executeWithContinuation`)의 결과를 `McpInputRequired`로 읽는다. 결과가 `input_required`가 아니면
 * undefined, 그 모양이 어긋나면 invalid다. 라운드와 질문은 `details`, 요청 본문과 상태는 `inputRequired`에 있다
 */
export function inputRequestOfResult(result: {
  readonly status?: "complete" | "input_required" | undefined;
  readonly details?: unknown;
  readonly inputRequired?:
    | { readonly inputRequests: unknown; readonly requestState: unknown }
    | undefined;
}): InputRequest | undefined {
  if (result.status !== "input_required") return undefined;
  const details = isRecord(result.details) ? result.details : undefined;
  const parsed = parse(McpInputRequiredSchema, {
    status: "input_required",
    round: details?.["round"],
    inputRequests: result.inputRequired?.inputRequests,
    requestState: result.inputRequired?.requestState,
    questions: details?.["questions"],
  });
  return parsed.ok
    ? { kind: "mcp", request: parsed.value }
    : { kind: "invalid", detail: "the tool result is not an MCP input request" };
}

export type McpInputStep =
  /** 다시 부를 연속 정보 */
  | { readonly kind: "retry"; readonly continuation: CallContinuation }
  /** 호출을 여기서 끝낸다. 모델에 보일 문장과 코드 */
  | {
      readonly kind: "stopped";
      readonly code: string;
      readonly text: string;
      readonly interrupted: boolean;
    };

function stopped(code: string, text: string, interrupted: boolean = false): McpInputStep {
  return { kind: "stopped", code, text, interrupted };
}

/** 승인 요청 제목(1~120자). 서버와 도구 이름을 드러낸다 */
function titleOf(toolName: string, request: McpInputRequired): string {
  const server = request.questions[0]?.server;
  const text =
    server === undefined
      ? `${toolName} needs more input`
      : `${server} asks for input (${toolName})`;
  return text.slice(0, 120);
}

/**
 * 질문 승인의 멱등 키(1~48자): `mcp:<toolCallId 해시>#r<round>`. 라운드마다 다른 요청이고, 같은 호출의 같은 라운드는 재시작 뒤에도 같은 키라
 * 기록된 요청을 이어 받는다(L1.tools.spec §8.3 F 요청 12)
 */
function mcpQuestionKey(toolCallId: string, round: number): string {
  return requestKeyFor(`mcp:${sha256HexSync(toolCallId).slice(0, 32)}#r${round}`);
}

/**
 * `McpInputRequired` 하나를 사용자에게 묻고 답을 연속 정보로 만든다.
 * - 대화형이 아니면 `open`이 요청과 거부 해결을 한 커밋에 쓰고, 모든 질문에 decline으로 답한다.
 * - 승인이 거부·취소로 닫혀도 서버에는 같은 방식(decline, cancel)으로 답한다. 서버가 요청을 마무리할 수 있다.
 * - 호출 신호가 끊기면 요청을 닫고 중단 결과다. 사용자 답이 질문과 맞지 않으면(JSON 폼 파싱 실패 등) 오류 결과로 모델에 알린다.
 */
export async function answerMcpInput(input: {
  readonly toolName: string;
  readonly request: McpInputRequired;
  readonly call: RawCall;
  readonly bridge: InputBridge;
}): Promise<McpInputStep> {
  const { toolName, request, call, bridge } = input;
  const planned = planMcpQuestionBody(request.questions);
  if (!planned.ok) {
    return stopped(
      "input_questions_too_many",
      `[xeon:input_questions_too_many] ${toolName} asked ${planned.error.count} questions at once and the user can be asked at most 4.`,
    );
  }
  const origin: ApprovalOrigin = {
    threadId: call.run.threadId,
    turnId: call.run.turnId,
    stepId: call.run.stepId,
    toolCallId: call.toolCallId,
    caller: call.run.caller,
  };
  const opened = await bridge.open({
    origin,
    requestKey: mcpQuestionKey(call.toolCallId, request.round),
    title: titleOf(toolName, request),
    body: { kind: "question", question: planned.value.body },
    remember: ["once"],
  });
  if (!opened.ok) {
    const failure = opened.error;
    const detail =
      failure.kind === "store"
        ? describeFailure({ kind: "store", error: failure.error })
        : describeFailure(failure);
    return stopped(
      "input_request_failed",
      `[xeon:input_request_failed] The question for ${toolName} could not be recorded: ${detail}`,
    );
  }
  const approvalId = opened.value.request.approvalId;
  const waited = await bridge.wait(approvalId, call.signal);
  if (waited === "aborted") {
    return stopped(
      "aborted",
      "[aborted] The tool call was cancelled while waiting for the user.",
      true,
    );
  }
  const resolution = waited === "resolved" ? bridge.get(approvalId)?.resolution : undefined;
  if (resolution === undefined || resolution === null) {
    return stopped(
      "approval_unknown",
      `[xeon:approval_unknown] ${toolName} is waiting for an approval that this runtime does not know.`,
    );
  }
  const continuation = (inputResponses: CallContinuation["inputResponses"]): McpInputStep => ({
    kind: "retry",
    continuation: { round: request.round + 1, inputResponses, requestState: request.requestState },
  });
  if (resolution.decision !== "answer") {
    const uniform = uniformMcpAnswer(
      request.questions,
      resolution.resolvedBy === "cancelled" ? "cancel" : "decline",
    );
    return uniform.ok
      ? continuation(uniform.value)
      : stopped(
          "input_answer_invalid",
          `[xeon:input_answer_invalid] The server's input request could not be declined: ${uniform.error.kind}`,
        );
  }
  const answer = parse(QuestionAnswerSchema, resolution.answer);
  if (!answer.ok) {
    return stopped(
      "input_answer_invalid",
      "[xeon:input_answer_invalid] The recorded answer is not a question answer.",
    );
  }
  const decoded = decodeMcpAnswer(planned.value, answer.value);
  if (!decoded.ok) {
    return stopped(
      "input_answer_invalid",
      `[xeon:input_answer_invalid] The user's answer does not fit the server's request (${decoded.error.kind}).`,
    );
  }
  return continuation(decoded.value);
}
