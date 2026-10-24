import type { Clock, Result } from "@xeon/contracts";
import type { SecretMeta, SecretName } from "@xeon/contracts/capabilities";
import type { IdFactory, ItemId, ThreadId, TurnId } from "@xeon/contracts/conversation";
import type {
  DurableEventEnvelope,
  LeaseToken,
  ReadFailure,
  VolatileEventEnvelope,
} from "@xeon/contracts/records";
import type { LoopError, SecretAdminService } from "@xeon/contracts/services";
import type {
  CatalogIssue,
  ScopeStack,
  SettingCatalog,
  SettingDefInput,
  SettingGroup,
  SettingKey,
  SettingNamespace,
  SettingScope,
} from "@xeon/contracts/settings";
import type {
  EventFilter,
  StoreId,
  StreamPosition,
  TurnStartInput,
  Unsubscribe,
  WireParams,
  WireResult,
} from "@xeon/contracts/wire";
import type { ModelsExtensionOptions } from "@xeon/core-models";
import type { BuiltinExtensionModule } from "@xeon/ext-host";
import type { SecretOfferStore } from "./secrets/offers.ts";

// L4.host-service.spec §3.3.1~§3.3.2. 처리기와 연결 허브는 이 파일의 타입(EnginePorts)만 쓰고 아래 층 패키지를 import하지 않는다
// (L4.host-service.plan §2). 포트 구현(어댑터)은 assemble.ts와 src/assembly/ 에 있다.

/** host.status.mode와 같은 값 집합: "in-process" | "stdio" | "service" */
export type HostMode = WireResult<"host.status">["mode"];

/** ext-host가 받는 플러그인 모듈. 이름 정본은 X.loading-trust.spec이다 [가정]. 내장 확장 모듈과 같은 모양이다 */
export type HostPluginModule = BuiltinExtensionModule;

export interface AssembleOptions {
  readonly mode: HostMode;
  /** 세션 DB가 있는 디렉터리. 없으면 L0.os의 기본 데이터 디렉터리 */
  readonly dataDir?: string;
  /** 테스트용 그룹, 모델 테이프 provider */
  readonly extraPlugins?: readonly HostPluginModule[];
  /**
   * 테스트 주입: pi-ai 모델 모음을 만드는 함수(모델 테이프 provider를 더한 것). 운영은 생략하고 그러면 pi-ai 내장 provider를 쓴다.
   * `extraPlugins`로는 모델 서비스를 바꿀 수 없다: core-models가 먼저 올라 xeon.models를 이미 냈기 때문이다(L4.host-service.plan §7).
   */
  readonly buildModels?: ModelsExtensionOptions["buildModels"];
  /** 기본 true. false면 Helm·학습 그룹을 싣지 않는다 */
  readonly defaultGroups?: boolean;
  /** 조립 루트가 import할 수 없는 앱의 설정(예: l4.cli.*, L4.cli.spec §6) */
  readonly settingGroups?: readonly SettingGroup<
    SettingNamespace,
    Readonly<Record<string, SettingDefInput>>
  >[];
  /** 결과 스키마 검사, in-process JSON 왕복. 개발 빌드만 true */
  readonly devChecks?: boolean;
  /** 테스트 주입(eng.testing.guide TS-03) */
  readonly clock?: Clock;
  readonly ids?: IdFactory;
}

export type AssembleIssue =
  | { readonly code: "catalog"; readonly issues: readonly CatalogIssue[] }
  | { readonly code: "store"; readonly message: string }
  | { readonly code: "missingService"; readonly service: string }
  /** 내장 플러그인(또는 extraPlugins) 하나의 설치가 실패했다. spec이 정한 세 code에 더한 값이다(deviation) */
  | { readonly code: "plugin"; readonly plugin: string; readonly message: string };

export interface Engine {
  readonly mode: HostMode;
  readonly storeId: StoreId;
  readonly catalog: SettingCatalog;
  /** ms. host.status.startedAt의 원천 */
  readonly startedAt: number;
  readonly ports: EnginePorts;
  /** task 결과를 쓰지 않는다(ADR-0006 §3.1) */
  close(): Promise<void>;
}

export interface EnginePorts {
  /** L1.persistence */
  readonly threads: ThreadPort;
  /** L1.tasks, L1.loop */
  readonly turns: TurnPort;
  /** L1.persistence(L0.store 읽기 API와 커밋 후 알림) */
  readonly feed: EventFeedPort;
  /** L0.store(sys_leases epoch 펜싱과 소유 표시) */
  readonly locks: SessionLockPort;
  /** 설정 파일 범위와 세션 범위 */
  readonly settings: SettingsStorePort;
  /** L1.tools */
  readonly approvals: ApprovalPort;
  /** L1.tasks, L1.tools, L2.schedule */
  readonly activity: ActivityPort;
  /** L0.os */
  readonly notify: UserNotifyPort;
  /** L0.os */
  readonly log: HostLogPort;
  /** L0.secrets 관리 서비스와 wire 밖 값 전달 통로 */
  readonly secrets: SecretsPort;
  /** 새 id 발급(traceId, 연결 id). 엔진의 IdFactory다 */
  readonly ids: IdFactory;
  /** 엔진의 시계. 송신 큐 같은 호스트 자신의 시각에 쓴다 */
  readonly clock: Clock;
}

