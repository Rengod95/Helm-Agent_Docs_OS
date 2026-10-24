import type { CapabilityId, ToolName } from "../capabilities/index.ts";
import type {
  ApprovalId,
  JsonObject,
  JsonValue,
  StepId,
  ThreadId,
  TurnId,
} from "../conversation/index.ts";
import type { Result } from "../base/index.ts";
import type { PortKey } from "../extensions/index.ts";
import type { BlobRef, ReadFailure, StoreError } from "../records/index.ts";
import type { CallerId, PermissionMode, ToolRisk } from "./tools.ts";

// L1.tools.spec §3.6. 구현은 core-tools다. 승인 요청은 내구 이벤트 approval.requested로 나가고
// 응답은 호스트 메서드 approval.respond로 들어온다(review.decisions-2 U-02).

export const ApprovalServiceName = "xeon.approvals" as const;

/** `xeon.approvals` 전체 모양(ApprovalService)의 포트 키. 제공 core-tools */
export const ApprovalServicePortKey: PortKey<ApprovalService> = { name: ApprovalServiceName };

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

/** 요청 이벤트 커밋이 실패한 이유. 저장소 오류, 커밋 거부, 같은 키에 다른 내용(TY-24: 예상 가능한 실패라 값으로 돌려준다) */
export type ApprovalRequestError =
  | { readonly kind: "store"; readonly error: StoreError }
  | { readonly kind: "rejected"; readonly code: string; readonly detail: string | null }
  | { readonly kind: "key_reused"; readonly requestId: string };

export interface ApprovalService {
  /** 요청을 커밋하고 응답이 올 때까지 기다린다. signal이 끊기면 대기만 그만둔다(요청은 남는다). 커밋 실패는 오류 값이다 */
  request(
    input: ApprovalRequestInput,
    signal: AbortSignal,
  ): Promise<Result<ApprovalResolution, ApprovalRequestError>>;
  /** wire approval.respond 처리. 이미 해결된 요청이면 applied: false */
  respond(approvalId: string, response: ApprovalResponse): Promise<{ readonly applied: boolean }>;
  /** 대화의 미해결 요청. 재개와 클라이언트 재접속 때 쓴다 */
  pending(threadId: ThreadId): readonly ApprovalRequest[];
  /** 재개 때 이벤트에서 미해결 요청을 다시 읽어 메모리 대기 목록을 채운다. 읽기 실패는 오류 값이다 */
  restore(threadId: ThreadId): Promise<Result<readonly ApprovalRequest[], ReadFailure>>;
  /** 턴 취소 등으로 요청을 닫는다. resolvedBy "cancelled" */
  cancel(approvalId: string, reason: string): Promise<{ readonly applied: boolean }>;
}

// approval.requested·approval.resolved payload 스키마는 records가 가진다(ApprovalRequestedPayloadSchema, ApprovalResolvedPayloadSchema,
// F.records.spec §3.3.1). ApprovalRequest는 payload에 envelope id(approvalId)를 더한 모양이고,
// ApprovalResolution은 approval.resolved payload와 같다.

// ── L2 공통 승인 포트 (L2.readme §5.7) ────────────────────────────────────────

/** 같은 대화에서 요청을 구분하는 키의 길이 상한. ApprovalRequestInput.requestKey와 같다(1~48자) */
export const L2_APPROVAL_REQUEST_ID_MAX: number = 48;

/**
 * L2 능력이 승인 프로토콜을 쓰는 공통 포트 모양. cap-*가 `xeon.approvals`(ApprovalService)를 이 모양으로 감싸 쓴다.
 * L2 패키지끼리 import하지 않으므로 F가 이 모양을 한 번만 정의한다. 구현(어댑터)은 각 cap-*의 `src/ports/approvals.ts`가 맡고,
 * 도메인 대상(subject)을 ApprovalBody로, 응답(answer)을 도메인 답으로 바꾸는 규칙은 그 어댑터가 가진다.
 *
 * - kind는 ApprovalKind와 같다. `review`(artifacts.reviews)는 L1.tools.spec이 받아들이면 더한다(L2.readme §10 미결 14).
 * - 실패는 throw하지 않고 Result 오류 값으로 돌려준다(TY-11). 호출자는 값을 보고 CapabilityError로 바꾼다.
 */
export type L2ApprovalKind = ApprovalKind;

export interface L2ApprovalSnapshot {
  readonly approvalId: ApprovalId;
  readonly state: "pending" | "resolved" | "cancelled";
  /** wire approval.respond의 decision·answer와 같은 값(F.wire-settings.spec §3.3.1). pending이면 null */
  readonly resolution: {
    readonly decision: ApprovalDecision;
    readonly answer: JsonValue | null;
  } | null;
}

export interface L2ApprovalRequest {
  readonly threadId: ThreadId;
  readonly kind: L2ApprovalKind;
  /** 도메인 대상. question은 AskApprovalSubject, plan은 PlanApprovalSubject 등 */
  readonly subject: JsonValue;
  /** decision "answer"일 때 answer를 검사할 JSON Schema. question·plan이 쓴다 */
  readonly answerSchema?: JsonObject;
  /** false면 턴을 멈추지 않는 비차단 요청. 생략하면 true. M2에는 비차단 kind가 없다 */
  readonly blocking?: boolean;
  /** 멱등 키(1~L2_APPROVAL_REQUEST_ID_MAX자). 같은 키로 다시 부르면 새 요청을 만들지 않고 기존 요청의 현재 상태를 돌려준다 */
  readonly requestId: string;
}

export interface L2ApprovalRespondInput {
  readonly threadId: ThreadId;
  readonly approvalId: ApprovalId;
  readonly decision: ApprovalDecision;
  readonly answer?: JsonValue;
  readonly requestId: string;
}

export interface L2ApprovalsPort {
  request(input: L2ApprovalRequest): Promise<Result<L2ApprovalSnapshot, ApprovalRequestError>>;
  /** 요청의 현재 상태. 없으면 null */
  get(
    threadId: ThreadId,
    approvalId: ApprovalId,
  ): Promise<Result<L2ApprovalSnapshot | null, ReadFailure>>;
  /** 이미 해결된 요청이면 applied: false */
  respond(input: L2ApprovalRespondInput): Promise<{ readonly applied: boolean }>;
  cancel(
    threadId: ThreadId,
    approvalId: ApprovalId,
    reason: string,
  ): Promise<{ readonly applied: boolean }>;
  /**
   * 응답이 기록되면 이행되는 메모리 대기. 프로세스가 끝나면 사라지고, 재개 뒤 같은 requestId로 request를 다시 부른다.
   * signal이 끊기면 기다림만 그만두고 요청은 남는다
   */
  wait(
    threadId: ThreadId,
    approvalId: ApprovalId,
    signal: AbortSignal,
  ): Promise<Result<L2ApprovalSnapshot, { readonly kind: "cancelled" }>>;
}
