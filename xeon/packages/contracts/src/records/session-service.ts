import type { Result } from "../base/index.ts";
import type {
  EffectId,
  EventId,
  ItemId,
  JsonValue,
  ReplayPolicy,
  ThreadId,
  ThreadStatus,
  TurnId,
  Usage,
} from "../conversation/index.ts";
import type { StepCheckpoint, PendingToolCall } from "./checkpoint.ts";
import type {
  AgentView,
  ApprovalView,
  CommitRequest,
  CommitResult,
  EffectView,
  InputView,
  ProducerHandle,
  ProducerId,
  ReadFailure,
  ReadOnlyReason,
  StoreError,
  TurnView,
} from "./commit.ts";
import type { EffectIntent } from "./effects.ts";
import type { DurableEventDraft, DurableEventEnvelope, VolatileEventEnvelope } from "./envelope.ts";
import type { EventKind, ExtensionEventKind } from "./kinds.ts";
import type { LeaseOwnerInfo, LeaseToken } from "./lease.ts";
import type { ProjectorRegistry, Unsubscribe } from "./projector.ts";

export type { Unsubscribe } from "./projector.ts";

export const SessionServiceName = "xeon.session" as const;

// ── 읽기와 구독 (L1.persistence.spec §3.5) ───────────────────────────────

/** 커밋 하나의 결과. (firstSeq - 1, lastSeq] 구간 */
export interface CommitBatch {
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly events: readonly DurableEventEnvelope[];
}
export type CommitListener = (batch: CommitBatch) => void;

/** F.wire-settings.spec §3.4.1 EventFilter와 같은 모양 */
export interface FeedFilter {
  readonly threadIds?: readonly ThreadId[];
  readonly kindPrefixes?: readonly string[];
  readonly excludeKindPrefixes?: readonly string[];
}

export interface EventFeed {
  headSeq(): Result<number, ReadFailure>;
  /** 다시 보낼 수 있는 가장 오래된 seq - 1. 로그를 잘라 내지 않으므로 M1은 항상 0 */
  oldestReplayableSeq(): number;
  /** seq > after AND seq ≤ upto, 필터 적용. limit만큼 차면 멈추고, 아니면 scanLimit 행까지 훑는다 */
  read(
    after: number,
    upto: number,
    filter: FeedFilter | undefined,
    limit: number,
    scanLimit: number,
  ): Result<
    { readonly events: readonly DurableEventEnvelope[]; readonly scannedTo: number },
    ReadFailure
  >;
  /** 커밋 직후 같은 JS 턴에서 동기로 부른다(TX-09) */
  onCommit(listener: CommitListener): Unsubscribe;
  onVolatile(listener: (event: VolatileEventEnvelope) => void): Unsubscribe;
}

// ── 투영 조회 (L1.persistence.spec §3.4) ─────────────────────────────────

export interface ThreadSummaryRow {
  readonly threadId: ThreadId;
  readonly title: string | null;
  readonly status: ThreadStatus;
  readonly workspace: string | null;
  readonly createdAt: number;
  /** 마지막 이벤트 recordedAt */
  readonly updatedAt: number;
  /** 이 thread의 마지막 seq */
  readonly headSeq: number;
  readonly forkedFrom: { readonly threadId: ThreadId; readonly eventId: EventId } | null;
  /** 후보 표시 */
  readonly marker: RecoveryMarker | null;
  readonly queuedInputs: number;
  readonly pendingApprovals: number;
}

export interface ItemRow {
  readonly itemId: ItemId;
  readonly eventId: EventId;
  readonly seq: number;
  readonly kind: "user" | "assistant" | "system" | "toolResult" | "custom";
  readonly turnId: TurnId | null;
  readonly status: "in_progress" | "completed" | "failed" | "interrupted";
}

