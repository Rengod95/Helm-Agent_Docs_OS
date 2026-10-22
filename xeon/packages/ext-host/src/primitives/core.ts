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
import type { Dispatcher } from "./dispatch.ts";
import type { AnyState, DriveCall } from "./erased-types.ts";
import type { DispatchPolicy } from "./dispatch-types.ts";
import type { ExtDiagnostic, PrimitiveErrorCode } from "./errors.ts";
import type { HandlerRegistry } from "./registry.ts";

// ── 설정 읽기 (X.primitives.spec §3.2) ────────────────────────────────────

export interface PrimitivesSettingsSource {
  /** x.primitives.driveDefaultLimits. 상한을 명시하지 않은 임대의 일반 기본값 */
  driveDefaultLimits(): DriveLimits;
  /** x.primitives.driveLimits. 어떤 임대도 넘지 못하는 천장 */
  driveLimits(): DriveLimits;
  /** x.primitives.activeDriveGroup */
  activeDriveGroup(threadId: ThreadId): ScopeId | null;
  /** x.primitives.capabilityProviders */
  capabilityProviders(): Readonly<Record<string, ExtensionName>>;
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
}

interface ScopeLastError {
  readonly code: PrimitiveErrorCode;
  readonly message: string;
}

export type ScopeToggleReason = NonNullable<ScopeChangedPayload["reason"]>;

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
  /** prepare에서 세대를 닫고 settle에서 정리할 scope */
  readonly closing: ScopeRecord[];
  /** 이 커밋이 반영되면 기록된 켜짐 집합에 더하거나 뺄 scope */
  readonly recordEnabled: ScopeId[];
  readonly recordDisabled: ScopeId[];
  /** 이 커밋에서 반납이 기록될 임대 */
  readonly releasing: LeaseRuntime[];
  /** 이 커밋에서 부여가 기록될 임대 */
  grant: LeaseRuntime | null;
}

export interface ThreadRuntime {
  readonly threadId: ThreadId;
  /** closeThread에서 abort. drive의 loop.turn에 넘기는 thread 취소 신호 */
  readonly abort: AbortController;
  states: Map<ScopeId, StateCacheEntry>;
  recordedEnabled: Set<ScopeId>;
  leaseEpochs: Map<ScopeId, number>;
  lease: LeaseRuntime | null;
  /** 임대를 반납한 scope가 다음 turn_settled 또는 상태 판 변화 전까지 후보에서 빠지는 표(반납 때의 판) */
  cooldown: Map<ScopeId, number>;
  txn: BoundaryTxn | null;
  /** 같은 thread에서 포트 부재 경고를 한 번만 내는 표시 */
  warnedPorts: Set<string>;
  /** 유휴 적용이 진행 중이다 */
  applying: boolean;
  /** 진행 중에 적용 요청이 또 들어왔다 */
  applyAgain: boolean;
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
