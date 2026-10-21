import type {
  EffectId,
  EventId,
  JsonValue,
  ReplayPolicy,
  ThreadId,
  ThreadStatus,
  TurnId,
  TurnStatus,
} from "../conversation/index.ts";
import type { StepCheckpoint } from "./checkpoint.ts";
import type { EffectStatus } from "./effects.ts";
import type { DurableEventDraft } from "./envelope.ts";

/** 커밋 키. 예: "tool:<toolCallId>:result", "in:user:<requestId>". 1~200자 */
export type CommitKey = string;
/** 형식 정본은 eng.transactions.design §4.7(review.decisions-2 U-13). L1·X는 이 상수 하나로 키를 검사한다 */
export const COMMIT_KEY_PATTERN: string = "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$";

/** 생산자 id. 형식 정본은 eng.context-map.design §5.1 */
export type ProducerId =
  | "core.persistence"
  | "core.tasks"
  | "core.loop"
  | "core.context"
  | "core.tools"
  | "core.agents"
  | "core.models"
  | `cap.${string}`
  | "xh"
  | `ext.${string}`;

declare const stampedBrand: unique symbol;

/** ProducerHandle이 kind 소유 검사를 마친 초안 */
export interface StampedDraft {
  readonly draft: DurableEventDraft;
  readonly producer: ProducerId;
  readonly [stampedBrand]: true;
}

export type DraftInput = Omit<DurableEventDraft, "durable" | "version"> & {
  /** 생략하면 카탈로그의 현재 버전 */
  readonly version?: number;
};

export interface ProducerHandle {
  readonly producer: ProducerId;
  /** 소유하지 않은 kind면 Bug("store.prefix_not_owned")를 던진다. 동기, 순수 */
  draft(input: DraftInput): StampedDraft;
}

/** StepCheckpoint에서 저장소가 채우는 필드(checkpointId, schemaVersion, threadId, leafEventId)를 뺀 것 */
export type StepCheckpointInput = Omit<
  StepCheckpoint,
  "checkpointId" | "schemaVersion" | "threadId" | "leafEventId"
>;

export type CommitPlan =
  | {
      readonly kind: "append";
      readonly drafts: readonly StampedDraft[];
      /** 있으면 drafts 끝에 checkpoint.step 이벤트를 더한다. drafts에 step.completed가 있어야 한다 */
      readonly checkpoint: StepCheckpointInput | null;
    }
  | { readonly kind: "reject"; readonly code: string; readonly detail: string | null };

export interface CommitRequest {
  /** 커밋 키의 범위가 되는 thread */
  readonly threadId: ThreadId;
  readonly requestId: CommitKey;
  /** 지문 원천. 생성 id, 시각, 시도 번호, 연결 id를 넣지 않는다(eng.transactions.design §4.7) */
  readonly fingerprintSource: JsonValue;
  /** 동기, 순수. 트랜잭션 안에서 한 번 부른다 */
  readonly build: (view: TxView) => CommitPlan;
  /** 있으면 build 전에 view.leaf와 비교한다. 다르면 rejected("leaf_conflict") */
  readonly expectedLeaf?: EventId | null;
}

export type CommitResult =
  | {
      readonly status: "committed";
      readonly firstSeq: number;
      readonly lastSeq: number;
      /** 이 커밋 뒤 threadId의 leaf */
      readonly leaf: EventId | null;
      /** 커밋한 이벤트 id, seq 순서. 재시도한 호출자가 처음 id를 다시 얻는다 */
      readonly eventIds: readonly EventId[];
      readonly replayed: boolean;
    }
  | {
      readonly status: "rejected";
      readonly code: string;
      readonly detail: string | null;
      readonly replayed: boolean;
    }
  | { readonly status: "key_reused"; readonly requestId: CommitKey };

export type ReadOnlyReason =
  | "observer"
  | "unknown_event_kind"
  | "newer_event_version"
  | "core_projection_stale";

/** 예상 가능한 실패. 판별 필드는 kind */
export type StoreError =
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "ownership_lost"; readonly threadId: ThreadId }
  | { readonly kind: "read_only"; readonly reason: ReadOnlyReason }
  | { readonly kind: "thread_not_found"; readonly threadId: ThreadId };