/**
 * 다른 컨텍스트가 p_*를 직접 읽지 않게 하는 질의 묶음(CM-02).
 * 읽기 연결의 busy·io와 손상 행은 예상 가능한 실패라 `Result<_, ReadFailure>`로 돌려준다(TY-24)
 */
export interface ProjectionQuery {
  thread(threadId: ThreadId): Result<ThreadSummaryRow | undefined, ReadFailure>;
  turn(threadId: ThreadId, turnId: TurnId): Result<TurnView | undefined, ReadFailure>;
  openTurn(threadId: ThreadId): Result<TurnView | undefined, ReadFailure>;
  /** TxView.turnByRequestId와 같은 조회. 트랜잭션 밖 읽기 */
  turnByRequestId(
    threadId: ThreadId,
    scopeId: string | null,
    requestId: string,
  ): Result<TurnView | undefined, ReadFailure>;
  openEffects(threadId: ThreadId): Result<readonly EffectView[], ReadFailure>;
  queuedInputs(threadId: ThreadId): Result<readonly InputView[], ReadFailure>;
  pendingApprovals(threadId: ThreadId): Result<readonly ApprovalView[], ReadFailure>;
  /** 부모 대화의 자식 thread 연결. unsettledOnly가 참이면 정착하지 않은 것만 */
  childAgents(
    parentThreadId: ThreadId,
    options?: { readonly unsettledOnly?: boolean },
  ): Result<readonly AgentView[], ReadFailure>;
  /** 활성 가지의 item, 순서대로. 컨텍스트 조립과 화면이 쓴다 */
  branchItems(
    threadId: ThreadId,
    options?: { readonly afterItemId?: ItemId; readonly limit?: number },
  ): Result<readonly ItemRow[], ReadFailure>;
  /** item을 기록한 이벤트 id(fork, revert의 대상 해석) */
  itemEvent(threadId: ThreadId, itemId: ItemId): Result<EventId | undefined, ReadFailure>;
  /** onActiveBranch가 참이면 활성 가지(현재 leaf에서 parentId 사슬) 위 이벤트만 본다 */
  latestEvent(
    threadId: ThreadId,
    kind: EventKind,
    match?: { readonly pointer: string; readonly equals: JsonValue },
    options?: { readonly onActiveBranch?: boolean },
  ): Result<DurableEventEnvelope | undefined, ReadFailure>;
  /** 참조 중인 blob 해시. GC 뿌리 집합 */
  liveBlobRefs(): Result<readonly string[], ReadFailure>;
}

// ── 쓰기 소유와 열기 (L1.persistence.spec §3.6) ───────────────────────────
// 쓰기 소유 증표는 LeaseToken(resource = "session:<threadId>")이다(review.decisions-2 U-09).
// F.records.spec §3.9 표의 OwnershipGuard·OwnerInfo는 U-09로 대체되어 두지 않는다.

export interface RecoveryMarker {
  readonly turnId: TurnId;
  /** 열린 turn의 turn.started recordedAt */
  readonly runningSince: number;
  /** 그 turn의 thread.resumed 수 */
  readonly resumeAttempts: number;
}

export interface OpenReport {
  readonly threadId: ThreadId;
  readonly role: "owner" | "observer";
  /** thread의 마지막 seq */
  readonly headSeq: number;
  readonly marker: RecoveryMarker | null;
  readonly readOnly: ReadOnlyReason | null;
  /** 이번 열기에서 다시 만든 투영기 이름 */
  readonly rebuilt: readonly string[];
  /** leases.inspect 결과. 표시용이고 판정에 쓰지 않는다 */
  readonly owner: LeaseOwnerInfo | null;
}

export type OpenError =
  | { readonly kind: "thread_not_found"; readonly threadId: ThreadId }
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "io"; readonly code: string }
  /** 읽은 행이 스키마와 다르다 */
  | { readonly kind: "row_invalid"; readonly where: string }
  /** token.resource가 session:<threadId>가 아니거나 leases.holds가 거짓 */
  | { readonly kind: "guard_mismatch"; readonly threadId: ThreadId };

