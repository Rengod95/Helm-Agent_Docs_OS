import type { Result } from "../base/index.ts";
import type {
  EventId,
  ImageContent,
  TextContent,
  ThreadId,
  TurnId,
} from "../conversation/index.ts";
import type { LoopPort, LoopTurnResult, PostItem } from "../extensions/index.ts";
import type { StoreError } from "../records/index.ts";
import type { ChildLimits } from "./agents.ts";
import type { InputMode, TaskScope } from "./tasks.ts";
import type { AdvertisedToolset, CallerId, PolicyCeiling } from "./tools.ts";

// L1.loop.spec §3.1. 구현은 core-loop다. LoopService는 LoopPort(F.extensions.spec §3.2.1)를 확장한다.
// 포트의 status와 이름이 겹치는 상세 상태는 threadStatus로 둔다.

export const LoopServiceName = "xeon.loop" as const;

export interface AdmitRequest {
  readonly threadId: ThreadId;
  readonly content: string | readonly (TextContent | ImageContent)[];
  /** 대화 범위 멱등 키 1~64자. 생략하면 IdFactory로 만든다 */
  readonly requestId?: string;
  readonly via: "interactive" | "rpc";
  /** turn 실행 중일 때 들어갈 모드. 생략하면 "followUp" */
  readonly whenBusy?: "steer" | "followUp" | "aside";
}

export type AdmitResult =
  | { readonly status: "started"; readonly inputId: EventId; readonly turnId: TurnId }
  | {
      readonly status: "queued";
      readonly inputId: EventId;
      readonly mode: InputMode;
      readonly runningTurnId: TurnId | null;
    }
  | { readonly status: "duplicate"; readonly inputId: EventId; readonly turnId: TurnId | null }
  /** input 지점 chain이 handled로 끝났다. 아무것도 기록하지 않는다 */
  | { readonly status: "handled" };

/** 자식 thread turn 실행 요청. L1.agents가 부른다 */
export interface ChildTurnRequest {
  /** 자식 thread. thread.started와 부모의 agent.spawned는 core-agents가 이미 커밋했다 */
  readonly threadId: ThreadId;
  /** 첫 turn이면 task 텍스트(user item). 끝난 자식에게 다시 묻는 경우 그 입력 */
  readonly input: PostItem;
  /** 자식 requestId. turn.started.requestId가 되고 멱등 키로 쓴다 */
  readonly requestId: string;
  /** 정의 prompt. L1.context 조립의 기본 프롬프트로 넘긴다 */
  readonly systemPrompt: string;
  /** ModelRole 이름 또는 ModelRef 문자열. xeon.models가 해석한다 */
  readonly model: string;
  /** 자식 ToolRunContext에 넣을 값 */
  readonly tools: {
    readonly caller: CallerId;
    readonly depth: number;
    readonly ceiling: PolicyCeiling;
    readonly surfaceThreadId: ThreadId;
    readonly interactive: boolean;
    readonly allow?: readonly string[];
    readonly keepParentList?: { readonly parent: AdvertisedToolset };
  };
  /** 자식 subagent 범위 노드. turn 노드를 이 아래에 연다 */
  readonly scope: TaskScope;
  readonly limits?: ChildLimits;
  readonly signal: AbortSignal;
}

export type ResumeFrom = "turn_start" | "request" | "tools" | "await_input" | "turn_end";

export type ResumeResult =
  | { readonly status: "resumed"; readonly turnId: TurnId; readonly from: ResumeFrom }
  | {
      readonly status: "closed";
      readonly turnId: TurnId;
      readonly reason: "abort_requested" | "owner_cancelled";
    }
  | { readonly status: "nothing" };

export interface ThreadLoopStatus {
  readonly threadId: ThreadId;
  readonly runningTurnId: TurnId | null;
  readonly stepIndex: number | null;
  readonly phase: "idle" | "requesting" | "tools" | "waiting" | "settling";
}

export type LoopError =
  | StoreError
  | { readonly kind: "thread_not_found"; readonly threadId: ThreadId }
  | { readonly kind: "turn_aborting"; readonly turnId: TurnId }
  | { readonly kind: "input_invalid"; readonly message: string }
  /** LoopTurnRequest.leaseEpoch가 그 scope의 현재 임대 차수보다 작다(펜싱) */
  | { readonly kind: "stale_lease"; readonly scopeId: string; readonly leaseEpoch: number };

/**
 * LoopPort에서 받는 것: status(threadId), runTurn(request), spawn(request), whenIdle(threadId, fn).
 * 포트 메서드는 Result를 쓰지 않는다. turn을 열기 전 실패(stale_lease, StoreError)는 Promise를 LoopError 값으로 거부한다.
 * LoopPort.status는 threadStatus(threadId).phase가 "idle"이면 "idle", 아니면 "running"이다.
 */
export interface LoopService extends LoopPort {
  /** 사용자 입력 제출. input 지점(chain)을 발화하고 xeon.tasks 큐에 넣는다 */
  admit(request: AdmitRequest): Promise<Result<AdmitResult, LoopError>>;
  /** 자식 thread turn. 주 대화와 같은 래퍼로 돈다. 같은 requestId면 기록된 결과를 돌려주거나 열린 turn을 이어 끝낸다 */
  runChildTurn(request: ChildTurnRequest): Promise<Result<LoopTurnResult, LoopError>>;
  /** 사용자 중단(Esc). xeon.tasks.abort를 부른다. 중단할 turn이 있었으면 true */
  interrupt(threadId: ThreadId, turnId?: TurnId): Promise<boolean>;
  /** 열린 turn을 재개한다. 자동 재개는 하지 않는다 */
  resume(threadId: ThreadId): Promise<Result<ResumeResult, LoopError>>;
  /** 진행 중 turn을 다음 단계 경계에서 멈추고 열린 채로 둔다. 시한 안에 모두 멈추면 true */
  stopAtSafeBoundary(deadlineMs: number): Promise<boolean>;
  /** 화면·호스트용 상세 상태. LoopPort.status와 이름이 겹쳐 threadStatus로 둔다 */
  threadStatus(threadId: ThreadId): ThreadLoopStatus;
}
