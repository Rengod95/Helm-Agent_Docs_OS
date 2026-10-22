import type { Result } from "../base/index.ts";
import type { EventId, ItemId, ThreadId, TurnId } from "../conversation/index.ts";
import type {
  InputQueuePort,
  PortKey,
  PostItem,
  PostReceipt,
  Unsubscribe,
} from "../extensions/index.ts";
import type {
  CommitRequest,
  InputView,
  StampedDraft,
  StoreError,
  TxView,
} from "../records/index.ts";

// L1.tasks.spec §3. 구현은 core-tasks다. 인터페이스의 정본은 이 파일이다(F.capabilities.spec §3.12 규칙 1).

export const TaskServiceName = "xeon.tasks" as const;

/** `xeon.tasks` 전체 모양(TaskService)의 포트 키. 제공 core-tasks. 등록 부분형(InputQueuePort)의 키는 extensions의 `InputQueuePortKey`다 */
export const TaskServicePortKey: PortKey<TaskService> = { name: TaskServiceName };

// ── 범위 트리 ────────────────────────────────────────────────────────────

export type TaskScopeKind = "app" | "thread" | "turn" | "tool" | "subagent";
export type TaskScopeState = "live" | "aborting" | "settling" | "settled";

export type AbortCode = "user" | "parent" | "lease_revoked" | "budget" | "lease_lost" | "error";

export interface AbortReason {
  readonly code: AbortCode;
  readonly message: string | null;
}

/** 취소 의도 커밋 요청을 만든다. 동기. null이면 내구 의도 없이 신호만 보낸다 */
export type AbortIntentWriter = (
  reason: AbortReason,
  cause: "direct" | "cascade",
) => CommitRequest | null;

export interface TaskScopeSpec {
  readonly kind: Exclude<TaskScopeKind, "app">;
  /** thread·subagent는 ThreadId, turn은 TurnId, tool은 toolCallId */
  readonly id: string;
  /** subagent 노드이고 부모가 thread일 때만 true를 허용한다 */
  readonly background?: boolean;
  /** 내구 노드(turn, subagent)의 의도 기록기. 소유 패키지가 넘긴다 */
  readonly abortIntent?: AbortIntentWriter;
}

export interface ScopeOutcome {
  readonly aborted: boolean;
  readonly reason: AbortReason | null;
}

export interface TaskScope {
  readonly kind: TaskScopeKind;
  readonly id: string;
  readonly parent: TaskScope | null;
  readonly background: boolean;
  /** AbortSignal.any([부모 신호, 자기 신호]). 백그라운드 노드는 [root 신호, 자기 신호]. signal.reason은 AbortReason이다 */
  readonly signal: AbortSignal;
  readonly state: TaskScopeState;
  readonly abortReason: AbortReason | null;
  children(): readonly TaskScope[];
  /** 이 노드의 작업으로 등록한다. 등록한 Promise가 끝나기 전에는 정착하지 않는다 */
  track<T>(work: Promise<T>): Promise<T>;
  /** 소유 작업과 track한 작업이 모두 끝나면 이행한다. 여러 번 불러도 같은 Promise */
  settle(): Promise<ScopeOutcome>;
}

// ── 취소 ─────────────────────────────────────────────────────────────────

export interface AbortOptions {
  /** true면 백그라운드 경계를 넘어 그 아래도 취소한다 */
  readonly background?: boolean;
}

export type AbortTicket =
  | { readonly status: "signalled"; readonly settled: Promise<ScopeOutcome> }
  | { readonly status: "already_aborting"; readonly settled: Promise<ScopeOutcome> }
  | { readonly status: "already_settled" };

// ── 동시 상한 ────────────────────────────────────────────────────────────

export type PoolName = "tools" | "subagents" | "modelCalls";

export interface Slot {
  readonly pool: PoolName;
  readonly owner: TaskScope;
  /** 반납. 두 번째 호출은 아무것도 하지 않는다. owner가 정착하면 자동 반납한다 */
  release(): void;
  /** 반납 → wait 대기 → 같은 풀에서 재획득. 다른 노드를 기다릴 때 쓴다 */
  suspendWhile<T>(wait: Promise<T>): Promise<T>;
}

export interface Limiter {
  readonly pool: PoolName;
  capacity(): number;
  inUse(): number;
  waiting(): number;
  /** 슬롯을 얻는다. 꽉 차면 FIFO로 대기한다. 대기 중 owner.signal이 켜지면 대기열에서 빠지고 signal.reason으로 거부한다 */
  acquire(owner: TaskScope): Promise<Slot>;
}

// ── 키 큐 ────────────────────────────────────────────────────────────────

export type LockMode = "shared" | "exclusive";

export interface LockRequest {
  /** 불투명 키. 파일이면 L1.tools가 만든 `${env.id}\0${realpath}` */
  readonly key: string;
  readonly mode: LockMode;
}

export interface KeyedQueue {
  /** 키를 사전순으로 차례로 얻은 뒤 fn을 실행하고 모두 놓는다. 대기 중 owner.signal이 켜지면 대기열에서 빠지고 signal.reason으로 거부한다 */
  run<T>(locks: readonly LockRequest[], owner: TaskScope, fn: () => Promise<T>): Promise<T>;
  /** 진단용. 이 키를 쥐었거나 기다리는 작업 수 */
  pending(key: string): number;
}

// ── 내구 입력 큐 ─────────────────────────────────────────────────────────

export type InputMode = "steer" | "followUp" | "next" | "aside";
export type DrainMode = "all" | "one-at-a-time";
export type PlacementPoint = "turnStart" | "stepEnd";

