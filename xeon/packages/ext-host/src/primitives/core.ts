// primitives 내부 공유 타입과 호스트 핵심 상태. 패키지 밖으로 내보내지 않는다.
import type { CapabilityId } from "@fresnel/contracts/capabilities";
import type {
  IdFactory,
  JsonValue,
  ThreadId,
  TurnId,
  StepId,
  EventId,
} from "@fresnel/contracts/conversation";
import type {
  DriveLimits,
  ExtensionManifest,
  ExtensionName,
  HookName,
  PluginEntry,
  PluginSetView,
  PostItem,
  PortLookup,
  RecordKind,
  RegistrationApi,
  RegistrationDef,
  RegistrationId,
  RegistrationSetup,
  RegistrationStatus,
  StepResult,
  TrustRequest,
} from "@fresnel/contracts/extensions";
import type {
  DurableEventDraft,
  LeaseReleasedPayload,
  ScopeChangedPayload,
} from "@fresnel/contracts/records";
import type { CordisBridge, FiberHandle, OpenedFiber } from "./cordis-bridge.ts";
import type { StateMigration } from "./state-migration.ts";
import type { Dispatcher } from "./dispatch.ts";
import type { AnyState, DriveCall, ErasedDriveOptions } from "./erased-types.ts";
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
  /**
   * x.primitives.driveRequiresGroup(기본 true). 참이면 플러그인 그룹의 구성원이 아닌 플러그인은 drive를 등록하지 못한다
   * (`drive_requires_group`). 등록 시점(setup)에 읽으므로 Registration을 다시 켜거나 `ext.reload`할 때 바뀐 값이 적용된다
   */
  driveRequiresGroup(): boolean;
  /** x.primitives.capabilityProviders */
  capabilityProviders(): Readonly<Record<string, ExtensionName>>;
  /**
   * x.primitives.driveMaxDepth [결정: 2026-11-17 사용자]. 주도권 스택의 깊이 상한(코어 위 프레임 수). 넘는 맡기기는 `depth_limit`으로 거부한다.
   * 맡기기(`handoff`)가 새 프레임 깊이의 상한으로 쓴다. 없으면 `DEFAULT_DRIVE_MAX_DEPTH`
   */
  driveMaxDepth(threadId: ThreadId): number;
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
  /** turn_settled만: 이 turn이 사용자 중단(abort 코드 `user`)으로 끝났다 */
  readonly userInterrupted?: true;
}

// ── scope와 세대 ───────────────────────────────────────────────────────────

/** setup 동안 실제로 한 등록(validateUsage 입력) */
export interface UsageRecorder {
  readonly on: Set<HookName>;
  post: boolean;
  drive: boolean;
  readonly capabilities: Set<CapabilityId>;
  readonly recordKinds: Set<RecordKind>;
  readonly readsRecordKinds: Set<string>;
}