/** 결함. Bug의 메시지 앞머리 코드. 트랜잭션은 롤백되고 호출자가 처리할 대상이 아니다 */
export type StoreBugCode =
  | "store.nested_write"
  | "store.prefix_not_owned"
  | "store.producer_claimed"
  | "store.schema_invalid"
  | "store.kind_unregistered"
  | "store.event_too_large"
  | "store.checkpoint_without_step"
  | "store.projection_failed"
  | "store.replay_diverged";

// ── TxView: build가 읽는 트랜잭션 안 보기 (L1.persistence.spec §3.2) ─────────────

export interface TurnView {
  readonly turnId: TurnId;
  readonly status: TurnStatus;
  readonly abortRequested: boolean;
  readonly stepCount: number;
}

export interface EffectView {
  readonly effectId: EffectId;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly replay: ReplayPolicy;
  /** effect.exec 건수. 첫 실행 1, 재실행마다 1 증가 */
  readonly execCount: number;
  readonly result: { readonly status: EffectStatus; readonly synthesized: boolean } | null;
}

export interface InputView {
  readonly inputId: EventId;
  readonly seq: number;
  readonly mode: "steer" | "followUp" | "next" | "aside";
  readonly state: "queued" | "placed" | "withdrawn";
  readonly sourceKey: string;
  readonly requestId: string;
}

export interface ApprovalView {
  readonly approvalId: EventId;
  readonly threadId: ThreadId;
  readonly toolCallId: string | null;
  readonly resolved: boolean;
}

/** 자식 thread 연결(L1.agents.spec §3.5). 투영 p_agents */
export interface AgentView {
  readonly childThreadId: ThreadId;
  readonly parentThreadId: ThreadId;
  /** 자식 requestId(L1.agents.spec §4.5) */
  readonly requestId: string;
  readonly ownerTurnId: TurnId | null;
  readonly background: boolean;
  readonly depth: number;
  /** agent.settled가 있으면 그 상태와 이벤트 id */
  readonly settled: {
    readonly status: "completed" | "aborted" | "error";
    readonly eventId: EventId;
  } | null;
}

export interface TxView {
  readonly threadId: ThreadId;
  /** DB 전역 head seq */
  readonly headSeq: number;
  readonly leaf: EventId | null;
  readonly threadStatus: ThreadStatus | "absent";
  turn(turnId: TurnId): TurnView | undefined;
  turnAbortRequested(turnId: TurnId): boolean;
  effect(effectId: EffectId): EffectView | undefined;
  effectByToolCall(threadId: ThreadId, toolCallId: string): EffectView | undefined;
  /** drive turn·자식 turn 멱등 조회. scopeId가 null이면 scope 없는 turn. 투영 p_turns (thread_id, scope_id, request_id) */
  turnByRequestId(
    threadId: ThreadId,
    scopeId: string | null,
    requestId: string,
  ): TurnView | undefined;
  /** drive turn 펜싱. p_scopes.lease_epoch. 임대가 없었으면 0 */
  scopeLeaseEpoch(threadId: ThreadId, scopeId: string): number;
  inputByRequestId(threadId: ThreadId, sourceKey: string, requestId: string): InputView | undefined;
  queuedInputs(threadId: ThreadId): readonly InputView[];
  approval(approvalId: EventId): ApprovalView | undefined;
  /** 멱등 조회. 부모 대화의 agent.spawned 중 같은 requestId */
  agentByRequestId(parentThreadId: ThreadId, requestId: string): AgentView | undefined;
  /** expectStateRev 검사용. 없으면 0 */
  scopeStateRev(threadId: ThreadId, scopeId: string): number;
  lastCheckpoint(threadId: ThreadId): StepCheckpoint | null;
}

/** 테스트용 장애 주입 지점(eng.transactions.design §4.2). 운영 구현은 아무것도 하지 않는다 */
export type FaultPoint =
  | "after_begin"
  | "after_lease_check"
  | "after_request_check"
  | `after_event_insert:${number}`
  | `after_projection:${number}`
  | `after_ext_projection:${number}`
  | "before_checkpoint"
  | "before_request_insert"
  | "before_commit"
  | "after_commit";

export interface FaultInjector {
  hit(point: FaultPoint): void;
}
