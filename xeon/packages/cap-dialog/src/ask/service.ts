import {
  checkAskQuestions,
  DialogAsk,
  validateAskAnswer,
  type AskQuestion,
  type AskResult,
  type CallContext,
  type CapabilityApi,
} from "@xeon/contracts/capabilities";
import { assertNever } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { ApprovalRequestError, L2ApprovalSnapshot } from "@xeon/contracts/services";
import type { DialogDeps } from "../deps.ts";
import { DialogFailure, guarded } from "../errors.ts";
import { createAskExpiry, type AskExpiry } from "./expiry.ts";
import { approvalKeyOf } from "./keys.ts";
import { fromQuestionAnswer, toQuestionBody } from "./mapping.ts";

// L2.dialog.spec §3.1, §4.1. 질문은 승인 프로토콜(kind `question`)로 받는다. 대기는 승인 기록(내구)이 갖고
// 이 서비스는 상태를 두지 않는다. 같은 `requestId`로 다시 부르면 기존 요청의 현재 상태를 돌려받는다.

type AskApi = CapabilityApi<typeof DialogAsk>;

const CAPABILITY = DialogAsk.id;

export interface AskService {
  readonly api: AskApi;
  dispose(): void;
}

function requestFailure(error: ApprovalRequestError): DialogFailure {
  switch (error.kind) {
    case "store":
      return new DialogFailure("unavailable", "The approval request could not be stored.", {
        retryable: true,
        detail: { by: "approvals", reason: error.error.kind },
      });
    case "rejected":
      return new DialogFailure("invalid_input", "The approval service rejected the question.", {
        detail: {
          by: "approvals",
          code: error.code,
          ...(error.detail === null ? {} : { message: error.detail }),
        },
      });
    case "key_reused":
      // 같은 requestId로 다른 질문을 보냈다. 호출자의 버그다(spec §5 3번)
      return new DialogFailure(
        "internal",
        "The requestId was already used for a different question.",
        { detail: { by: "approvals", reason: "key_reused" } },
      );
    default:
      return assertNever(error, "ApprovalRequestError");
  }
}

function contextOf(
  context: CallContext | undefined,
): CallContext & { readonly threadId: ThreadId } {
  if (context?.threadId === undefined) {
    throw new DialogFailure(
      "invalid_input",
      "ask needs a thread: the call context has no threadId.",
    );
  }
  return { ...context, threadId: context.threadId };
}

export function createAskService(deps: DialogDeps): AskService {
  const expiry: AskExpiry = createAskExpiry(deps.timers, deps.logger);

  /** 해결·취소된 승인을 `ask` 출력으로 옮긴다(§4.1.1 표) */
  function outcomeOf(snapshot: L2ApprovalSnapshot, questions: readonly AskQuestion[]): AskResult {
    const { approvalId, resolution } = snapshot;
    if (snapshot.state === "cancelled") {
      return {
        status: "cancelled",
        approvalId,
        reason: expiry.wasTimedOut(approvalId) ? "timeout" : "aborted",
      };
    }
    if (resolution === null || resolution.decision !== "answer") {
      // deny는 닫음. allow는 질문에 쓰지 않는 응답이라 닫음으로 본다(§4.1.1)
      return { status: "cancelled", approvalId, reason: "dismissed" };
    }
    const answer = fromQuestionAnswer(resolution.answer, questions);
    const issues = answer === undefined ? undefined : validateAskAnswer(questions, answer);
    if (answer === undefined || issues === undefined || issues.length > 0) {
      // 구버전 클라이언트가 규칙에 안 맞는 답을 남겼다(§4.1.2 5번, §5 2번)
      deps.logger.warn("dialog.ask_answer_invalid", {
        approvalId,
        issues: issues === undefined ? "shape" : issues.map((issue) => issue.code).join(","),
      });
      return { status: "cancelled", approvalId, reason: "dismissed" };
    }
    return {
      status: "answered",
      approvalId,
      answers: answer.answers,
      defaulted: expiry.wasDefaulted(approvalId),
    };
  }

  const api: AskApi = {
    ask: (input, options) =>
      guarded(CAPABILITY, "ask", async () => {
        const context = contextOf(options?.context);
        const requestId = options?.requestId;
        if (requestId === undefined) {
          throw new DialogFailure(
            "invalid_input",
            "ask needs a requestId so that a retry does not ask the question twice.",
          );
        }
        const issues = checkAskQuestions(input.questions);
        if (issues.length > 0) {
          throw new DialogFailure(
            "ask_invalid_questions",
            `The questions are invalid: ${issues.join("; ")}`,
            {
              detail: { issues: [...issues] },
            },
          );
        }
        if (!deps.interactive(context)) {
          throw new DialogFailure(
            "ask_unavailable_headless",
            "No client can answer: this run is not interactive.",
          );
        }
        if (deps.approvals === undefined) {
          throw new DialogFailure("unavailable", "The approval service is not available.", {
            detail: { by: "approvals", reason: "approvals_missing" },
          });
        }
        const approvals = deps.approvals.forCall(context);
        const requestKey = approvalKeyOf(requestId);
        const requested = await approvals.request({
          threadId: context.threadId,
          kind: "question",
          subject: toQuestionBody(input.questions),
          requestId: requestKey,
        });
        if (!requested.ok) throw requestFailure(requested.error);
        let snapshot = requested.value;

        if (snapshot.state === "pending") {
          const timeoutSec = input.timeoutSec ?? deps.settings(context.threadId).ask.timeoutSec;
          expiry.arm({
            approvals,
            threadId: context.threadId,
            approvalId: snapshot.approvalId,
            requestKey,
            afterSec: timeoutSec,
            questions: input.questions,
          });
          if (input.wait !== true) {
            return { status: "input_required", approvalId: snapshot.approvalId };
          }
          // 메모리 대기(§4.1.4): signal이 끊기면 기다림만 그만둔다. 승인 요청은 남는다
          const signal = options?.signal ?? new AbortController().signal;
          const waited = await approvals.wait(context.threadId, snapshot.approvalId, signal);
          if (!waited.ok) {
            throw new DialogFailure("aborted", "The wait for the answer was aborted.");
          }
          snapshot = waited.value;
        }
        expiry.settle(snapshot.approvalId);
        return outcomeOf(snapshot, input.questions);
      }),
  };

  return { api, dispose: () => expiry.dispose() };
}