// ── 재개 타입 (L1.persistence.spec §3.7) ──────────────────────────────────

/** 재실행 상한. 첫 실행 뒤 재실행은 이 수까지 [제안: eng.transactions.design §5.2 값] */
export const MAX_REPLAY_ATTEMPTS = 2 as const;

export interface EffectRerun {
  readonly intent: EffectIntent;
  /** 1부터. effect.exec 커밋 키의 끝 토막이 된다 */
  readonly attempt: number;
}

export type AutoResumeVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason:
        | "no_marker"
        | "setting_off"
        | "not_service_mode"
        | "attempts_exhausted"
        | "abort_requested";
    };

export interface ResumePlan {
  readonly threadId: ThreadId;
  readonly checkpoint: StepCheckpoint | null;
  readonly marker: RecoveryMarker | null;
  /** recover가 이미 커밋한 합성 결과 */
  readonly synthesized: readonly {
    readonly effectId: EffectId;
    readonly toolCallId: string;
    readonly code: "not_started" | "outcome_unknown";
  }[];
  /** 호출자(core-loop)가 ToolService.rerun으로 다시 실행할 효과 */
  readonly reruns: readonly EffectRerun[];
  /** 의도가 없는 도구 호출. 승인 대기 포함 */
  readonly pendingToolCalls: readonly PendingToolCall[];
  /** 해결되지 않은 approval.requested id. 호출자가 ApprovalService.restore를 부른다 */
  readonly pendingApprovals: readonly EventId[];
  readonly queuedInputs: readonly InputView[];
  /** 열린 turn이 소유한, 정착하지 않은 자식 thread */
  readonly openChildren: readonly AgentView[];
  /** turn.abort_requested가 있는 열린 turn. 호출자가 재개하지 않고 닫는다 */
  readonly abortRequestedTurn: TurnId | null;
  /** 체크포인트의 next. 열린 turn이 없으면 "idle" */
  readonly next: StepCheckpoint["next"] | "idle";
  readonly autoResume: AutoResumeVerdict;
}

export type ResumeError =
  | StoreError
  | { readonly kind: "no_open_turn"; readonly threadId: ThreadId }
  | { readonly kind: "attempts_exhausted"; readonly attempts: number; readonly max: number };

export interface RecoverDeps {
  /** 현재 등록된 도구의 재생 정책. 도구가 없으면 null */
  readonly toolReplay: (toolName: string) => ReplayPolicy | null;
  /** 소유 사슬 취소 판정(L1.tasks.spec §4.8 3번 isCancelledByOwner) */
  readonly cancelledByOwner: (threadId: ThreadId, turnId: TurnId) => boolean;
  /** 호스트 모드. 자동 재개 판정에 쓴다 */
  readonly hostMode: "in-process" | "stdio" | "service";
}

// ── 수명주기와 분기 (L1.persistence.spec §3.8) ────────────────────────────

export interface ThreadCreated {
  readonly threadId: ThreadId;
  readonly headSeq: number;
  /** 같은 creationKey로 이미 만든 thread를 돌려줬으면 참. threadId는 처음 만든 값이다 */
  readonly replayed: boolean;
  /** inheritOwnerFrom으로 만든 자식 thread의 세션 임대 토큰. 그 밖은 null */
  readonly token: LeaseToken | null;
}

export interface ThreadCreateInput {
  readonly threadId: ThreadId;
  readonly title?: string;
  readonly workspace?: string;
  /** 전역 생성 멱등 키 1~200자. 같은 키의 두 번째 호출은 새 thread를 만들지 않는다 */
  readonly creationKey?: string;
  /** 자식 thread 생성. 부모 thread의 토큰. 같은 holder로 session:<threadId> 임대를 얻는다 */
  readonly inheritOwnerFrom?: LeaseToken;
}

