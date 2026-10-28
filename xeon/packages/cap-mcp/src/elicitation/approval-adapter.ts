import { err, parse, type Result } from "@xeon/contracts";
import {
  decodeMcpAnswer,
  planMcpQuestionBody,
  uniformMcpAnswer,
  type McpDecodeError,
  type McpPlanError,
  type McpQuestion,
  type PlannedMcpQuestions,
} from "@xeon/contracts/capabilities";
import type { JsonObject, ThreadId } from "@xeon/contracts/conversation";
import type {
  ApprovalRequestError,
  L2ApprovalSnapshot,
  L2ApprovalsPort,
} from "@xeon/contracts/services";
import { Type } from "typebox";

// MCP.4(D5): 서버 주도 요청을 승인 프로토콜의 kind `question` 요청으로 옮기는 규칙. 규칙 본체(`McpQuestion` ↔ `QuestionBody`)는
// F `@xeon/contracts/capabilities`의 `mcp-questions.ts`에 있다(L1.tools.spec §8.3 F 요청 12): L1.tools가 `input_required`(approvalId 없음)를
// 질문 승인으로 올릴 때 같은 규칙을 쓴다. 이 파일은 cap-mcp 안의 기존 이름과, 그룹 코드가 `callTool`의 `input_required` 변형을
// `L2ApprovalsPort`로 직접 처리하는 `askWithApprovals`(L2.mcp.spec §4.6 9번)를 가진다.

export {
  decodeMcpAnswer as decodeAnswer,
  planMcpQuestionBody as planQuestionBody,
  uniformMcpAnswer as uniformAnswer,
  type PlannedMcpQuestions as PlannedQuestions,
} from "@xeon/contracts/capabilities";

export type AskError =
  | McpPlanError
  | McpDecodeError
  | { readonly kind: "request_failed"; readonly error: ApprovalRequestError }
  | { readonly kind: "wait_cancelled" }
  | { readonly kind: "bad_answer" };

export interface AskInput {
  readonly threadId: ThreadId;
  readonly questions: readonly McpQuestion[];
  /** 승인 요청 멱등 키(1~48자). 같은 호출의 같은 라운드는 같은 키를 쓴다 */
  readonly requestId: string;
  readonly signal: AbortSignal;
}

const QuestionAnswerValueSchema = Type.Record(
  Type.String(),
  Type.Object({ selected: Type.Array(Type.String()), text: Type.Optional(Type.String()) }),
);

function snapshotToResponses(
  planned: PlannedMcpQuestions,
  snapshot: L2ApprovalSnapshot,
): Result<JsonObject, AskError> {
  if (snapshot.state === "cancelled" || snapshot.resolution === null) {
    return uniformMcpAnswer(planned.questions, "cancel");
  }
  if (snapshot.resolution.decision === "deny")
    return uniformMcpAnswer(planned.questions, "decline");
  const answer = parse(QuestionAnswerValueSchema, snapshot.resolution.answer);
  if (!answer.ok) return err({ kind: "bad_answer" });
  return decodeMcpAnswer(planned, answer.value);
}

/**
 * 질문을 `L2ApprovalsPort`(kind `question`)로 올리고 응답이 올 때까지 기다려 `inputResponses`를 돌려준다.
 * 프로세스가 끝나면 메모리 대기는 사라지므로, 재개 뒤에는 같은 `requestId`로 다시 부르면 저장된 해결을 읽는다
 * (L2ApprovalsPort.request의 멱등 규칙).
 */
export async function askWithApprovals(
  approvals: L2ApprovalsPort,
  input: AskInput,
): Promise<Result<JsonObject, AskError>> {
  const planned = planMcpQuestionBody(input.questions);
  if (!planned.ok) return planned;
  const requested = await approvals.request({
    threadId: input.threadId,
    kind: "question",
    subject: planned.value.subject,
    requestId: input.requestId,
  });
  if (!requested.ok) return err({ kind: "request_failed", error: requested.error });
  let snapshot = requested.value;
  if (snapshot.state === "pending") {
    const waited = await approvals.wait(input.threadId, snapshot.approvalId, input.signal);
    if (!waited.ok) return err({ kind: "wait_cancelled" });
    snapshot = waited.value;
  }
  return snapshotToResponses(planned.value, snapshot);
}