export interface ThreadPort {
  create(input: {
    readonly workspace?: string;
    readonly title?: string;
  }): Promise<{ readonly threadId: ThreadId; readonly position: StreamPosition }>;
  /** 읽기 연결의 busy·io, 손상 행은 오류 값이다. 처리기가 store.* 와이어 오류로 옮긴다 */
  exists(threadId: ThreadId): Result<boolean, ReadFailure>;
  list(params: WireParams<"thread.list">): Promise<WireResult<"thread.list">>;
  fork(
    threadId: ThreadId,
    at: ItemId | undefined,
  ): Promise<{ readonly threadId: ThreadId; readonly position: StreamPosition }>;
  revert(threadId: ThreadId, to: ItemId): Promise<{ readonly position: StreamPosition }>;
  remove(threadId: ThreadId): Promise<void>;
  position(threadId: ThreadId): Result<StreamPosition, ReadFailure>;
}

export type SubmitOutcome =
  /** 같은 requestId 재제출이면 처음 turnId */
  | { readonly ok: true; readonly turnId: TurnId }
  | { readonly ok: false; readonly reason: "busy"; readonly turnId: TurnId }
  /** 루프가 입력을 받지 않았다(저장소 부족·읽기 전용, 소유 상실, 잘못된 입력 등 예상 가능한 실패). 와이어 오류로 옮기는 것은 처리기 몫이다 */
  | { readonly ok: false; readonly reason: "rejected"; readonly error: LoopError };

export interface TurnPort {
  submit(
    threadId: ThreadId,
    input: TurnStartInput,
    requestId: string | undefined,
  ): Promise<SubmitOutcome>;
  interrupt(threadId: ThreadId, turnId: TurnId | undefined): Promise<boolean>;
  /** 진행 중 turn을 다음 안전 경계에서 멈추고 체크포인트를 커밋한다. 시한 안에 끝나면 true */
  stopAtSafeBoundary(deadlineMs: number): Promise<boolean>;
}

export interface CommitBatch {
  /** (firstSeq - 1, lastSeq] 구간 */
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly events: readonly DurableEventEnvelope[];
}

export interface EventFeedPort {
  headSeq(): Result<number, ReadFailure>;
  oldestReplayableSeq(): number;
  /** seq > after AND seq ≤ upto, 필터 적용. 행이 limit만큼 차면 거기서 멈추고, 아니면 scanLimit 행까지 훑는다 */
  read(
    after: number,
    upto: number,
    filter: EventFilter | undefined,
    limit: number,
    scanLimit: number,
  ): Result<
    { readonly events: readonly DurableEventEnvelope[]; readonly scannedTo: number },
    ReadFailure
  >;
  /** 커밋 직후 같은 JS 턴에서 동기로 부른다(eng.transactions.design §7, TX-09) */
  onCommit(listener: (batch: CommitBatch) => void): Unsubscribe;
  onVolatile(listener: (event: VolatileEventEnvelope) => void): Unsubscribe;
}

/** L0.store LeaseKind = sys_leases.kind(표시용) */
export type OwnerKind = "cli" | "app" | "service";

export type LockOutcome =
  /** token은 L0.store LeaseToken(resource "session:<threadId>", holderId, epoch). L1.persistence 쓰기마다 대조한다 */
  | { readonly ok: true; readonly token: LeaseToken; release(): Promise<void> }
  /** sys_leases 행의 kind. 표시값이라 틀릴 수 있다 */
  | { readonly ok: false; readonly ownerKind: OwnerKind | null };

export interface SessionLockPort {
  tryAcquire(threadId: ThreadId, kind: OwnerKind): Promise<LockOutcome>;
  holds(threadId: ThreadId): boolean;
}

export interface SettingsStorePort {
  layers(threadId: ThreadId | undefined): ScopeStack;
  write(
    scope: SettingScope,
    key: SettingKey,
    value: unknown,
    threadId: ThreadId | undefined,
  ): Promise<void>;
  reset(scope: SettingScope, key: SettingKey, threadId: ThreadId | undefined): Promise<void>;
  onChange(listener: () => void): Unsubscribe;
}

export interface ApprovalPort {
  respond(params: WireParams<"approval.respond">): Promise<WireResult<"approval.respond">>;
}

export interface ActivitySnapshot {
  readonly liveTurns: number;
  /** liveTurns 포함, 백그라운드 task와 서브에이전트 포함 */
  readonly liveTasks: number;
  readonly waitingApprovals: number;
  readonly pendingSchedules: number;
}
export interface ActivityPort {
  snapshot(): ActivitySnapshot;
  onChange(listener: () => void): Unsubscribe;
}

export interface UserNotifyPort {
  show(input: {
    readonly title: string;
    readonly body: string;
    readonly threadId?: ThreadId;
  }): Promise<void>;
}

/**
 * `secret.*` 처리기가 쓰는 비밀 관리 포트(HOST.3). 관리 서비스(`xeon.secretAdmin`)는 사람 전용이라 L4 진입점인 이 포트에만 주고
 * 확장과 모델 도구에는 주지 않는다(L0.secrets.spec §3.8).
 */
export interface SecretsPort {
  readonly admin: SecretAdminService;
  /** CLI가 맡긴 값 입력·열람 수단. 처리기가 꺼내 쓰고, 맡기는 쪽은 `InProcessHost.secretOutOfBand`다 */
  readonly offers: SecretOfferStore;
  /**
   * `secret.beginEntry { action: "add" }`가 만들 비밀의 기본 메타. wire에 메타 필드가 없어 호스트가 설정에서 정한다.
   * 사용 정책은 비어 있어(사용 불가) `secret.meta`로 정책을 정하기 전에는 에이전트가 쓸 수 없다. 제공자 파일이 설정되지 않았으면 undefined.
   */
  newMeta(name: SecretName): SecretMeta | undefined;
}

export interface HostLogPort {
  error(message: string, fields: Readonly<Record<string, unknown>>): void;
  info(message: string, fields: Readonly<Record<string, unknown>>): void;
}