export interface ThreadListQuery {
  readonly workspace?: string;
  /** 기본 false */
  readonly includeClosed?: boolean;
  /** 불투명. (updatedAt, threadId) 내림차순 위치 */
  readonly cursor?: string;
  /** 1~200, 기본 50 */
  readonly limit?: number;
}

export interface ThreadPage {
  readonly threads: readonly ThreadSummaryRow[];
  readonly nextCursor: string | null;
}

export interface BranchSummaryInput {
  readonly summary: string;
  readonly details: JsonValue | null;
  readonly usage: Usage | null;
}

/** F.extensions.spec §3.5 */
export type SessionShutdownReason = "quit" | "reload" | "new" | "resume" | "fork";

export type LifecycleError =
  | StoreError
  | { readonly kind: "not_owner"; readonly threadId: ThreadId }
  | { readonly kind: "thread_closed"; readonly threadId: ThreadId }
  /** 같은 requestKey를 다른 내용(제목, 이동 대상·이유·요약)으로 다시 썼다. 호출자가 키를 잘못 쓴 것이다 */
  | { readonly kind: "key_reused"; readonly requestKey: string }
  | { readonly kind: "turn_running"; readonly turnId: TurnId }
  | { readonly kind: "has_forks"; readonly forks: readonly ThreadId[] }
  | {
      readonly kind: "invalid_target";
      readonly reason: "item_not_found" | "not_on_branch" | "inside_turn" | "open_tool_calls";
    }
  | {
      readonly kind: "cancelled_by_extension";
      readonly point: "session_before_fork" | "session_before_tree" | "session_before_switch";
      readonly reason: string | null;
    };

export interface ThreadLifecycle {
  /** thread.started 커밋. 새 thread의 첫 이벤트라 쓰기 소유 검사를 건너뛴다 */
  create(input: ThreadCreateInput): Result<ThreadCreated, LifecycleError>;
  list(query: ThreadListQuery): ThreadPage;
  /** thread.closed 커밋. 쓰기 소유자만. 열린 turn이 있으면 turn_running */
  close(threadId: ThreadId, reason: string | null): Result<void, LifecycleError>;
  /** 이벤트와 투영 행을 지운다. 쓰기 소유자만. 이 thread를 forkedFrom으로 가리키는 thread가 있으면 has_forks */
  remove(threadId: ThreadId): Result<void, LifecycleError>;
  /** session_before_fork(first) 뒤 새 thread의 thread.started{forkedFrom} 커밋 */
  fork(
    threadId: ThreadId,
    at: ItemId | undefined,
    newThreadId: ThreadId,
  ): Promise<Result<ThreadCreated, LifecycleError>>;
  /** session_before_tree(first) 뒤 thread.leaf_moved{reason:"rewind"} 커밋. 파일은 되돌리지 않는다 */
  revert(
    threadId: ThreadId,
    to: ItemId,
    requestKey: string,
  ): Promise<Result<{ readonly leaf: EventId; readonly headSeq: number }, LifecycleError>>;
  /** 가지 이동. summary가 있으면 thread.branch_summarized를 같은 커밋에 넣는다 */
  moveLeaf(
    threadId: ThreadId,
    target: EventId,
    options: {
      readonly reason: "branch" | "restore";
      readonly summary?: BranchSummaryInput;
      readonly requestKey: string;
    },
  ): Promise<Result<{ readonly leaf: EventId; readonly headSeq: number }, LifecycleError>>;
  /** thread.updated{title} 커밋 뒤 session_info_changed(tap, detached). L2 artifacts가 부른다 */
  setTitle(
    threadId: ThreadId,
    title: string | null,
    requestKey: string,
  ): Result<void, LifecycleError>;
  /** 같은 클라이언트가 다른 thread로 옮기기 전에 session_before_switch(first)를 발화한다 */
  prepareSwitch(from: ThreadId, to: ThreadId | null): Promise<Result<void, LifecycleError>>;
}

