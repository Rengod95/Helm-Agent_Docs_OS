import type { CapabilityId, CallerInfo, ToolName } from "../capabilities/index.ts";
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

/**
 * 승인 요청을 일으킨 호출자. 정책 판정에 쓰는 `CallerId`(main, subagent:<이름>)에 승인 화면만 구분하는 셋을 더했다:
 * `ext:<확장 이름>`(확장·그룹 코드), `background`(백그라운드 포크), `host`(호스트가 직접 낸 호출). 값은 `approvalCallerOf`가 만든다.
 */
export type ApprovalCaller = CallerId | "background" | "host" | `ext:${string}`;

/**
 * 호출 문맥의 호출자(`CallContext.caller`)를 승인 origin의 `caller` 값으로 바꾸는 유일한 함수다 [결정: m2c G1-09].
 * L1.tools와 L2 어댑터(cap-dialog, cap-work, cap-knowledge)가 자기 복제를 두지 않고 이 함수를 쓴다. 순수.
 *
 * - `host` → `host`
 * - `extension` → `ext:<extension>`. 이름이 없으면 `ext:unknown`
 * - `model` + 주 대화(또는 `agent` 생략) → `main`
 * - `model` + `subagent` → `subagent:<agentName>`. 이름이 없으면 `subagent:unknown`
 * - `model` + `background` → `background`
 */
export function approvalCallerOf(caller: CallerInfo): ApprovalCaller {
  if (caller.kind === "host") return "host";
  if (caller.kind === "extension") return `ext:${caller.extension ?? "unknown"}`;
  // 남은 종류는 model뿐이다
  if (caller.agent === "subagent") return `subagent:${caller.agentName ?? "unknown"}`;
  return caller.agent === "background" ? "background" : "main";
}

export interface ApprovalOrigin {
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly stepId: StepId | null;
  /** 이 요청을 일으킨 도구 호출. 질문·계획 도구도 도구 호출이므로 보통 채워진다 */
  readonly toolCallId: string | null;
  readonly caller: ApprovalCaller;
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
  /** 추천 선택지 표시(L2.dialog `AskOption.recommended`). 화면이 강조만 하고 응답 검사에는 쓰지 않는다 */
  readonly recommended?: boolean;
}

