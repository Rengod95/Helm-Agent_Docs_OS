// primitives 내부 공유 타입과 호스트 핵심 상태. 패키지 밖으로 내보내지 않는다.
import type { CapabilityId } from "@xeon/contracts/capabilities";
import type { IdFactory, ThreadId, TurnId, StepId, EventId } from "@xeon/contracts/conversation";
import type {
  DriveLimits,
  DriveOptions,
  ExtensionManifest,
  ExtensionName,
  PointName,
  PortLookup,
  RecordKind,
  ScopeApi,
  ScopeDef,
  ScopeId,
  ScopeSetup,
  ScopeStatus,
} from "@xeon/contracts/extensions";
import type {
  DurableEventDraft,
  LeaseReleasedPayload,
  ScopeChangedPayload,
} from "@xeon/contracts/records";
import type { CordisBridge, FiberHandle, OpenedFiber } from "./cordis-bridge.ts";
import type { StateMigration } from "./state-migration.ts";
import type { Dispatcher } from "./dispatch.ts";
import type { AnyState, DriveCall } from "./erased-types.ts";
import type { DispatchPolicy } from "./dispatch-types.ts";
import type { ExtDiagnostic, PrimitiveErrorCode } from "./errors.ts";
import type { HandlerRegistry } from "./registry.ts";

// ── 설정 읽기 (X.primitives.spec §3.2) ────────────────────────────────────

export interface PrimitivesSettingsSource {
  /**
   * x.primitives.driveDefaultLimits. 상한을 명시하지 않은 임대의 일반 기본값. 두 상한 키는 session 범위도 받으므로
   * 임대를 받는 thread로 읽는다(review.decisions-2 U-12). 사용자가 일부 필드만 적었으면 빠진 필드는 내장 기본값으로 채워 돌려준다
   */
  driveDefaultLimits(threadId: ThreadId): DriveLimits;
  /** x.primitives.driveLimits. 어떤 임대도 넘지 못하는 천장. thread의 session 범위 값까지 합친 실효 값 */
  driveLimits(threadId: ThreadId): DriveLimits;
  /** x.primitives.activeDriveGroup */
  activeDriveGroup(threadId: ThreadId): ScopeId | null;
  /** x.primitives.capabilityProviders */
  capabilityProviders(): Readonly<Record<string, ExtensionName>>;
  /**
   * x.primitives.leaseWaitLimit [제안]. 임대를 받지 못한 후보가 `turn_settled`·`idle` 경계를 이만큼 넘기면 요청을 거부한다
   * (review.m3-design-inputs D-M3-05 a). 없으면 `DEFAULT_LEASE_WAIT_LIMIT`
   */
  leaseWaitLimit?(threadId: ThreadId): number;
}

/** 이미 기본값이 채워진 호스트 의존 */
export interface ResolvedDeps {
  readonly ids: IdFactory;
  readonly now: () => number;
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  readonly policy: DispatchPolicy;
  readonly settings: PrimitivesSettingsSource;
  readonly report: (diagnostic: ExtDiagnostic) => void;
  readonly strict: boolean;
  readonly setupBudgetMs: () => number | null;
}

// ── 경계 신호 (X.primitives.spec §3.5) ────────────────────────────────────

export interface BoundarySignal {
  readonly threadId: ThreadId;
  /** step_end: 단계 경계(turn_end 처리 뒤). turn_settled: turn 정착 완료. idle: 유휴 진입 */
  readonly kind: "step_end" | "turn_settled" | "idle";
  readonly turnId?: TurnId;
  readonly stepId?: StepId;
  /** 이 경계를 만든 turn이 drive 임대의 loop.turn으로 시작됐으면 그 임대 id */
  readonly drivenBy?: string;
}

// ── scope와 세대 ───────────────────────────────────────────────────────────