// ── 세션 범위 설정 (L1.persistence.spec §6.2) ─────────────────────────────

/**
 * settings의 ScopeLayer와 같은 모양(scope: "session"). records는 settings보다 낮은 순위라(F.readme §3)
 * import하지 않고 같은 모양을 적는다. SettingKey는 문자열이다.
 */
export interface SessionSettingsLayer {
  readonly scope: "session";
  readonly values: ReadonlyMap<string, unknown>;
}

/**
 * session 범위 설정 쓰기 실패. 저장소 오류에 더해, 같은 `requestKey`를 다른 값으로 다시 쓴 것은 호출자가 키를 잘못 쓴 예상 가능한 실패라
 * 값으로 돌려준다(TY-24). 키를 호출마다 새로 만드는 호출자(`setMode`)에게는 일어나지 않는다
 */
export type SessionSettingsError =
  | StoreError
  | { readonly kind: "key_reused"; readonly requestKey: string };

export interface SessionSettingsStore {
  /** session 범위 층. resolveSetting의 ScopeStack에 넣는다(F.wire-settings.spec §3.9) */
  layer(threadId: ThreadId): SessionSettingsLayer;
  /** checkSettingWrite 통과 뒤 settings.changed 커밋. 비밀 키는 SecretRef만 */
  set(
    threadId: ThreadId,
    key: string,
    value: JsonValue,
    requestKey: string,
  ): Result<void, SessionSettingsError>;
  /** settings.changed { value: null } 커밋 */
  reset(threadId: ThreadId, key: string, requestKey: string): Result<void, SessionSettingsError>;
}

// ── X 기록 포트 (X.primitives.spec §3.6) ──────────────────────────────────
// 정본은 F.records.spec §3.9 블록이다. records는 extensions보다 낮아(F.readme §3)
// ScopeId·LeaseId·DriveLimits·RecordQuery·GroupRecord를 import하지 않고 같은 모양을 적는다.
// 이름 대응: scopeId ↔ ScopeId, leaseId ↔ LeaseId, limits ↔ DriveLimits, ExtRecordQuery ↔ RecordQuery,
// ExtRecordRow ↔ GroupRecord, reader ↔ ExtensionName.

export interface ExtCommitRequest {
  readonly threadId: ThreadId;
  /** SessionWriter 멱등 키. 같은 키의 두 번째 커밋은 기록된 결과를 돌려준다. 형식은 COMMIT_KEY_PATTERN */
  readonly requestId: string;
  readonly drafts: readonly DurableEventDraft[];
  /** 상태 커밋이면 기대하는 직전 판. 활성 가지 위 판과 비교한다. 다르면 rejected(state_conflict) */
  readonly expectStateRev?: { readonly scopeId: string; readonly rev: number };
  /** 멱등 지문의 원천. 있으면 drafts 대신 이 값으로 지문을 만든다 */
  readonly fingerprintSource?: JsonValue;
  /**
   * 기록 초안의 공개 범위 [결정(잠정): review.decisions-2 T-21]. 생략하면 "public".
   * "private"는 ScopeApi.recordPrivate만 쓴다
   */
  readonly visibility?: "public" | "private";
}

export type ExtCommitRejectCode =
  | "state_conflict"
  | "lease_lost"
  /** 저장소의 key_reused와 초안 검증 실패 */
  | "invalid"
  /** 쓰기 잠금 대기 초과 */
  | "busy"
  /** disk_full, read_only 같은 저장 매체 실패 */
  | "storage";

export interface StoredScopeState {
  readonly scopeId: string;
  /** 이 판을 남긴 state.committed 이벤트 id. 다음 상태 이벤트의 prevEventId가 된다 */
  readonly eventId: EventId;
  /** 활성 가지 위 판 */
  readonly rev: number;
  /** 저장 당시 StateDecl.version */
  readonly version: number;
  readonly doc: JsonValue;
}