export type InputSource =
  | { readonly type: "user"; readonly via: "interactive" | "rpc" }
  | { readonly type: "extension"; readonly scopeId: string }
  | { readonly type: "delegation"; readonly childThreadId: ThreadId }
  | { readonly type: "schedule"; readonly timerId: string };

export interface InputDraft {
  readonly threadId: ThreadId;
  readonly mode: InputMode;
  readonly item: PostItem;
  /** 대화 범위 멱등 키. 브랜드 없는 문자열 1~64자 */
  readonly requestId: string;
  readonly source: InputSource;
}

export interface QueuedInput extends InputDraft {
  /** input.queued 이벤트의 id */
  readonly inputId: EventId;
  /** input.queued 이벤트의 seq */
  readonly seq: number;
}

export interface EnqueueReceipt extends PostReceipt {
  readonly inputId: EventId;
  /** duplicate면 기존 입력의 현재 상태 */
  readonly state: "queued" | "placed" | "withdrawn";
}

export interface InputPlacement {
  readonly inputId: EventId;
  readonly itemId: ItemId;
  readonly turnId: TurnId;
}

export interface PlacementSelection {
  /** seq 순서 */
  readonly inputs: readonly QueuedInput[];
  /** 선택한 입력 중 가장 큰 seq. 없으면 직전 값. StepCheckpoint.inputCursor.consumedSeq에 쓴다 */
  readonly consumedSeq: number;
  /** 호출자가 정한 item id로 input.placed 초안을 만든다. 순수 */
  drafts(placements: readonly InputPlacement[]): readonly StampedDraft[];
}

export interface DrainOptions {
  /** stepEnd에서 다음 모델 요청이 이어질지. 도구 호출, 선택된 steer, continue 결정 중 하나라도 있으면 true */
  readonly continuing: boolean;
}

export type WithdrawReason = "user" | "aborted" | "superseded";

export type InputQueueError =
  | StoreError
  | { readonly kind: "invalid_request_id"; readonly requestId: string }
  | { readonly kind: "mode_not_supported"; readonly mode: InputMode }
  | { readonly kind: "thread_closed"; readonly threadId: ThreadId };

export interface InputQueue {
  /** input.queued를 커밋한다. 같은 (threadId, 출처 키, requestId)가 있으면 쓰지 않고 duplicate:true */
  enqueue(draft: InputDraft): Promise<Result<EnqueueReceipt, InputQueueError>>;
  /**
   * 다른 도메인의 커밋 build 안에서 부르는 동기·순수 함수. input.queued 초안을 만든다.
   * 같은 (threadId, 출처 키, requestId)의 입력이 있으면 drafts는 비고 existing에 그 입력을 싣는다.
   */
  draftQueued(
    view: TxView,
    draft: InputDraft,
  ): {
    readonly drafts: readonly StampedDraft[];
    readonly existing: InputView | undefined;
  };
  /** 투영 p_inputs의 queued 행. seq 순서 */
  peek(threadId: ThreadId, modes?: readonly InputMode[]): readonly QueuedInput[];
  /** 커밋 build 안에서 부르는 동기·순수 함수. 선택만 하고 커밋은 호출자(loop)가 한다 */
  drain(
    view: TxView,
    threadId: ThreadId,
    at: PlacementPoint,
    options: DrainOptions,
  ): PlacementSelection;
  /** queued 입력을 거둔다. 거둔 수를 돌려준다. 이미 placed인 입력은 세지 않는다 */
  withdraw(
    threadId: ThreadId,
    target: EventId | "all",
    reason: WithdrawReason,
  ): Promise<Result<number, InputQueueError>>;
  /** input.queued 커밋 뒤 동기로 부른다. 쓰기가 필요하면 queueMicrotask로 미룬다 */
  onQueued(listener: (threadId: ThreadId) => void): Unsubscribe;
}

// ── 활동 집계 ────────────────────────────────────────────────────────────

export interface ActivitySnapshot {
  /** 정착하지 않은 turn 노드 수 */
  readonly liveTurns: number;
  /** 정착하지 않은 turn, tool, subagent 노드 수. 백그라운드 포함 */
  readonly liveTasks: number;
  /** 전 thread의 queued 입력 수 */
  readonly queuedInputs: number;
}

/**
 * InputQueuePort(F.extensions.spec §3.2.1)에서 받는 것: enqueue(request: EnqueueRequest): Promise<EnqueueResult>.
 * 확장 post의 진입점이다. 내부에서 inputs.enqueue를 부른다.
 */
export interface TaskService extends InputQueuePort {
  /** app 노드. 엔진 인스턴스당 하나 */
  readonly root: TaskScope;
  /** 범위 노드를 만든다. 허용 부모는 L1.tasks.spec §4.1 표. 위반이면 Bug("tasks.invalid_parent")를 던진다 */
  openScope(parent: TaskScope, spec: TaskScopeSpec): TaskScope;
  /** 살아 있는 노드를 찾는다 */
  find(kind: TaskScopeKind, id: string): TaskScope | undefined;
  /** 취소. 의도를 먼저 커밋하고 신호를 보낸다 */
  abort(
    target: TaskScope,
    reason: AbortReason,
    options?: AbortOptions,
  ): Promise<Result<AbortTicket, StoreError>>;
  /** 풀별 상한기 */
  limiter(pool: PoolName): Limiter;
  /** 키 큐. 엔진 인스턴스당 하나 */
  readonly locks: KeyedQueue;
  /** 내구 입력 큐 */
  readonly inputs: InputQueue;
  activity(): ActivitySnapshot;
  onActivity(listener: () => void): Unsubscribe;
  /** 프로세스 종료용. 모든 노드에 신호만 보내고 의도는 쓰지 않는다. 다음 열기에서 재개된다 */
  close(): Promise<void>;
}