/** setup 동안 실제로 한 등록(validateUsage 입력) */
export interface UsageRecorder {
  readonly on: Set<PointName>;
  post: boolean;
  drive: boolean;
  readonly capabilities: Set<CapabilityId>;
  readonly recordKinds: Set<RecordKind>;
  readonly readsRecordKinds: Set<string>;
}

export interface Generation {
  readonly scopeId: ScopeId;
  readonly number: number;
  readonly abort: AbortController;
  /** setup 실행 중 */
  setupPhase: boolean;
  /** 핸들러가 디스패치 스냅샷에 들어가는 상태 */
  open: boolean;
  /** 닫힘. 이 세대의 g로 부르는 등록 함수는 scope_inactive다 */
  closed: boolean;
  opened: OpenedFiber | null;
  fiber: FiberHandle | null;
  readonly usage: UsageRecorder;
  drive: { readonly fn: DriveCall; readonly options: DriveOptions } | null;
  readonly disposers: (() => void | Promise<void>)[];
  api: ScopeApi<AnyState> | null;
  /** 상태 마이그레이션 훅(`hostOf(g).migrateState`). setup 안에서 한 번만 등록한다 */
  migration: StateMigration | null;
  /**
   * 공급자 재시작으로 Cordis가 apply를 다시 불렀다(N-02, 결정 D8). setup은 바로 다시 실행하지 않고 이 표시만 남긴다.
   * 다음 단계 경계(유휴면 곧바로 이어지는 유휴 적용)에서 새 세대로 다시 만든다
   */
  stale: boolean;
  /** 어느 thread도 쓰지 않아 닫기로 정해졌고 커밋을 기다린다. 이 동안 다른 thread는 이 세대를 켜지 않는다 */
  closing: boolean;
}

interface ScopeLastError {
  readonly code: PrimitiveErrorCode;
  readonly message: string;
}

export type ScopeToggleReason = NonNullable<ScopeChangedPayload["reason"]>;

/** thread 하나의 켜기·끄기 요청. 없으면 ScopeRecord.desired(전체 기본값)를 따른다(P-28) */
interface ThreadWant {
  readonly enabled: boolean;
  readonly reason: ScopeToggleReason | undefined;
}

export interface ScopeRecord {
  readonly id: ScopeId;
  readonly extension: ExtensionName;
  readonly manifest: ExtensionManifest;
  readonly loadIndex: number;
  readonly builtin: boolean;
  readonly def: ScopeDef<AnyState>;
  readonly setup: ScopeSetup<AnyState>;
  /** 마지막 켜기·끄기 요청 */
  desired: boolean;
  reason: ScopeToggleReason | undefined;
  status: ScopeStatus;
  generationCount: number;
  generation: Generation | null;
  lastError: ScopeLastError | undefined;
  waiting: readonly CapabilityId[];
  /** drive 함수가 던져 오류 표시가 된 scope. 끄고 켜기 전까지 후보가 아니다 */
  driveError: boolean;
  /** setup을 실행하는 중이다. 같은 scope의 setup이 겹치지 않게 한다 */
  busy: boolean;
}

// ── 임대 ───────────────────────────────────────────────────────────────────

export type ReleaseReason = LeaseReleasedPayload["reason"];

export interface LeaseRuntime {
  readonly leaseId: string;
  readonly scopeId: ScopeId;
  readonly threadId: ThreadId;
  readonly leaseEpoch: number;
  readonly limits: DriveLimits;
  readonly used: { turns: number; spawns: number; tokens: number };
  /** active: 사용 가능. releasing: 반납 예정(다음 경계에서 커밋). released: 커밋됨 */
  status: "active" | "releasing" | "released";
  reason: ReleaseReason | undefined;
  readonly abort: AbortController;
  idleStreak: number;
  idleRev: number | null;
  /** 직전 호출 시작 때의 상태 판 */
  lastBaseRev: number | null;
  running: boolean;
  /** 첫 호출이 남았다(부여 직후, 재개 직후) */
  wantInvoke: boolean;
  /** 실행 중에 호출 조건(turn_settled·idle)이 지나갔다 */
  missed: boolean;
  /** 경계 없이 상태 커밋만 하고 반환해 바로 다시 부른 연속 횟수. 경계가 오면 0으로 돌아간다 */
  chained: number;
  /** lease.acquired가 커밋되었는가 */
  committed: boolean;
}