export type ExtCommitResult =
  | { readonly status: "committed" }
  /** 같은 requestId가 이미 커밋됨. 상태 커밋이면 stored에 그때 저장된 상태를 싣는다 */
  | { readonly status: "replayed"; readonly stored?: StoredScopeState }
  | { readonly status: "rejected"; readonly code: ExtCommitRejectCode };

export interface OpenLease {
  readonly leaseId: string;
  readonly scopeId: string;
  readonly leaseEpoch: number;
  readonly limits: {
    readonly maxTurns?: number;
    readonly maxSpawns?: number;
    readonly maxTokens?: number;
  };
  readonly used: {
    readonly turns: number;
    readonly spawns: number;
    readonly tokens: number;
  };
}

/** 모든 필드는 활성 가지(현재 leaf에서 parentId를 따라 올라간 사슬) 위 이벤트만으로 계산한다 */
export interface ExtThreadSnapshot {
  readonly enabled: readonly string[];
  /** 마지막 scope.changed가 disabled인 scope. 기본 켜짐 scope를 끈 뒤 다시 열어도 끈 상태를 되살리는 데 쓴다 */
  readonly disabled: readonly string[];
  /** scope마다 활성 가지 위 scope.changed 개수(enabled와 disabled 합). 재시작 뒤 커밋 키 구분에 쓴다 */
  readonly scopeTransitions: Readonly<Record<string, number>>;
  /** 켜진 scope마다 마지막 scope.changed{status:"enabled"}의 seq. 켜진 scope만 키를 갖는다 */
  readonly enabledAtSeq: Readonly<Record<string, number>>;
  readonly states: readonly StoredScopeState[];
  /** lease.acquired 뒤 lease.released가 없는 임대. 최대 1개 */
  readonly openLease: OpenLease | null;
  /** scope마다 활성 가지 위 lease.acquired 개수 */
  readonly leaseEpochs: Readonly<Record<string, number>>;
}

export type ExtRecordSubjectType = "thread" | "turn" | "step" | "item" | "task" | "external";

export interface ExtRecordQuery {
  /** 확장 kind 또는 접두 "<접두>.*". X가 readsRecordKinds로 거른 뒤의 값 */
  readonly kind: ExtensionEventKind | `${string}.*`;
  readonly subject?: { readonly type: ExtRecordSubjectType; readonly id: string };
  readonly limit?: number;
}

export interface ExtRecordRow {
  readonly groupId: string;
  readonly kind: ExtensionEventKind;
  readonly version: number;
  readonly subject: { readonly type: ExtRecordSubjectType; readonly id: string };
  readonly payload: JsonValue;
}

export interface RecordCommitPort {
  /** SessionService.commit 한 트랜잭션. 확장 투영(x_<name>_*)도 같은 트랜잭션에서 갱신된다 */
  commit(request: ExtCommitRequest): Promise<ExtCommitResult>;
  /**
   * 활성 가지 기준 스냅샷. 버려진 가지의 이벤트는 보지 않는다. 읽기 연결의 busy, io와 손상 행(row_invalid)은
   * 예상 가능한 실패라 던지지 않고 값으로 돌려준다
   */
  loadThread(threadId: ThreadId): Promise<Result<ExtThreadSnapshot, ReadFailure>>;
  /**
   * 그룹 레코드 조회. reader는 조회하는 확장의 이름(ExtensionName)이다.
   * private 행은 reader가 그 행의 소유 확장일 때만 돌려준다
   */
  queryRecords(
    threadId: ThreadId,
    query: ExtRecordQuery,
    reader: string,
  ): Promise<Result<readonly ExtRecordRow[], ReadFailure>>;
}

/**
 * 보관 정리(L1.persistence.spec §6.1, PS-18). 조립 루트가 엔진을 열 때 한 번 `prune()`을 부른다.
 * 기간(`retention.maxAgeDays`)과 수(`retention.maxCount`) 상한이 모두 0이면 아무것도 지우지 않는다
 */