export interface Generation {
  readonly scopeId: RegistrationId;
  readonly number: number;
  readonly abort: AbortController;
  /** setup 실행 중 */
  setupPhase: boolean;
  /** 핸들러가 디스패치 스냅샷에 들어가는 상태 */
  open: boolean;
  /** 닫힘. 이 세대의 g로 부르는 등록 함수는 registration_inactive다 */
  closed: boolean;
  opened: OpenedFiber | null;
  fiber: FiberHandle | null;
  readonly usage: UsageRecorder;
  drive: { readonly fn: DriveCall; readonly options: ErasedDriveOptions } | null;
  readonly disposers: (() => void | Promise<void>)[];
  api: RegistrationApi<AnyState> | null;
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

interface RegistrationLastError {
  readonly code: PrimitiveErrorCode;
  readonly message: string;
}

export type RegistrationToggleReason = NonNullable<ScopeChangedPayload["reason"]>;

/** thread 하나의 켜기·끄기 요청. 없으면 RegistrationRecord.desired(전체 기본값)를 따른다(P-28) */
interface ThreadWant {
  readonly enabled: boolean;
  readonly reason: RegistrationToggleReason | undefined;
}

/** 단위 교체(`ExtHost.replaceUnit`)가 바꾸는 Registration의 정의 부분 */
export interface RegistrationDefinition {
  manifest: ExtensionManifest;
  plugin: PluginEntry;
  loadIndex: number;
  builtin: boolean;
  /** 로더가 정한 유효 등급(설치 위치와 요청의 낮은 쪽). 대체 주장의 출처 표시에 쓴다. 요청 값을 그대로 쓰지 않는다 */
  trust: TrustRequest["level"];
  def: RegistrationDef<AnyState>;
  setup: RegistrationSetup<AnyState>;
}

export interface RegistrationRecord extends RegistrationDefinition {
  readonly id: RegistrationId;
  readonly extension: ExtensionName;
  // 정의 필드는 `replaceUnit`이 경계에서만 바꾼다
  /** 마지막 켜기·끄기 요청 */
  desired: boolean;
  reason: RegistrationToggleReason | undefined;
  status: RegistrationStatus;
  generationCount: number;
  generation: Generation | null;
  lastError: RegistrationLastError | undefined;
  waiting: readonly CapabilityId[];
  /** drive 함수가 던져 오류 표시가 된 scope. 끄고 켜기 전까지 후보가 아니다 */
  driveError: boolean;
  /** setup을 실행하는 중이다. 같은 scope의 setup이 겹치지 않게 한다 */
  busy: boolean;
}

// ── 주도권 스택과 시작 요청 ───────────────────────────────────────────────

export type ReleaseReason = LeaseReleasedPayload["reason"];

/**
 * 주도권 스택의 프레임 하나(drive-isolation.md 2.1). `ThreadRuntime.frames`의 0번이 맨 아래 플러그인 프레임이고 마지막이 맨 위다.
 * 맨 위 프레임만 단계 함수를 부른다. 아래 프레임은 `waiting`으로 기록만 남는다
 */
export interface LeaseRuntime {
  /** 부여마다 새로 발급한다. 펜싱(`lease_revoked`)과 `lease:<leaseId>:released` 커밋 키의 재료라 재사용하지 않는다 */
  readonly leaseId: string;
  /** 기본 키 계통. 부여마다 `leaseId`와 같은 값으로 새로 연다. 재시작 뒤에는 기록의 값을 그대로 쓴다 */
  readonly lineageId: string;
  readonly scopeId: RegistrationId;
  readonly threadId: ThreadId;
  readonly leaseEpoch: number;
  readonly limits: DriveLimits;
  /** 이 프레임이 쓴 양. 위 프레임이 쓴 양도 더한다(charge). 복원할 때는 위 프레임들의 own 합으로 다시 센다 */
  readonly used: { turns: number; spawns: number; tokens: number };
  /** active: 사용 가능. releasing: 반납 예정(다음 경계에서 커밋). released: 커밋됨 */
  status: "active" | "releasing" | "released";
  reason: ReleaseReason | undefined;
  readonly abort: AbortController;
  /** 맡긴 쪽 프레임의 leaseId(`lease.acquired.parent`). 사용자 명령이나 프로필 시작으로 쌓인 프레임은 null */
  readonly parent: string | null;
  /** 스택 인덱스(`lease.acquired.depth`). 코어 위 첫 프레임이 0이다. 옛 기록은 0으로 읽는다 */
  readonly depth: number;
  /** 그 프레임을 낸 플러그인의 versionId(`lease.acquired.contentHash`). 기록에 없으면 null */
  readonly contentHash: string | null;
  /** driving: 주도 중(맨 위). waiting: 맡긴 위 프레임을 기다리는 중이다. 기다리는 프레임은 단계 함수를 부르지 않는다 */
  state: "driving" | "waiting";
  /** 질문 대기 중이다. 임대는 반납하지 않으므로 상태만 바뀐다(drive-isolation.md 2.1) */
  asking: boolean;
  /** 명령 입력. 사용자 명령의 `input`이고, 맡기기에서는 맡긴 쪽이 준 입력이다. 기록에 없어 복원하면 null이다 */
  readonly input: JsonValue | null;
  /** 다음 호출의 첫 `last`. 위 프레임이 반납되면 이 프레임의 맡긴 결과가 여기 놓인다 */
  pendingLast: StepResult | null;
  /** 맡긴 쪽 플러그인 이름(`handoff`). 사용자 명령이나 프로필 시작이면 null */
  readonly calledBy: string | null;
  /** 단계 함수가 `done`으로 낸 결과. 반납이 정해질 때 채운다 */
  result: JsonValue | null;
  /** 첫 호출이 남았다(부여 직후, 재개 직후) */
  wantInvoke: boolean;
  idleStreak: number;
  idleRev: number | null;
  /** 직전 호출 시작 때의 상태 판 */
  lastBaseRev: number | null;
  running: boolean;
  /** 실행 중에 호출 조건(turn_settled·idle)이 지나갔다 */
  missed: boolean;
  /** 첫 단계가 끝났다. 그 전에 온 사용자 메시지는 `inbox`에서 기다렸다가 첫 단계 뒤에 전달한다: 시작 주도의 첫 단계가 항상 먼저다(drive-isolation.md 2.4) */
  firstStepDone: boolean;
  /** 지금까지 단계 함수에 전달한 사용자 메시지 수. 사용자 메시지 turn의 기본 요청 id 재료다(같은 판의 둘째 메시지가 첫 turn의 id를 재사용하지 않게) */
  userSeq: number;
  /** 사용자가 보낸 메시지 중 아직 단계 함수에 `last`로 전달하지 못한 것(2.4). 앞에서부터 하나씩 전달한다 */
  readonly inbox: PostItem[];
  /** 전달한 사용자 메시지 하나를 단계 함수가 처리했는지 센다. 전달한 뒤 처리 없이 지난 단계 수. 전달 중이 아니면 null */
  userSteps: number | null;
  /** 전달 중인 사용자 메시지. 단계 함수가 3단계 안에 처리하지 않으면 코어 루프로 돌려보낸다 */
  deliveredUser: PostItem | null;
  /** lease.acquired가 커밋되었는가 */
  committed: boolean;
}

/**
 * 주도 시작 요청 하나(drive-isolation.md 2.2). 큐 맨 앞부터 부여를 본다. 요청은 `lease.acquired`가 커밋된 뒤에 큐에서 지운다
 * (커밋이 실패하면 다음 경계가 다시 시도한다)
 */
interface HeldUserMessage {
  readonly item: PostItem;
  /** 코어 루프로 돌려보낼 때의 요청 id. 보류한 때 정해 재시도와 겹치지 않는다 */
  readonly requestId: string;
  readonly scopeId: RegistrationId;
}

export interface StartRequest {
  /** 기록(`lease.requested`)의 요청 id. 프로필 시작은 열 때 다시 만들어 기록하지 않으므로 null */
  readonly requestId: string | null;
  readonly scopeId: RegistrationId;
  readonly trigger: "user" | "profile" | "handoff";
  readonly input: JsonValue | null;
  readonly parentLeaseId: string | null;
  /** 기록(`lease.requested`)이 끝났다. 끝나기 전에는 부여하지 않는다. 기록하지 않는 요청은 처음부터 참 */
  recorded: boolean;
}

/** `ExtHost.startDrive`의 거부. 예상 가능한 실패라 값으로 돌려준다 */
export type StartDriveError =
  | { readonly kind: "unknown_thread" }
  | { readonly kind: "unknown_scope" }
  | { readonly kind: "child_thread" }
  | { readonly kind: "not_drive" }
  | { readonly kind: "drive_error" }
  /** 입력이 기록에 실릴 수 있는 크기(`DRIVE_INPUT_MAX_BYTES`)를 넘는다 */
  | { readonly kind: "input_too_large" };

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
  readonly opening: RegistrationRecord[];
  /** settle에서 이 thread의 켜짐 집합에 더할 scope. opening을 포함한다 */
  readonly activating: RegistrationRecord[];
  /** prepare에서 이 thread의 켜짐 집합에서 뺀 scope. 커밋이 실패하면 되돌린다 */
  readonly deactivating: RegistrationRecord[];
  /** prepare에서 세대를 닫고 settle에서 정리할 scope */
  readonly closing: RegistrationRecord[];
  /** 이 커밋이 반영되면 기록된 켜짐 집합에 더하거나 뺄 scope */
  readonly recordEnabled: RegistrationId[];
  readonly recordDisabled: RegistrationId[];
  /** 이 커밋에서 반납이 기록될 프레임(맨 위부터) */
  readonly releasing: LeaseRuntime[];
  /** 이 커밋에서 부여가 기록될 프레임. 맨 위에 더한다 */
  grant: LeaseRuntime | null;
  /** `grant`를 만든 시작 요청. 커밋이 성공하면 큐에서 지운다 */
  startRequest: StartRequest | null;
  /**
   * 대상을 쓸 수 없어 버릴 맡기기 요청. 커밋이 성공하면 큐에서 지우고 맡긴 프레임을 `aborted`로 이어 준다.
   * 커밋이 실패하면 아무것도 바뀌지 않아 다음 경계가 다시 판단한다
   */
  abandoning: StartRequest | null;
  /** 이 커밋에 `lease.requested`(queued) 초안을 함께 싣는 요청. 커밋이 성공하면 `recorded`를 참으로 한다 */
  readonly recording: StartRequest[];
}

