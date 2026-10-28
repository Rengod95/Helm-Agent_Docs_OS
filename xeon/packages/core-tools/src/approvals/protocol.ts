import { assertNever, err, ok, type Result } from "@xeon/contracts";
import type { JsonObject, JsonValue } from "@xeon/contracts/conversation";
import {
  PERMISSION_MODE_STRICTNESS,
  type ApprovalDecision,
  type ApprovalRemember,
  type ApprovalRequest,
  type ApprovalRequestInput,
  type ApprovalResolution,
  type ApprovalResponse,
  type PermissionMode,
  type QuestionBody,
} from "@xeon/contracts/services";
import { isJsonObject } from "../util.ts";
import { isRequestKey } from "./keys.ts";

// L1.tools.spec §3.6 응답 규칙, §3.9 requestId 규칙, §4.7 기억 범위. kind 셋(tool, plan, question)의 요청 검사와 응답 검사.

const OPTION_ID_MAX = 32;
const QUESTION_MAX = 4;
const FREE_TEXT_MAX = 8192;
const FEEDBACK_MAX = 8192;

// ── 요청 검사 ────────────────────────────────────────────────────────────

function isMode(value: unknown): value is PermissionMode {
  return PERMISSION_MODE_STRICTNESS.some((mode) => mode === value);
}

function questionIssue(body: QuestionBody): string | undefined {
  const { questions } = body;
  if (questions.length < 1 || questions.length > QUESTION_MAX) {
    return `a question request needs 1-${QUESTION_MAX} questions`;
  }
  const ids = new Set<string>();
  for (const question of questions) {
    if (ids.has(question.id)) return `question id "${question.id}" is used more than once`;
    ids.add(question.id);
    if (question.options.length === 0 && !question.allowFreeText) {
      return `question "${question.id}" has no options and does not allow free text`;
    }
    const optionIds = new Set<string>();
    for (const option of question.options) {
      if (option.id.length < 1 || option.id.length > OPTION_ID_MAX) {
        return `option id "${option.id}" of question "${question.id}" must be 1-${OPTION_ID_MAX} characters`;
      }
      if (optionIds.has(option.id)) {
        return `option id "${option.id}" of question "${question.id}" is used more than once`;
      }
      optionIds.add(option.id);
    }
  }
  return undefined;
}

function rememberIssue(input: ApprovalRequestInput): string | undefined {
  const { remember } = input;
  if (new Set(remember).size !== remember.length) return "remember lists a scope more than once";
  if (input.body.kind === "tool") {
    return remember.includes("once") ? undefined : 'remember must offer "once"';
  }
  // 질문과 계획은 매번 다르므로 기억 범위가 없다(§3.6 표)
  return remember.length === 1 && remember[0] === "once"
    ? undefined
    : `${input.body.kind} requests offer only "once"`;
}

/**
 * 요청 입력의 의미 검사. 스키마(길이, 형식)는 approval.requested payload 검사가 하고 여기서는 스키마가 못 잡는 규칙을 본다.
 * 문제가 있으면 첫 문제의 문장을, 없으면 undefined를 돌려준다. 순수 함수.
 */
export function requestIssue(input: ApprovalRequestInput): string | undefined {
  if (!isRequestKey(input.requestKey)) return "requestKey must be 1-48 characters";
  const remember = rememberIssue(input);
  if (remember !== undefined) return remember;
  const { body } = input;
  switch (body.kind) {
    case "tool":
      return undefined;
    case "plan": {
      const modes = new Set(body.plan.nextModes);
      if (modes.size !== body.plan.nextModes.length) return "nextModes lists a mode more than once";
      return body.plan.nextModes.every(isMode) ? undefined : "nextModes has an unknown mode";
    }
    case "question":
      return questionIssue(body.question);
    case "review":
      // 검토 승인(adr.0018)의 요청 경로는 M3-REQ-74가 구현한다. 그때까지는 거부해 응답 검사 없는 대기가 생기지 않게 한다
      return "review approvals are not implemented yet";
    default:
      return assertNever(body, "requestIssue");
  }
}

// ── 응답 검사 ────────────────────────────────────────────────────────────

export type ResponseError =
  | { readonly kind: "decision_not_allowed"; readonly decision: ApprovalDecision }
  | { readonly kind: "remember_not_offered"; readonly remember: ApprovalRemember }
  | { readonly kind: "answer_invalid"; readonly message: string };

/** 클라이언트에 알릴 한 줄. 사용자가 응답을 고치는 데 필요한 만큼만 말한다 */
export function invalidDetail(error: ResponseError): string {
  switch (error.kind) {
    case "decision_not_allowed":
      return `decision "${error.decision}" does not fit this request`;
    case "remember_not_offered":
      return `remember "${error.remember}" is not offered by this request`;
    case "answer_invalid":
      return error.message;
    default:
      return assertNever(error, "invalidDetail");
  }
}

export interface AppliedResponse {
  readonly decision: ApprovalDecision;
  readonly answer: JsonValue | null;
  /** 실제 적용한 기억 범위. always는 2차 전까지 thread로 낮춘다 */
  readonly remember: ApprovalRemember;
  readonly requestedRemember: ApprovalRemember | null;
}

function rememberOf(
  request: ApprovalRequest,
  response: ApprovalResponse,
): Result<ApprovalRemember, ResponseError> {
  const asked = response.remember ?? "once";
  if (!request.remember.includes(asked)) {
    return err({ kind: "remember_not_offered", remember: asked });
  }
  return ok(asked);
}

function invalid(message: string): Result<never, ResponseError> {
  return err({ kind: "answer_invalid", message });
}