export interface SessionRetention {
  /** 지금 설정으로 지워질 thread. 지우지 않는다(설정 화면의 삭제 대상 수 미리보기) */
  preview(): Result<readonly ThreadId[], ReadFailure>;
  /** 지울 thread를 지우고 지운 목록을 돌려준다 */
  prune(): Result<readonly ThreadId[], StoreError>;
}

export interface SessionService {
  // ── 쓰기
  /** M1 커밋 경로(동기) */
  commit(request: CommitRequest): Result<CommitResult, StoreError>;
  /** 플러그인 setup 중 한 번만 받는다. 같은 producer를 두 번 받으면 Bug("store.producer_claimed") */
  producer(id: ProducerId): ProducerHandle;

  // ── 투영
  readonly projectors: ProjectorRegistry;
  readonly query: ProjectionQuery;

  // ── 읽기와 구독. afterSeq는 배타 경계(그 seq보다 큰 것)다
  // 스트림은 읽기 실패를 마지막 원소(err)로 알리고 끝난다. 호출자는 원소의 ok를 보고 멈춘다
  readFrom(
    afterSeq: number,
    options?: { readonly threadId?: ThreadId; readonly limit?: number },
  ): AsyncIterable<Result<DurableEventEnvelope, ReadFailure>>;
  /** leaf(생략하면 현재 leaf)에서 parentId를 따라 올라가 루트→leaf 순서로 */
  readBranch(
    threadId: ThreadId,
    leaf?: EventId,
  ): AsyncIterable<Result<DurableEventEnvelope, ReadFailure>>;
  loadCheckpoint(threadId: ThreadId): Promise<Result<StepCheckpoint | null, ReadFailure>>;
  /** afterSeq 이후 내구 이벤트를 커밋 순서로. 따라잡기와 실시간을 같은 동기 구간에서 잇는다 */
  subscribe(
    afterSeq: number,
    listener: CommitListener,
    filter?: FeedFilter,
  ): Result<Unsubscribe, ReadFailure>;
  /** 호스트 재전송용 동기 읽기 */
  readonly feed: EventFeed;
  /** detached 필드를 blob에서 되돌린 사본 */
  hydrate(event: DurableEventEnvelope): Promise<DurableEventEnvelope>;
  /** 휘발 이벤트 전달. 저장하지 않는다. n·afterSeq는 발신자가 채운다(F.records.spec §4.3) */
  emitVolatile(event: VolatileEventEnvelope): void;

  // ── 열기, 소유, 재개
  openForWrite(threadId: ThreadId, token: LeaseToken): Result<OpenReport, OpenError>;
  openForRead(threadId: ThreadId): Result<OpenReport, OpenError>;
  /** 열 때 복구. 합성 결과를 커밋하고 남은 일을 계획으로 돌려준다. 실행은 하지 않는다 */
  recover(threadId: ThreadId, deps: RecoverDeps): Result<ResumePlan, StoreError>;
  /** 실제로 이어서 실행할 때 부른다. thread.resumed를 커밋하고 resume_attempts를 올린다 */
  beginResume(
    threadId: ThreadId,
    mode: "manual" | "auto",
  ): Result<{ readonly attempt: number }, ResumeError>;
  release(threadId: ThreadId, reason: SessionShutdownReason): Promise<void>;

  // ── 수명주기와 분기
  readonly threads: ThreadLifecycle;

  // ── 세션 범위 설정
  readonly sessionSettings: SessionSettingsStore;

  /** X 포트. commit 이름이 위 commit과 겹쳐 하위 객체로 둔다. PortKey.member = "ext" */
  readonly ext: RecordCommitPort;

  /** 보관 정리. core-persistence의 `RetentionApi`가 이 모양을 채운다 */
  readonly retention: SessionRetention;
}