/** `ExtHost.openThread`의 선택 인자 */
export interface ThreadOpenOptions {
  /** 서브에이전트 자식 대화면 참. 이 thread는 drive 임대를 받지 않는다 */
  readonly child?: boolean;
  /** Test run 대화면 참(ThreadSummary.testRun). Test run만 단계 경계 멈춤을 받는다(X-19, X.primitives.spec §4.4.8) */
  readonly testRun?: boolean;
  /**
   * 프로필의 시작 설정(drive-isolation.md 2.2). 열 때 열린 임대가 없으면 이 scope의 profile 시작 요청을 큐에 넣는다.
   * 열린 임대가 있으면(재시작) 아무것도 하지 않고 복원된 스택을 잇는다
   */
  readonly startDrive?: RegistrationId;
}

export interface ThreadRuntime {
  readonly threadId: ThreadId;
  /** closeThread에서 abort. drive의 loop.turn에 넘기는 thread 취소 신호 */
  readonly abort: AbortController;
  /** 서브에이전트 자식 대화다. 확장은 켜지만 drive 임대는 받지 않는다(L1.agents 자식은 위임 주체가 구동한다) */
  readonly child: boolean;
  states: Map<RegistrationId, StateCacheEntry>;
  /** 저장소에 기록된 켜짐 집합(활성 가지 기준). scope.changed 초안은 이 집합과 active의 차이로 만든다 */
  recordedEnabled: Set<RegistrationId>;
  /** 이 thread에서 핸들러가 디스패치되는 scope. 세대가 열려 있고 이 thread가 켜 둔 scope다(P-28) */
  active: Set<RegistrationId>;
  /** thread별 켜기·끄기 요청 */
  want: Map<RegistrationId, ThreadWant>;
  /** 상태 문서가 맞지 않아 이 thread에서 켜지 못한 scope. 이 thread가 다시 토글하기 전까지 다시 시도하지 않는다 */
  refused: Set<RegistrationId>;
  /** scope별 활성 가지 위 scope.changed 수(열 때 스냅샷에서 시작해 커밋마다 오른다). 커밋 키를 전이마다 구분한다 */
  flips: Map<RegistrationId, number>;
  /** 켜진 scope의 마지막 scope.changed{enabled} seq */
  enabledAtSeq: Map<RegistrationId, number>;
  leaseEpochs: Map<RegistrationId, number>;
  /** 주도권 스택. 0번이 맨 아래 플러그인 프레임, 마지막이 맨 위(주도 중인 프레임). 비면 아무도 주도하지 않는다 */
  frames: LeaseRuntime[];
  /** 주도 시작 요청 큐(사용자 명령, 프로필 시작, 맡기기). 맨 앞부터 부여를 본다 */
  startQueue: StartRequest[];
  /**
   * 시작 요청이 큐에 있고 스택이 비어 있는 동안 온 사용자 메시지. 요청이 프레임이 되면 그 프레임의 `inbox`로 넘어가고(첫 단계 뒤에 `last`로 간다),
   * 요청이 프레임 없이 사라지면 코어 루프로 돌려보낸다(drive-isolation.md 2.4). 메시지의 행선지가 부여 시각에 갈리지 않게 한다
   */
  heldUser: HeldUserMessage[];
  /** 사용자가 턴을 중지했다. 사용자의 다음 명령이 정착(turn_settled)할 때까지 프로필·맡기기 시작을 막는다 */
  userStopped: boolean;
  txn: BoundaryTxn | null;
  /** 마지막으로 `profile.applied`로 알린 대화별 켜짐 집합(E(T), M5c §4.1.5). 처음이면 null이고 첫 경계가 `open`으로 남긴다 */
  appliedPlugins: PluginSetView | null;
  /**
   * 등록마다 E(T)에 맞춰 마지막으로 요청한 값. 여는 때와 경계마다 이 값과 E(T)가 다른 등록만 요청한다.
   * 엔진이 끈 등록(`disable()`, 자동 끄기, 안전 모드)은 이 값을 바꾸지 않으므로 E(T)가 바뀌기 전까지 꺼진 채 둔다
   */
  pluginReconciled: WeakMap<RegistrationRecord, boolean>;
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

/** 맨 위 프레임(주도 중이거나 다음 호출을 기다리는 프레임). 스택이 비었으면 null */
export function topFrame(thread: ThreadRuntime): LeaseRuntime | null {
  return thread.frames.at(-1) ?? null;
}

// ── 호스트 핵심 ────────────────────────────────────────────────────────────

export interface InstalledUnit {
  readonly name: ExtensionName;
  manifest: ExtensionManifest;
  loadIndex: number;
  readonly builtin: boolean;
  /** 단위 교체는 신뢰 등급을 바꾸지 못하므로(loading-trust 재읽기 3단계) 설치 때 정한 값이 끝까지 간다 */
  readonly trust: TrustRequest["level"];
  readonly scopeIds: RegistrationId[];
}

export interface HostCore {
  readonly deps: ResolvedDeps;
  readonly bridge: CordisBridge;
  readonly registry: HandlerRegistry;
  readonly dispatcher: Dispatcher;
  readonly ports: PortLookup;
  readonly scopes: Map<RegistrationId, RegistrationRecord>;
  readonly threads: Map<ThreadId, ThreadRuntime>;
  readonly units: Map<ExtensionName, InstalledUnit>;
  /**
   * 기다리지 않는 작업을 추적한다. 거부는 진단으로 보고한다.
   * abandoned가 참이면 whenSettled가 기다리지 않는다(시간 예산을 넘겨 버려진 setup의 뒤처리처럼 끝나지 않을 수 있는 작업)
   */
  track(task: Promise<unknown>, options?: { readonly abandoned?: boolean }): void;
  /** 추적 중인 작업, 기능 바인딩, Cordis 상태 전이가 모두 끝나기를 기다린다 */
  whenSettled(): Promise<void>;
  /** 기능 바인딩 변경이 끝나기를 기다린다 */
  flushBindings(): Promise<void>;
  /** thread에서 scope의 핸들러가 디스패치되는가. 열지 않은 thread(M0 시험)는 세대가 열려 있으면 참이다 */
  activeIn(threadId: ThreadId, scopeId: RegistrationId): boolean;
  /** 변경 구독자에게 알린다(ExtHost.onChange). 구독자의 예외는 기록하고 넘어간다 */
  notify(change: ExtChange): void;
}

/** ExtHost.onChange가 알리는 변경(group-sdk 요청 3) */
export interface ExtChange {
  /** scope: 토글 요청·적용·오류 표시가 바뀜. lease: 임대 부여·반납이 커밋됨 */
  readonly kind: "scope" | "lease";
  readonly scopeId: RegistrationId;
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