export interface QuestionItem {
  readonly id: string;
  /** 질문 위에 얹는 짧은 머리글(L2.dialog `AskQuestion.header`). 1~64자 */
  readonly header?: string;
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

/**
 * 만료했을 때 요청이 어떻게 해결되는가 [결정: m2c G1-11]. `deny`는 거부(기본), `answer`는 정한 답으로 응답한 것으로 본다
 * (질문의 추천 답처럼 `answer`가 있을 때만 쓴다). 해결에는 `resolvedBy: "expired"`가 붙는다
 */
export type ApprovalOnExpire =
  | { readonly decision: "deny" }
  | { readonly decision: "answer"; readonly answer: JsonValue };

export interface ApprovalRequestInput {
  readonly origin: ApprovalOrigin;
  /** 요청 멱등 키(1~48자). 같은 대화에서 같은 키의 두 번째 요청은 처음 요청을 돌려준다. 도구 승인은 toolCallId */
  readonly requestKey: string;
  /** 화면 제목. 1~120자 */
  readonly title: string;
  readonly body: ApprovalBody;
  /** 이 요청에서 고를 수 있는 기억 범위. 질문은 ["once"]만 */
  readonly remember: readonly ApprovalRemember[];
  /**
   * 만료 시각(epoch ms, 요청 커밋 시각 + 제한). 없으면 만료가 없다. 내구 필드라 프로세스를 다시 시작해도 제한 시간을 처음부터 다시 재지 않는다.
   * 이 필드는 M2에서 기록만 하고 만료 해결은 M3 구현이다(L1.tools가 시작 때와 타이머로 만료분을 해결한다)
   */
  readonly expiresAt?: number;
  /** 만료 때의 해결. `expiresAt`이 있을 때만 뜻이 있다. 생략하면 `{ decision: "deny" }` */
  readonly onExpire?: ApprovalOnExpire;
}

/** 단일 대기 형식. approval.requested payload와 같다 */
export interface ApprovalRequest extends ApprovalRequestInput {
  /** approval.requested 이벤트의 EventId(evt_ 접두) */
  readonly approvalId: string;
  readonly surfaceThreadId: ThreadId;
  readonly requestedAt: number;
}

/**
 * wire `approval.respond`의 정본 질문 응답 모양(kind `question`, decision `answer`). 질문 id → `{ selected, text? }`.
 * 스키마는 records의 `QuestionAnswerSchema`다. L2.dialog의 `AskAnswer`는 cap-dialog 어댑터가 이 모양과 서로 옮긴다
 * (`fromQuestionAnswer`·`toQuestionAnswer`). 클라이언트는 `QuestionBody`를 그리므로 이 모양으로 답한다.
 */
export type QuestionAnswer = Readonly<
  Record<string, { readonly selected: readonly string[]; readonly text?: string }>
>;

/** 계획 승인(kind `plan`) decision `allow`의 answer. 다음 권한 모드(요청의 `nextModes` 안)와 메모. 둘 다 선택이다 */
export interface PlanAnswer {
  readonly mode?: PermissionMode;
  readonly note?: string;
}

/** decision `deny`의 answer. 거부 이유를 모델에 돌려줄 때 쓴다 */
export interface DenyAnswer {
  readonly feedback: string;
}

/**
 * `respond`가 응답을 적용하지 못한 이유. 클라이언트는 이 값으로 "응답을 고쳐 다시 보낸다"와 "더 할 일이 없다"를 구분한다.
 * - `answer_invalid`: decision이 요청 kind에 맞지 않거나, answer가 질문·계획 모양에 맞지 않거나, 요청이 제시하지 않은 기억 범위다. 요청은 대기 그대로다.
 * - `already_resolved`: 이미 해결됐거나 다른 응답이 해결을 커밋하는 중이다.
 * - `unknown_approval`: 이 런타임의 대기 목록에 없는 approvalId다.
 * - `commit_failed`: 응답은 맞았으나 `approval.resolved` 커밋이 실패했다. 요청은 대기 그대로라 다시 보낼 수 있다.
 */
export const APPROVAL_NOT_APPLIED_REASONS: readonly [
  "answer_invalid",
  "already_resolved",
  "unknown_approval",
  "commit_failed",
] = ["answer_invalid", "already_resolved", "unknown_approval", "commit_failed"];
export type ApprovalNotAppliedReason = (typeof APPROVAL_NOT_APPLIED_REASONS)[number];

/** `respond`의 결과. `applied: false`면 `reason`이 있다. 이유를 알리지 않는 구현(시험용 가짜)은 생략할 수 있다 */
export interface ApprovalApplyOutcome {
  readonly applied: boolean;
  readonly reason?: ApprovalNotAppliedReason;
  /** `answer_invalid`일 때 어디가 맞지 않는지 한 줄 */
  readonly detail?: string;
}

export interface ApprovalResponse {
  readonly decision: ApprovalDecision;
  /**
   * kind별 정본 모양(records `ApprovalAnswerSchema`): decision "answer"면 QuestionAnswer(question), decision "allow"면 PlanAnswer(plan, 선택),
   * decision "deny"면 DenyAnswer(선택). 그 밖의 조합은 `applied: false`다
   */
  readonly answer?: JsonValue;
  readonly remember?: ApprovalRemember;
}

export type ApprovalResolvedBy =
  | "user"
  | "noninteractive"
  | "cancelled"
  | "superseded"
  /** `expiresAt`이 지나 `onExpire`대로 해결했다 [결정: m2c G1-11] */
  | "expired";

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

/** 요청과 현재 해결 상태 */
export interface OpenedApproval {
  readonly request: ApprovalRequest;
  /** 해결되었으면 기록된 해결, 아니면 null */
  readonly resolution: ApprovalResolution | null;
}

/** `wait`가 해결을 받지 못한 이유 */
export type ApprovalWaitFailure =
  /** signal이 끊겨 기다림만 그만뒀다. 요청은 남는다 */
  | { readonly kind: "aborted" }
  /** 이 런타임의 대기 목록에 없는 approvalId */
  | { readonly kind: "unknown" };

export interface ApprovalService {
  /** 요청을 커밋하고 응답이 올 때까지 기다린다. signal이 끊기면 대기만 그만둔다(요청은 남는다). 커밋 실패는 오류 값이다 */
  request(
    input: ApprovalRequestInput,
    signal: AbortSignal,
  ): Promise<Result<ApprovalResolution, ApprovalRequestError>>;
  /** wire approval.respond 처리. 적용하지 못하면 applied: false와 이유(`ApprovalNotAppliedReason`: 응답이 맞지 않음, 이미 해결됨, 모르는 id, 커밋 실패) */
  respond(approvalId: string, response: ApprovalResponse): Promise<ApprovalApplyOutcome>;
  /** 대화의 미해결 요청. 재개와 클라이언트 재접속 때 쓴다 */
  pending(threadId: ThreadId): readonly ApprovalRequest[];
  /** 재개 때 이벤트에서 미해결 요청을 다시 읽어 메모리 대기 목록을 채운다. 읽기 실패는 오류 값이다 */
  restore(threadId: ThreadId): Promise<Result<readonly ApprovalRequest[], ReadFailure>>;
  /** 턴 취소 등으로 요청을 닫는다. resolvedBy "cancelled" */
  cancel(approvalId: string, reason: string): Promise<{ readonly applied: boolean }>;
  /**
   * 비차단 요청(L1.tools.spec §3.6, §8.3 F 요청 11): 요청을 커밋만 하고 기다리지 않는다. `request`는 `open` + `wait`와 같다.
   * 같은 대화에서 같은 `requestKey`의 요청이 있으면 새 이벤트 없이 그 요청과 현재 해결 상태를 돌려준다(재시작 뒤에도 같다).
   */
  open(input: ApprovalRequestInput): Promise<Result<OpenedApproval, ApprovalRequestError>>;
  /** 응답이 기록되면 이행된다. 이미 해결된 요청이면 바로 이행한다. signal이 끊기면 기다림만 그만둔다(요청은 남는다) */
  wait(
    approvalId: string,
    signal: AbortSignal,
  ): Promise<Result<ApprovalResolution, ApprovalWaitFailure>>;
  /** 메모리 대기 목록의 요청과 해결 상태. 동기 조회. 모르는 approvalId면 undefined(`restore` 전의 재시작 직후 포함) */
  get(approvalId: string): OpenedApproval | undefined;
}

// approval.requested·approval.resolved payload 스키마는 records가 가진다(ApprovalRequestedPayloadSchema, ApprovalResolvedPayloadSchema,
// F.records.spec §3.3.1). ApprovalRequest는 payload에 envelope id(approvalId)를 더한 모양이고,
// ApprovalResolution은 approval.resolved payload와 같다.

// ── L2 공통 승인 포트 (L2.readme §5.7) ────────────────────────────────────────

/**
 * 같은 대화에서 요청을 구분하는 키의 길이 상한. ApprovalRequestInput.requestKey와 같다(1~48자).
 * services는 다른 F 디렉터리를 값으로 import하지 않아(test/services/imports.test.ts) 값의 정의는 records의 `APPROVAL_REQUEST_KEY_MAX`가 맡고,
 * 이 상수는 같은 값을 거울로 둔다. 같은 값인지는 test/records/ports.test.ts가 지킨다. 키 변환은 `requestKeyFor`(records) 하나다
 */
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
    /** 누가 해결했는가. `expired`면 만료로 해결됐다. 이유를 알리지 않는 구현(시험용 가짜)은 생략할 수 있다 [결정: m2c G1-11] */
    readonly resolvedBy?: ApprovalResolvedBy;
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
  /** 만료 시각(epoch ms)과 만료 때의 해결. `ApprovalRequestInput`의 같은 이름 필드로 옮긴다 [결정: m2c G1-11] */
  readonly expiresAt?: number;
  readonly onExpire?: ApprovalOnExpire;
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
  /** 적용하지 못하면 applied: false와 이유(`ApprovalNotAppliedReason`) */
  respond(input: L2ApprovalRespondInput): Promise<ApprovalApplyOutcome>;
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
