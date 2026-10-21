import type { CapabilityId, ToolName } from "../capabilities/index.ts";
import type { JsonValue, StepId, ThreadId, TurnId } from "../conversation/index.ts";
import type { BlobRef } from "../records/index.ts";
import type { CallerId, PermissionMode, ToolRisk } from "./tools.ts";

// L1.tools.spec §3.6. 구현은 core-tools다. 승인 요청은 내구 이벤트 approval.requested로 나가고
// 응답은 호스트 메서드 approval.respond로 들어온다(review.decisions-2 U-02).

export const ApprovalServiceName = "xeon.approvals" as const;

export type ApprovalKind = "tool" | "plan" | "question";
export type ApprovalDecision = "allow" | "deny" | "answer";
export type ApprovalRemember = "once" | "thread" | "always";

export interface ApprovalOrigin {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly stepId: StepId | null;
  /** 이 요청을 일으킨 도구 호출. 질문·계획 도구도 도구 호출이므로 보통 채워진다 */
  readonly toolCallId: string | null;
  readonly caller: CallerId;
}

export interface ToolApprovalBody {
  readonly toolName: ToolName;
  readonly capability?: { readonly id: CapabilityId; readonly method: string };
  readonly risk: ToolRisk;
  /** 실행될 인자. 큰 값은 BlobRef */
  readonly args: Readonly<Record<string, JsonValue>> | BlobRef;
  readonly argsHash: string;
  /** ask를 낸 규칙. 모드가 낸 ask면 null */
  readonly ruleId: string | null;
}

export interface PlanApprovalBody {
  /** 계획 본문(마크다운). 큰 값은 BlobRef */
  readonly plan: string | BlobRef;
  /** L2.work의 계획 레코드 참조. 형식은 L2.work.spec */
  readonly planRef: string | null;
  /** 승인 때 고를 수 있는 다음 권한 모드 */
  readonly nextModes: readonly PermissionMode[];
}

export interface QuestionOption {
  /** 1~32자 */
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export interface QuestionItem {
  readonly id: string;
  readonly text: string;
  /** 빈 배열이면 자유 답 */
  readonly options: readonly QuestionOption[];
  readonly multiSelect: boolean;
  readonly allowFreeText: boolean;
}

export interface QuestionBody {
  /** 1~4개 */
  readonly questions: readonly QuestionItem[];
}

export type ApprovalBody =
  | { readonly kind: "tool"; readonly tool: ToolApprovalBody }
  | { readonly kind: "plan"; readonly plan: PlanApprovalBody }
  | { readonly kind: "question"; readonly question: QuestionBody };

export interface ApprovalRequestInput {
  readonly origin: ApprovalOrigin;
  /** 요청 멱등 키(1~48자). 같은 대화에서 같은 키의 두 번째 요청은 처음 요청을 돌려준다. 도구 승인은 toolCallId */
  readonly requestKey: string;
  /** 화면 제목. 1~120자 */
  readonly title: string;
  readonly body: ApprovalBody;
  /** 이 요청에서 고를 수 있는 기억 범위. 질문은 ["once"]만 */
  readonly remember: readonly ApprovalRemember[];
}

/** 단일 대기 형식. approval.requested payload와 같다 */
export interface ApprovalRequest extends ApprovalRequestInput {
  /** approval.requested 이벤트의 EventId(evt_ 접두) */
  readonly approvalId: string;
  readonly surfaceThreadId: ThreadId;
  readonly requestedAt: number;
}

export type QuestionAnswer = Readonly<
  Record<string, { readonly selected: readonly string[]; readonly text?: string }>
>;

export interface ApprovalResponse {
  readonly decision: ApprovalDecision;
  /** decision "answer"면 QuestionAnswer(question) 또는 { mode }(plan). decision "deny"면 { feedback } 허용 */
  readonly answer?: JsonValue;
  readonly remember?: ApprovalRemember;
}

export type ApprovalResolvedBy = "user" | "noninteractive" | "cancelled" | "superseded";

export interface ApprovalResolution {
  readonly approvalId: string;
  readonly decision: ApprovalDecision;
  readonly answer: JsonValue | null;
  /** 실제 적용한 기억 범위. 2차 전에는 "always"를 "thread"로 낮춰 적용한다 */
  readonly remember: ApprovalRemember;
  readonly requestedRemember: ApprovalRemember | null;
  readonly resolvedBy: ApprovalResolvedBy;
}

export interface ApprovalService {
  /** 요청을 커밋하고 응답이 올 때까지 기다린다. signal이 끊기면 대기만 그만둔다(요청은 남는다) */
  request(input: ApprovalRequestInput, signal: AbortSignal): Promise<ApprovalResolution>;
  /** wire approval.respond 처리. 이미 해결된 요청이면 applied: false */
  respond(approvalId: string, response: ApprovalResponse): Promise<{ readonly applied: boolean }>;
  /** 대화의 미해결 요청. 재개와 클라이언트 재접속 때 쓴다 */
  pending(threadId: ThreadId): readonly ApprovalRequest[];
  /** 재개 때 이벤트에서 미해결 요청을 다시 읽어 메모리 대기 목록을 채운다 */
  restore(threadId: ThreadId): Promise<readonly ApprovalRequest[]>;
  /** 턴 취소 등으로 요청을 닫는다. resolvedBy "cancelled" */
  cancel(approvalId: string, reason: string): Promise<{ readonly applied: boolean }>;
}

// approval.requested·approval.resolved payload 스키마는 records가 가진다(ApprovalRequestedPayloadSchema, ApprovalResolvedPayloadSchema,
// F.records.spec §3.3.1). ApprovalRequest는 payload에 envelope id(approvalId)를 더한 모양이고,
// ApprovalResolution은 approval.resolved payload와 같다.
