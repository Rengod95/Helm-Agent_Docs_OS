import type {
  AgentToolCall,
  AssistantMessage,
  EventId,
  ImageContent,
  ItemId,
  StepId,
  StopReason,
  ToolResultMessage,
  TurnId,
  Usage,
} from "@xeon/contracts/conversation";
import type { EffectIntent } from "@xeon/contracts/records";
import type { ChildTurnRequest, ModelBinding, TaskScope } from "@xeon/contracts/services";
import type { PlacedInput, StepRef } from "../commits.ts";
import type { ThreadRuntime } from "../types.ts";

// L1.loop.spec §3.2 진입점과 단계 결과(adr.0009). 루프 안에서만 쓰는 내부 타입이고 공개하지 않는다.

/** 재개 판별자(L1.loop.spec §4.5)가 그대로 진입점이 된다 */
export type TurnEntry =
  /** T1 직후. before_agent_start를 발화하고 첫 단계부터 */
  | {
      readonly kind: "fresh";
      readonly prompt: string;
      readonly images: readonly ImageContent[];
      /** 재개 때 `before_agent_start`가 추가한 item이 이미 있으면 다시 발화하지 않는다 */
      readonly skipBeforeStart: boolean;
    }
  /** 다음(또는 끊긴) 단계의 모델 요청부터. `adoptStepId`가 있으면 그 단계의 `step.started`는 이미 기록됨 */
  | {
      readonly kind: "request";
      readonly stepIndex: number;
      readonly adoptStepId: StepId | null;
      readonly binding: ModelBinding | null;
    }
  /** T3 뒤 도구 단계 중간부터. 남은 호출을 도구 배치가 돌린다 */
  | { readonly kind: "tools"; readonly resume: ToolsResume }
  /** 요청 없이 T6부터. `closing`이 있으면 결과 없이 남은 호출을 먼저 닫는다 */
  | {
      readonly kind: "turn_end";
      readonly closing: {
        readonly step: StepRef;
        readonly calls: readonly AgentToolCall[];
      } | null;
    };

export type ToolCallResume =
  | {
      readonly kind: "recorded";
      readonly toolCallId: string;
      readonly itemId: ItemId;
      readonly message: ToolResultMessage;
    }
  | { readonly kind: "rerun"; readonly toolCallId: string; readonly intent: EffectIntent }
  | { readonly kind: "run"; readonly toolCall: AgentToolCall };

export interface ToolsResume {
  readonly stepIndex: number;
  readonly stepId: StepId;
  readonly assistantItemId: ItemId;
  readonly assistant: AssistantMessage;
  readonly calls: readonly ToolCallResume[];
  readonly binding: ModelBinding | null;
  /** 승인 대기 호출을 이어 기다리는 재진입(await_input)이면 true */
  readonly awaitInput: boolean;
}

export interface TurnRunSpec {
  readonly thread: ThreadRuntime;
  readonly turnId: TurnId;
  readonly scope: TaskScope;
  readonly entry: TurnEntry;
  readonly interactive: boolean;
  /** drive turn이면 임대 scope id(모델 해석의 그룹 덮어쓰기 키) */
  readonly scopeId: string | null;
  /** drive turn이면 임대 id(경계 신호의 drivenBy) */
  readonly leaseId: string | null;
  /** drive turn 취소 신호: 켜지면 다음 단계 경계에서 결정 end */
  readonly driveSignal: AbortSignal | null;
  readonly consumedSeq: number;
  readonly leaseRefs: readonly EventId[];
  readonly scopeRef: EventId | null;
  /** 재개 전에 이미 끝난 단계 수와 사용량 */
  readonly priorStepCount: number;
  readonly priorUsage: Usage | null;
  readonly priorFinalItemId: ItemId | null;
  /** 재개 전 마지막 어시스턴트 응답의 stopReason과 오류 문장 */
  readonly priorLastStop: StopReason | null;
  readonly priorLastError: string | null;
  /** 자식 thread turn이면 그 요청(시스템 프롬프트, 모델, 도구 맥락, 한도). 주 대화와 drive turn은 null */
  readonly child: ChildTurnRequest | null;
}

export interface TurnRunResult {
  readonly status: "completed" | "interrupted" | "failed" | "open";
  readonly usage: Usage | null;
  readonly finalItemId: ItemId | null;
  readonly error: string | null;
  /** 호출자가 thread를 유휴로 표시한 뒤 부른다: 경계 `turn_settled`를 알리고 `agent_settled`를 발화한다 */
  readonly afterIdle: () => Promise<void>;
}

/** 단계 끝(C5) 뒤 루프가 고르는 다음 행동 */
export type StepNext =
  /** 도구 결과, steer, 게이트 계속. `placed`는 C5가 배치한 입력이고 다음 요청 앞에 붙는다 */
  | { readonly kind: "request"; readonly placed: readonly PlacedMessage[] }
  /** 정착한다. 소유 작업을 기다린 뒤 T6를 쓴다 */
  | { readonly kind: "settle" }
  /** turn을 연 채로 멈춘다(T6 없음). 재개 후보로 남는다 */
  | { readonly kind: "stop"; readonly reason: "stopped" | "deferred" };

/** 이미 커밋된 배치 입력. 다음 단계의 메시지 이벤트로 낸다 */
export type PlacedMessage = Pick<PlacedInput, "itemId" | "message">;

/** 루프 단계가 값으로 돌려주는 실패. 예외로 run을 멈추지 않는다(eng.typescript.guide TY-24) */
export type LoopFailure =
  | { readonly kind: "commit_failed"; readonly detail: string }
  /** 세션 읽기(읽기 연결의 busy, io, 손상 행)가 실패했다 */
  | { readonly kind: "read_failed"; readonly detail: string }
  | { readonly kind: "model_unavailable"; readonly detail: string }
  | { readonly kind: "context_unavailable"; readonly detail: string }
  | { readonly kind: "tools_unavailable"; readonly detail: string };

export function failureDetail(failure: LoopFailure): string {
  return `${failure.kind}: ${failure.detail}`;
}