// ── thread별 런타임 ────────────────────────────────────────────────────────

export interface StateCacheEntry {
  readonly eventId: EventId | null;
  readonly rev: number;
  readonly version: number;
  readonly doc: unknown;
}

export interface BoundaryTxn {
  readonly signal: BoundarySignal;
  readonly drafts: DurableEventDraft[];
  /** setup을 마치고 settle에서 세대를 열 scope */
  readonly opening: ScopeRecord[];
  /** settle에서 이 thread의 켜짐 집합에 더할 scope. opening을 포함한다 */
  readonly activating: ScopeRecord[];
  /** prepare에서 이 thread의 켜짐 집합에서 뺀 scope. 커밋이 실패하면 되돌린다 */
  readonly deactivating: ScopeRecord[];
  /** prepare에서 세대를 닫고 settle에서 정리할 scope */
  readonly closing: ScopeRecord[];
  /** 이 커밋이 반영되면 기록된 켜짐 집합에 더하거나 뺄 scope */
  readonly recordEnabled: ScopeId[];
  readonly recordDisabled: ScopeId[];
  /** 이 커밋에서 반납이 기록될 임대 */
  readonly releasing: LeaseRuntime[];
  /** 이 커밋에서 부여가 기록될 임대 */
  grant: LeaseRuntime | null;
  /** 이 커밋에서 `lease.rejected`로 기록될 임대 요청(M3-REQ-28) */
  readonly rejected: LeaseRejection[];
  /** 이 경계가 대기 계수를 올린 scope. 커밋이 실패하면 되돌린다 */
  readonly waited: ScopeId[];
}

/** 대기 상한을 넘겨 거부된 임대 요청 하나 */
interface LeaseRejection {
  readonly scopeId: ScopeId;
  readonly requestSeq: number;
  /** 거부 때 임대를 가진 scope와 그 임대 차수. 둘 다 커밋된 값이라 thread를 다시 열어도 같은 거부에 같은 값이다(커밋 키 재료) */
  readonly holder: ScopeId | null;
  readonly holderEpoch: number;
}

export interface ThreadRuntime {
  readonly threadId: ThreadId;
  /** closeThread에서 abort. drive의 loop.turn에 넘기는 thread 취소 신호 */
  readonly abort: AbortController;
  states: Map<ScopeId, StateCacheEntry>;
  /** 저장소에 기록된 켜짐 집합(활성 가지 기준). scope.changed 초안은 이 집합과 active의 차이로 만든다 */
  recordedEnabled: Set<ScopeId>;
  /** 이 thread에서 핸들러가 디스패치되는 scope. 세대가 열려 있고 이 thread가 켜 둔 scope다(P-28) */
  active: Set<ScopeId>;
  /** thread별 켜기·끄기 요청 */
  want: Map<ScopeId, ThreadWant>;
  /** 상태 문서가 맞지 않아 이 thread에서 켜지 못한 scope. 이 thread가 다시 토글하기 전까지 다시 시도하지 않는다 */
  refused: Set<ScopeId>;
  /** scope별 활성 가지 위 scope.changed 수(열 때 스냅샷에서 시작해 커밋마다 오른다). 커밋 키를 전이마다 구분한다 */
  flips: Map<ScopeId, number>;
  /** 켜진 scope의 마지막 scope.changed{enabled} seq. 임대 후보의 enabledAtSeq가 된다 */
  enabledAtSeq: Map<ScopeId, number>;
  leaseEpochs: Map<ScopeId, number>;
  lease: LeaseRuntime | null;
  /** 임대를 받지 못하고 기다리는 후보. requestSeq는 대기를 시작한 순번, waited는 넘긴 `turn_settled`·`idle` 경계 수 */
  leaseWait: Map<ScopeId, { readonly requestSeq: number; waited: number }>;
  /** 대기 상한을 넘겨 거부된 scope. 다음 임대 반납이 커밋되면 다시 후보가 된다 */
  leaseRejected: Set<ScopeId>;
  /** 다음 임대 요청 순번 */
  nextRequestSeq: number;
  /** 임대를 반납한 scope가 다음 turn_settled 또는 상태 판 변화 전까지 후보에서 빠지는 표(반납 때의 판) */
  cooldown: Map<ScopeId, number>;
  txn: BoundaryTxn | null;
  /** 같은 thread에서 포트 부재 경고를 한 번만 내는 표시 */
  warnedPorts: Set<string>;
  /** 유휴 적용이 진행 중이다 */
  applying: boolean;
  /** 진행 중에 적용 요청이 또 들어왔다 */
  applyAgain: boolean;
  /** 진행 중인 유휴 적용(prepare, 커밋, settle 전체). 다른 경계의 prepare는 이것이 끝나기를 기다린다 */
  idleApply: Promise<void> | null;
  /** 경계 txn이 정산되기 전이라 유휴 적용을 시작하지 못했다. 그 txn이 정산되면 다시 요청한다 */
  applyDeferred: boolean;
}

