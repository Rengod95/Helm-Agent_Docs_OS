import {
  DialogAsk,
  DialogAskKey,
  type AskAnswerItem,
  type AskInputValue,
  type AskQuestion,
  type AskResult,
  type CallOptions,
} from "@xeon/contracts/capabilities";
import { ApprovalIdSchema, type JsonObject } from "@xeon/contracts/conversation";
import { Bug, parse } from "@xeon/contracts";
import type { ApprovalOrigin } from "@xeon/contracts/services";
import { isJsonObject } from "../../src/util.ts";
import type { ToolRuntime } from "../../src/runtime.ts";
import { l2ApprovalsPort } from "../../src/testing/index.ts";
import type { Harness } from "./harness.ts";

// cap-dialog의 `ask`를 흉내 낸 시험용 서비스: L2 승인 포트(기준 어댑터) 위에서 질문을 올리고 `input_required`로 돌아온다(L2.dialog.spec §4.1.2).
// 이 서비스가 cap-dialog가 아니라는 점에 주의한다. L1.tools 어댑터의 `input_required` 재호출을 확인하는 데만 쓴다.

export interface FakeDialog {
  /** ask 메서드 호출 기록 */
  readonly calls: {
    readonly requestId: string | undefined;
    readonly wait: boolean | undefined;
    /** `CallContext.interactive` */
    readonly interactive: boolean | undefined;
  }[];
}

/** 질문 묶음을 승인 요청의 대상(subject) JSON으로 옮긴다 */
function subjectOf(questions: readonly AskQuestion[]): JsonObject {
  return {
    questions: questions.map((question): JsonObject => ({
      id: question.id,
      text: question.question,
      options: (question.options ?? []).map((option): JsonObject => ({
        id: option.id,
        label: option.label,
      })),
      multiSelect: question.multiSelect ?? false,
      allowFreeText: question.allowFreeText ?? true,
    })),
  };
}

function answerItems(answer: unknown, questions: readonly AskQuestion[]): AskAnswerItem[] {
  if (!isJsonObject(answer)) return [];
  return questions.map((question) => {
    const entry = answer[question.id];
    const selected =
      isJsonObject(entry) && Array.isArray(entry["selected"]) ? entry["selected"] : [];
    const text = isJsonObject(entry) && typeof entry["text"] === "string" ? entry["text"] : null;
    return {
      questionId: question.id,
      selected: selected.filter((id): id is string => typeof id === "string"),
      text,
    };
  });
}

export function installDialog(h: Harness, runtime: ToolRuntime = h.runtime): FakeDialog {
  const calls: FakeDialog["calls"][number][] = [];
  const api = {
    ask: async (input: AskInputValue, options?: CallOptions): Promise<AskResult> => {
      calls.push({
        requestId: options?.requestId,
        wait: input.wait,
        interactive: options?.context?.interactive,
      });
      const context = options?.context;
      const requestId = options?.requestId;
      if (context?.threadId === undefined || requestId === undefined) {
        throw new Bug("fake-dialog: the call context is missing");
      }
      const origin: ApprovalOrigin = {
        threadId: context.threadId,
        turnId: context.turnId ?? null,
        stepId: null,
        toolCallId: context.toolCallId ?? null,
        caller: "main",
      };
      const port = l2ApprovalsPort(runtime.approvals, { origin });
      const requested = await port.request({
        threadId: context.threadId,
        kind: "question",
        subject: subjectOf(input.questions),
        requestId: requestId.slice(0, 48),
      });
      if (!requested.ok) throw new Bug(`fake-dialog: request failed: ${requested.error.kind}`);
      const snapshot = requested.value;
      const approvalId = parse(ApprovalIdSchema, snapshot.approvalId);
      if (!approvalId.ok) throw new Bug("fake-dialog: bad approval id");
      if (snapshot.state === "pending")
        return { status: "input_required", approvalId: approvalId.value };
      if (snapshot.state === "cancelled") {
        return { status: "cancelled", approvalId: approvalId.value, reason: "aborted" };
      }
      if (snapshot.resolution?.decision === "answer") {
        return {
          status: "answered",
          approvalId: approvalId.value,
          answers: answerItems(snapshot.resolution.answer, input.questions),
          defaulted: false,
        };
      }
      return { status: "cancelled", approvalId: approvalId.value, reason: "dismissed" };
    },
  };
  h.apis.set(DialogAsk.id, api);
  runtime.tools.register({ kind: "capability", def: DialogAsk, key: DialogAskKey });
  return { calls };
}