/** deny 응답의 answer. `{ feedback }` 문자열만 받고 그 밖은 버린다 */
function feedbackOf(answer: JsonValue | undefined): Result<JsonObject | null, ResponseError> {
  if (!isJsonObject(answer)) return ok(null);
  const feedback = answer["feedback"];
  if (feedback === undefined) return ok(null);
  if (typeof feedback !== "string" || feedback.length > FEEDBACK_MAX) {
    return invalid(`feedback must be a string of at most ${FEEDBACK_MAX} characters`);
  }
  return ok({ feedback });
}

/** plan allow 응답의 answer. `{ mode }`(nextModes 안)와 `{ note }`만 받는다 */
function planAnswerOf(
  request: ApprovalRequest,
  answer: JsonValue | undefined,
): Result<JsonObject | null, ResponseError> {
  if (answer === undefined || answer === null) return ok(null);
  if (!isJsonObject(answer)) return invalid("a plan answer must be an object");
  const out: Record<string, JsonValue> = {};
  const mode = answer["mode"];
  if (mode !== undefined) {
    const offered = request.body.kind === "plan" ? request.body.plan.nextModes : [];
    if (!isMode(mode) || !offered.includes(mode)) {
      return invalid("mode is not one of the offered next modes");
    }
    out["mode"] = mode;
  }
  const note = answer["note"];
  if (note !== undefined) {
    if (typeof note !== "string" || note.length > FEEDBACK_MAX) {
      return invalid(`note must be a string of at most ${FEEDBACK_MAX} characters`);
    }
    out["note"] = note;
  }
  return ok(Object.keys(out).length === 0 ? null : out);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

/**
 * 질문 응답(`QuestionAnswer`)을 질문 묶음에 대조한다. 모든 질문에 답이 하나씩 있고, 선택한 id는 그 질문의 선택지에 있고,
 * 다중 선택이 아니면 하나만 고르고, 자유 입력이 허용되지 않으면 text가 없다. 답이 완전히 비면 거부한다.
 */
function checkQuestionAnswer(
  body: QuestionBody,
  answer: JsonValue | undefined,
): Result<JsonObject, ResponseError> {
  if (!isJsonObject(answer)) return invalid("a question answer must be an object");
  const known = new Set(body.questions.map((question) => question.id));
  for (const key of Object.keys(answer)) {
    if (!known.has(key)) return invalid(`answer for unknown question "${key}"`);
  }
  const out: Record<string, JsonValue> = {};
  for (const question of body.questions) {
    const item = answer[question.id];
    if (!isJsonObject(item)) return invalid(`question "${question.id}" has no answer`);
    for (const key of Object.keys(item)) {
      if (key !== "selected" && key !== "text") {
        return invalid(`answer for "${question.id}" has an unknown field "${key}"`);
      }
    }
    const selected = item["selected"];
    if (!isStringArray(selected)) return invalid(`"${question.id}".selected must be a string list`);
    const optionIds = new Set(question.options.map((option) => option.id));
    if (new Set(selected).size !== selected.length) {
      return invalid(`"${question.id}".selected lists an option more than once`);
    }
    for (const id of selected) {
      if (!optionIds.has(id)) return invalid(`"${question.id}" has no option "${id}"`);
    }
    if (!question.multiSelect && selected.length > 1) {
      return invalid(`"${question.id}" accepts a single selection`);
    }
    const text = item["text"];
    if (text !== undefined && (typeof text !== "string" || text.length > FREE_TEXT_MAX)) {
      return invalid(
        `"${question.id}".text must be a string of at most ${FREE_TEXT_MAX} characters`,
      );
    }
    const hasText = typeof text === "string" && text.length > 0;
    if (hasText && !question.allowFreeText) {
      return invalid(`"${question.id}" does not allow free text`);
    }
    if (selected.length === 0 && !hasText) return invalid(`"${question.id}" has an empty answer`);
    out[question.id] = hasText ? { selected: [...selected], text } : { selected: [...selected] };
  }
  return ok(out);
}

/**
 * 요청 kind에 맞는 응답인지 검사한다(L1.tools.spec §3.6 표).
 * tool: allow·deny, 기억 범위 once·thread·always. plan: allow·deny(allow는 `{ mode }` 선택). question: answer·deny.
 * deny의 answer는 `{ feedback }`만 받고 그 밖의 answer는 버린다.
 */
export function validateResponse(
  request: ApprovalRequest,
  response: ApprovalResponse,
): Result<AppliedResponse, ResponseError> {
  const { decision } = response;
  const remembered = rememberOf(request, response);
  if (!remembered.ok) return remembered;
  const asked = remembered.value;
  const applied = (answer: JsonValue | null): Result<AppliedResponse, ResponseError> =>
    ok({
      decision,
      answer,
      remember: asked === "always" ? "thread" : asked,
      requestedRemember: response.remember ?? null,
    });

  if (decision === "deny") {
    const feedback = feedbackOf(response.answer);
    return feedback.ok ? applied(feedback.value) : feedback;
  }
  switch (request.body.kind) {
    case "tool":
      return decision === "allow" ? applied(null) : err({ kind: "decision_not_allowed", decision });
    case "plan": {
      if (decision !== "allow") return err({ kind: "decision_not_allowed", decision });
      const answer = planAnswerOf(request, response.answer);
      return answer.ok ? applied(answer.value) : answer;
    }
    case "question": {
      if (decision !== "answer") return err({ kind: "decision_not_allowed", decision });
      const answer = checkQuestionAnswer(request.body.question, response.answer);
      return answer.ok ? applied(answer.value) : answer;
    }
    case "review":
      // requestIssue가 이 kind의 요청을 막으므로 도달하지 않는다. 구현(M3-REQ-74) 전까지 모든 응답을 거부한다
      return err({ kind: "decision_not_allowed", decision });
    default:
      return assertNever(request.body, "validateResponse");
  }
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
