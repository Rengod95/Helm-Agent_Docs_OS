import type { Static, TSchema } from "typebox";
import type { JsonObject, ReplayPolicy, ThreadId, TurnId } from "../conversation/index.ts";
import type { SecretApprovalEvidence } from "./secrets.ts";

/** 메서드 고유 오류 선언. 공통 오류 코드(errors.ts)는 선언하지 않아도 된다 */
export interface ErrorDecl {
  readonly description: string;
  readonly retryable: boolean;
  /** CapabilityErrorData.detail의 스키마 */
  readonly detail?: TSchema;
}

export interface MethodDef<I extends TSchema = TSchema, O extends TSchema = TSchema> {
  readonly description: string;
  /** 입력. 루트는 Type.Object여야 한다 */
  readonly input: I;
  readonly output: O;
  /** 메서드 고유 오류 코드 → 선언. 키 형식 ^[a-z][a-z0-9_]{0,47}$ */
  readonly errors?: Readonly<Record<string, ErrorDecl>>;
  /** 서비스 호출 자체의 재생 정책. 생략하면 "unsafe" */
  readonly replay?: ReplayPolicy;
  /**
   * 같은 대화에서 같은 `requestId`로 다시 불러도 추가 효과가 없고 처음 결과를 돌려준다(ADR-0015 §3.3 1).
   * 선언하면 `replay: "safe"`여야 하고 `readOnly`와 함께 쓸 수 없다. 호출은 `requestId`를 반드시 넘긴다
   */
  readonly idempotent?: true;
  /**
   * 대화 상태, 세션 DB, 작업 공간, 외부 시스템 어디에도 효과를 남기지 않는다(ADR-0015 §3.3 2). 선언하면 `replay: "safe"`여야 한다.
   * 이름은 `ToolHints.readOnly`와 같다 [제안: M3-REQ-01]
   */
  readonly readOnly?: true;
}

export type MethodMap = Readonly<Record<string, MethodDef>>;

export interface ServiceDef<Ms extends MethodMap = MethodMap> {
  readonly methods: Ms;
}

/** 호출 주체. 값은 L1.tools(도구 경로)와 X(그룹·확장 경로)가 채운다 */
export interface CallerInfo {
  readonly kind: "model" | "extension" | "host";
  /** model일 때: 주 대화, 서브에이전트, 백그라운드 포크 */
  readonly agent?: "main" | "subagent" | "background";
  /** extension일 때 확장 이름(그룹이면 그룹 이름). 다른 종류의 호출자에는 채우지 않는다 */
  readonly extension?: string;
  /** model이고 agent가 "subagent"일 때 서브에이전트 정의 이름(L1.agents `AgentDefinition.name`). `extension`과 뜻이 다르다 [결정: m2c G1-09] */
  readonly agentName?: string;
  /** 이번 turn에서 untrusted 도구 결과를 이미 읽었는지. L1.tools가 계산한다 */
  readonly afterUntrusted?: boolean;
}

/** 호출 문맥. consumer가 직접 채우지 않는다 */
export interface CallContext {
  /** 호출이 일어난 세션 */
  readonly threadId?: ThreadId;
  readonly turnId?: TurnId;
  /** 도구 경로면 있다 */
  readonly toolCallId?: string;
  readonly caller: CallerInfo;
  /**
   * 사람이 있는 실행인가(L2.dialog `ask_unavailable_headless`, L1.tools.spec §4.7). L1.tools가 `ToolRunContext.interactive`로 채운다.
   * 생략하면 대화형으로 본다(그룹·확장 경로, 서비스 모드의 호스트 호출)
   */
  readonly interactive?: boolean;
  /**
   * 이 호출이 쓰는 비밀(`secretEnv`)을 사람이 승인한 증거(L1.tools.spec §4.12, U-19). L1.tools가 채운다.
   * 비밀을 쓰지 않거나 증거를 얻지 못한 호출은 없다. 도구 구현은 `SecretEnvRequest.ctx.approval`에 그대로 옮긴다
   */
  readonly approval?: SecretApprovalEvidence;
}

/**
 * 같은 호출을 이어서 다시 부를 때 싣는 연속 정보(MRTR, L1.tools.spec §4.3, 결정 D5 (a)). 첫 호출에는 두지 않는다.
 * 도구 호출이 `status: "input_required"`로 돌아오고 승인 `approvalId`가 없으면(MCP `McpInputRequired`), L1.tools가 `questions`를
 * 질문 승인(kind `question`)으로 올리고 답을 `inputResponses`로 옮긴 뒤 같은 `requestId`로 이 필드를 붙여 다시 부른다.
 * 능력은 `input.continuation`이 아니라 이 필드를 먼저 읽는다(둘 다 있으면 이 필드가 이긴다).
 */
export interface CallContinuation {
  /** 이번에 보낼 라운드 번호(2부터) */
  readonly round: number;
  /** 입력 요청 키 → 응답. 값 모양은 능력이 정한다(MCP는 사양을 따른다) */
  readonly inputResponses: JsonObject;
  /** 직전 라운드의 requestState. 바이트 그대로 돌려보낸다 */
  readonly requestState: string | null;
}

/** 서비스 호출 옵션. consumer가 넘긴다 */
export interface CallOptions {
  readonly signal?: AbortSignal;
  /** 같은 대화에서 같은 효과를 한 번만 내기 위한 키(1~64자). 도구 어댑터는 toolCallId에서 만든다 */
  readonly requestId?: string;
  /** L1.tools 어댑터(도구 경로)와 X의 capability 래퍼(그룹·확장 경로)가 덮어써서 채운다 */
  readonly context?: CallContext;
  /** `input_required` 뒤의 재호출(2라운드부터). L1.tools 어댑터가 채운다. `CallContinuation` 참고 */
  readonly continuation?: CallContinuation;
}

/** `idempotent` 메서드를 부를 때의 옵션. `requestId`가 필수다(ADR-0015 §3.3 5) */
export type IdempotentCallOptions = CallOptions & { readonly requestId: string };

/** 메서드의 호출 옵션 매개변수. `idempotent: true` 메서드는 `requestId`가 있는 옵션을 필수로 받는다 */
export type MethodOptionsParam<Md extends MethodDef> = Md extends { readonly idempotent: true }
  ? [options: IdempotentCallOptions]
  : [options?: CallOptions];

/** 메서드 하나의 서비스 함수 타입 */
export type MethodFn<Md extends MethodDef> = (
  input: Static<Md["input"]>,
  ...options: MethodOptionsParam<Md>
) => Promise<Static<Md["output"]>>;
