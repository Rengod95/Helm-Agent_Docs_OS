import type { EventId, ItemId, ThreadId } from "@xeon/contracts/conversation";
import { RECORD_KIND_PATTERN, type GroupId, type RecordKind } from "@xeon/contracts/extensions";
import type {
  ChildStatus,
  DelegateRequest,
  DelegateResult as AgentsDelegateResult,
} from "@xeon/contracts/services";

export interface DelegateReport {
  /** 완료 보고를 부모 대화에 넣을 때 쓰는 customType. 자기 grp.<이름>. 접두여야 한다 */
  readonly customType: RecordKind;
  readonly display: boolean;
  readonly when: "followUp" | "next";
}

/** L1.agents.spec §3.2 ChildToolPolicy와 같은 필드. 허용과 차단을 함께 쓴다 */
export interface DelegateToolPolicy {
  /** 실행을 허용하는 도구 이름(glob). 서브에이전트 정의 tools와 교집합을 낸다. 넓히지 못한다 */
  readonly allow?: readonly string[];
  /** 자식에서 막을 도구 이름(glob). allow보다 먼저 적용한다 */
  readonly deny?: readonly string[];
  /** 참이면 광고 도구 배열은 부모와 같게 두고 실행 시점에만 거른다(캐시 접두 공유) */
  readonly keepParentList?: boolean;
  /** 허용 밖 호출의 거부 문장에 붙일 안내 */
  readonly denyHint?: string;
}

/** L1.agents.spec §3.2 ChildLimits와 같은 필드 */
export interface DelegateLimits {
  readonly maxSteps?: number;
  readonly maxInputTokens?: number;
}

/** 부모 이력의 어디까지를 자식에 복제할지. 생략하면 빈 대화에서 시작 */
export type DelegateFork =
  | { readonly at: "event"; readonly eventId: EventId }
  | { readonly at: "item"; readonly itemId: ItemId };

export interface DelegateSpec {
  /** 서브에이전트 정의 이름(L1.agents.spec §4.9) */
  readonly agent: string;
  readonly task: string;
  /** 필수. 대화 범위 멱등 키, 1~48자. group-kit이 ":report"를 붙여 보고 post의 키로 쓴다(64자 한도) */
  readonly requestId: string;
  /**
   * 완료 보고 post의 모양. 선택 필드다 [결정: review.m3-design-inputs D-M3-03].
   * 없으면 L1-g는 부모 대화에 agent.settled만 커밋하고 보고 입력을 만들지 않는다
   */
  readonly report?: DelegateReport;
  readonly toolPolicy?: DelegateToolPolicy;
  readonly limits?: DelegateLimits;
  /** 모델 역할 이름 또는 모델 참조. 없으면 정의의 model */
  readonly model?: string;
  readonly fork?: DelegateFork;
}

/**
 * 호출이 속한 대화와 취소 신호. on 핸들러는 `ctx.threadId`·`ctx.signal`을, 명령 처리기와 도구 `execute`는 자기 호출 문맥의
 * thread를 넘긴다 [제안]. X가 재실행 문맥을 알려 주면(L3.group-kit.spec §3.13 요청 6) 생략할 수 있다
 */
export interface DelegateCallOptions {
  readonly threadId?: ThreadId;
  readonly signal?: AbortSignal;
}

export interface DelegateReceipt {
  readonly requestId: string;
  readonly childThreadId: ThreadId;
  /** duplicate: 같은 requestId의 위임이 이미 있어 새로 만들지 않았다 */
  readonly status: "accepted" | "duplicate";
}

export type DelegateError =
  | {
      readonly kind: "group.delegateInvalid";
      readonly field: "requestId" | "report.customType" | "agent" | "fork";
      readonly message: string;
    }
  | { readonly kind: "group.delegateUnavailable" }
  | { readonly kind: "group.disabling"; readonly id: string }
  | { readonly kind: "group.delegateFailed"; readonly message: string };

/** L1.agents.spec §3.2 ChildStatus를 그룹에 보이는 모양. settled면 종료 상태만 싣는다. 사용량은 싣지 않는다 [제안] */
export type DelegateStatus =
  | { readonly state: "queued" | "running"; readonly childThreadId: ThreadId }
  | {
      readonly state: "settled";
      readonly childThreadId: ThreadId;
      readonly status: "completed" | "aborted" | "error";
    };

/** 재실행되는 문맥에서 부를 수 없는 호출(ADR-0015 §3.2 표). `delegateStatus`는 on 핸들러, `cancelDelegates`는 on 핸들러와 drive */
export interface DelegateContextError {
  readonly kind: "group.effectNotAllowed";
  readonly effect: "g.delegateStatus" | "g.cancelDelegates";
  readonly context: "on" | "drive";
}