// ── 호스트 핵심 ────────────────────────────────────────────────────────────

export interface InstalledUnit {
  readonly name: ExtensionName;
  readonly manifest: ExtensionManifest;
  readonly loadIndex: number;
  readonly builtin: boolean;
  readonly scopeIds: ScopeId[];
}

export interface HostCore {
  readonly deps: ResolvedDeps;
  readonly bridge: CordisBridge;
  readonly registry: HandlerRegistry;
  readonly dispatcher: Dispatcher;
  readonly ports: PortLookup;
  readonly scopes: Map<ScopeId, ScopeRecord>;
  readonly threads: Map<ThreadId, ThreadRuntime>;
  readonly units: Map<ExtensionName, InstalledUnit>;
  /**
   * 기다리지 않는 작업을 추적한다. 거부는 진단으로 보고한다.
   * abandoned가 참이면 whenSettled가 기다리지 않는다(시간 예산을 넘겨 버려진 setup의 뒤처리처럼 끝나지 않을 수 있는 작업)
   */
  track(task: Promise<unknown>, options?: { readonly abandoned?: boolean }): void;
  /** 추적 중인 작업, 능력 바인딩, Cordis 상태 전이가 모두 끝나기를 기다린다 */
  whenSettled(): Promise<void>;
  /** 능력 바인딩 변경이 끝나기를 기다린다 */
  flushBindings(): Promise<void>;
  /** thread에서 scope의 핸들러가 디스패치되는가. 열지 않은 thread(M0 시험)는 세대가 열려 있으면 참이다 */
  activeIn(threadId: ThreadId, scopeId: ScopeId): boolean;
  /** 변경 구독자에게 알린다(ExtHost.onChange). 구독자의 예외는 기록하고 넘어간다 */
  notify(change: ExtChange): void;
}

/** ExtHost.onChange가 알리는 변경(group-kit 요청 3) */
export interface ExtChange {
  /** scope: 토글 요청·적용·오류 표시가 바뀜. lease: 임대 부여·반납이 커밋됨 */
  readonly kind: "scope" | "lease";
  readonly scopeId: ScopeId;
  /** thread 단위 변경이면 그 thread, 전체 변경이면 null */
  readonly threadId: ThreadId | null;
}

export function newUsage(): UsageRecorder {
  return {
    on: new Set(),
    post: false,
    drive: false,
    capabilities: new Set(),
    recordKinds: new Set(),
    readsRecordKinds: new Set(),
  };
}