export type DelegateStatusResult =
  | { readonly ok: true; readonly status: DelegateStatus | undefined }
  | {
      readonly ok: false;
      readonly error: DelegateContextError | { readonly kind: "group.delegateUnavailable" };
    };

export type CancelDelegatesResult =
  | { readonly ok: true; readonly cancelled: boolean }
  | {
      readonly ok: false;
      readonly error:
        | DelegateContextError
        | { readonly kind: "group.delegateUnavailable" }
        | { readonly kind: "group.delegateFailed"; readonly message: string };
    };

/** 복구 가능한 실패는 throw하지 않고 값으로 돌려준다(eng.typescript.guide TY-11) */
export type DelegateResult =
  | { readonly ok: true; readonly receipt: DelegateReceipt }
  | { readonly ok: false; readonly error: DelegateError };

/** requestId 길이 상한. ":report"(7자)를 붙여도 post의 64자 한도 안에 든다 */
export const DELEGATE_REQUEST_ID_MAX = 48;
const AGENT_NAME_MAX = 64;
const KIND_REGEX = new RegExp(RECORD_KIND_PATTERN);

/**
 * 위임 호출 전 입력 검사(L3.group-kit.spec §5 사례 12). 순수 함수.
 * 잘못이 없으면 undefined, 있으면 `group.delegateInvalid`를 돌려준다.
 */
export function checkDelegateSpec(spec: DelegateSpec, group: GroupId): DelegateError | undefined {
  if (spec.requestId.length < 1 || spec.requestId.length > DELEGATE_REQUEST_ID_MAX) {
    return {
      kind: "group.delegateInvalid",
      field: "requestId",
      message: `requestId must be 1..${DELEGATE_REQUEST_ID_MAX} characters`,
    };
  }
  const prefix = `grp.${group}.`;
  if (
    spec.report !== undefined &&
    (!spec.report.customType.startsWith(prefix) || !KIND_REGEX.test(spec.report.customType))
  ) {
    return {
      kind: "group.delegateInvalid",
      field: "report.customType",
      message: `report.customType must be a record kind that starts with ${prefix}`,
    };
  }
  if (spec.agent.length < 1 || spec.agent.length > AGENT_NAME_MAX || /\s/u.test(spec.agent)) {
    return {
      kind: "group.delegateInvalid",
      field: "agent",
      message: `agent must be 1..${AGENT_NAME_MAX} characters without whitespace`,
    };
  }
  if (spec.fork?.at === "event") {
    return {
      kind: "group.delegateInvalid",
      field: "fork",
      message:
        'fork.at "event" is rejected by L1.agents (agents.invalid_request); use { at: "item" }',
    };
  }
  return undefined;
}

/** 검사를 통과한 DelegateSpec을 L1 DelegateRequest로 옮긴다(L3.group-kit.spec §3.4 "L1 대응"). toolPolicy는 tools가 된다 */
export function toDelegateRequest(spec: DelegateSpec): DelegateRequest {
  return {
    agent: spec.agent,
    task: spec.task,
    requestId: spec.requestId,
    ...(spec.report === undefined ? {} : { report: spec.report }),
    ...(spec.toolPolicy === undefined ? {} : { tools: spec.toolPolicy }),
    ...(spec.limits === undefined ? {} : { limits: spec.limits }),
    ...(spec.model === undefined ? {} : { model: spec.model }),
    ...(spec.fork === undefined ? {} : { fork: spec.fork }),
  };
}

/** L1 결과를 그룹 쪽 결과로 옮긴다. `agents.unavailable`만 서비스 부재로 보고 나머지는 이유를 싣는다 */
export function delegateResultOf(result: AgentsDelegateResult): DelegateResult {
  if (result.ok) return { ok: true, receipt: result.receipt };
  if (result.error.kind === "agents.unavailable") {
    return { ok: false, error: { kind: "group.delegateUnavailable" } };
  }
  return {
    ok: false,
    error: {
      kind: "group.delegateFailed",
      message: `${result.error.kind}: ${result.error.message}`,
    },
  };
}

/** L1 ChildStatus를 그룹에 보이는 모양으로 줄인다 */
export function delegateStatusOf(status: ChildStatus): DelegateStatus {
  if (status.state === "settled") {
    return { state: "settled", childThreadId: status.childThreadId, status: status.result.status };
  }
  return { state: status.state, childThreadId: status.childThreadId };
}
