import type { Clock, Result, Scheduler } from "@xeon/contracts";
import type { AnyCapabilityDef, SecretMeta, SecretName } from "@xeon/contracts/capabilities";
import type { IdFactory, ItemId, ThreadId, TurnId } from "@xeon/contracts/conversation";
import type {
  DurableEventEnvelope,
  LeaseToken,
  LifecycleError,
  ReadFailure,
  StoreError,
  StoreFailureKind,
  VolatileEventEnvelope,
} from "@xeon/contracts/records";
import type {
  AgentDefinition,
  CompactOutcome,
  ContextError,
  HostedSearchPort,
  LoopError,
  ResumeResult,
  SecretAdminService,
  ShutdownCoordinator,
  ShutdownReason,
} from "@xeon/contracts/services";
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
import type { DnsResolver, HttpTransport } from "@xeon/cap-web";
import type {
  ScheduleClock,
  ScheduleService,
  ScheduleStore,
  ScheduleTicker,
  SchedulePolicy,
} from "@xeon/cap-schedule";
import type { ModelsExtensionOptions } from "@xeon/core-models";
import type { SecretsRuntime, SecretsRuntimeDeps } from "@xeon/platform-secrets";
import type { BuiltinExtensionModule } from "@xeon/ext-host";
import type { BinaryCheckReport } from "@xeon/platform-os";
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
   * 확장이 공급하는 능력의 정의. 내장 L2 정의 표에 더해 능력 래퍼에 넘긴다(X.primitives.spec §4.4.7).
   * 정의에 `idempotent`·`readOnly`가 없는 메서드는 on 핸들러와 drive 함수에서 거부된다
   */
  readonly extraCapabilityDefs?: readonly AnyCapabilityDef[];
  /**
   * 테스트 주입: pi-ai 모델 모음을 만드는 함수(모델 테이프 provider를 더한 것). 운영은 생략하고 그러면 pi-ai 내장 provider를 쓴다.
   * `extraPlugins`로는 모델 서비스를 바꿀 수 없다: core-models가 먼저 올라 xeon.models를 이미 냈기 때문이다(L4.host-service.plan §7).
   */
  readonly buildModels?: ModelsExtensionOptions["buildModels"];
  /**
   * 서브에이전트 정의(`agent` 도구가 이름으로 부른다). 정의 파일 탐색(사용자·프로젝트 디렉터리)은 L1.agents 2차라 M2에는 이 경로뿐이다.
   * 앱이나 시험이 정의를 넘긴다
   */
  readonly agentDefinitions?: readonly AgentDefinition[];
  /**
   * 테스트 주입: 웹 능력의 DNS 해석기와 HTTP 전송. 운영은 생략한다(시스템 해석기와 guarded-fetch 전송).
   * 루프백은 정책이 항상 거부하므로 시험이 공개 주소로 풀리는 이름과 가짜 전송을 넣는다
   */
  readonly webPorts?: {
    readonly resolver?: DnsResolver;
    readonly transport?: HttpTransport;
    /** 모델 provider의 hosted 검색 대역(내장 검색 래퍼). 생략하면 `xeon.models`의 포트를 쓴다 */
    readonly hostedSearch?: HostedSearchPort;
  };
  /**
   * 테스트 주입: 비밀 서비스(와 관리 서비스)를 만드는 함수. 운영은 생략하고 그러면 sops 제공자를 가진 `createSecretsRuntime`을 쓴다.
   * 시험은 `memorySecrets`(`@xeon/platform-secrets/testing`)를 돌려줘 sops와 age 키 없이 `secretEnv` 호출의 승인 증거를 끝에서 끝까지 본다.
   * 받은 deps의 시계, 스케줄러, id 발급은 엔진의 것이다
   */
  readonly secretsRuntime?: (deps: SecretsRuntimeDeps) => SecretsRuntime;
  /** 기본 true. false면 기본 플러그인(Helm) 설치와 외부 확장 적재를 건너뛴다 */
  readonly defaultGroups?: boolean;
  /**
   * 안전 모드. 참이면 L3 내장 그룹(학습)을 싣지 않는다 [결정: review.m3-design-inputs D-M3-07 a, X.operations.spec §4.6.2]. 대기열은 남고
   * 다시 켜면 그대로 보인다. L1·L2 내장 패키지는 그대로 싣는다. 기본 false
   */
  readonly safeMode?: boolean;
  /**
   * 대기 예약 수의 출처. 생략하면 예약 서비스(`EnginePorts.schedule`)가 낸다(L4.host-service.spec §4.17). 넣으면 그 값이 이긴다.
   * 시험이 값을 넣어 유휴 판정을 확인한다
   */
  readonly pendingSchedules?: PendingSchedulesPort;
  /**
   * 예약 서비스의 시험 주입(L4.host-service.spec §4.17). 운영은 생략한다. 시계와 틱, 저장소, 정책을 바꾼다.
   * 서비스 모드에서만 틱이 돈다(in-process·stdio는 임대가 없어 틱을 돌리지 않는다, HS-40)
   */
  readonly schedule?: ScheduleOverrides;
  /**
   * 기본 플러그인 번들 뿌리(`<뿌리>/<이름>/.xeon-plugin/plugin.json`). 생략하면 실행 파일 옆 `default-plugins/`다.
   * 개발 실행과 시험이 번들 위치를 바꿀 때 쓴다
   */
  readonly defaultPluginsDir?: string;
  /** 조립 루트가 import할 수 없는 앱의 설정(예: l4.cli.*, L4.cli.spec §6) */
  readonly settingGroups?: readonly SettingGroup<
    SettingNamespace,
    Readonly<Record<string, SettingDefInput>>
  >[];
  /**
   * 종료 협조 시한(`l0.process.shutdown.timeoutMs`)을 넘겼을 때 프로세스를 끝내는 함수. 기본은 `process.exit`.
   * 시험은 프로세스를 끝내지 않는 대역을 넣는다
   */
  readonly exit?: (code: number) => never;
  /** 결과 스키마 검사, in-process JSON 왕복. 개발 빌드만 true */
  readonly devChecks?: boolean;
  /** 테스트 주입(eng.testing.guide TS-03) */
  readonly clock?: Clock;
  readonly ids?: IdFactory;
  /**
   * 지금 어떤 연결이든 연 thread. 확장 핸들러 실패 알림(`scope.handler_failed`)은 이 thread마다 한 번씩 나간다(L4.host-service HS-80).
   * 연결 허브는 엔진을 만든 뒤에 생기므로 호스트 실행 루틴(`startHost`)이 늦게 읽는 함수를 넘긴다. 생략하면 열린 thread가 없어 운영 로그만 남는다
   */
  readonly openThreads?: () => readonly ThreadId[];
}

export type AssembleIssue =
  | { readonly code: "catalog"; readonly issues: readonly CatalogIssue[] }
  /**
   * 저장소를 열지 못했다. `failure`는 안내 분류(`F.records.spec` §3.7 7항)이고 `message`는 CLI가 구별하는 이름이다:
   * `fts5Missing`, `dataDirPermission`, 그 밖은 분류에 맞춰 `storeFutureVersion`, `storeCorrupt`, `storeMigrationFailed`, `storeUnavailable`
   */
  | { readonly code: "store"; readonly message: string; readonly failure: StoreFailureKind }
  | { readonly code: "missingService"; readonly service: string }
  /** 내장 플러그인(또는 extraPlugins) 하나의 설치가 실패했다. spec이 정한 세 code에 더한 값이다(deviation) */
  | { readonly code: "plugin"; readonly plugin: string; readonly message: string };

/**
 * 종료 협조(L0.process.spec §4.2). 참여자는 확장과 L0 서비스, 호스트 자신이다. `request`는 참여자를 등록 역순으로
 * `l0.process.shutdown.timeoutMs` 안에서 기다리고, 시한을 넘기면 기다리지 않고 `AssembleOptions.exit(1)`을 부른다.
 */
interface EngineShutdown extends ShutdownCoordinator {
  request(
    reason: ShutdownReason,
  ): Promise<{ readonly completed: boolean; readonly elapsedMs: number }>;
}

/** 진단 함수의 결과. 값은 사용자 환경 문제를 알리는 데 쓴다(코드를 고칠 대상이 아니다) */
export interface EngineDiagnostics {
  /** 외부 바이너리 필수/선택 점검(L0.os.spec §3.6.1). 점검이 중단되면 `cancelled`다 */
  readonly binaries: Result<BinaryCheckReport, { readonly kind: "cancelled" }>;
}

/** 예약 서비스 시험 주입. 모든 항목이 선택이다 */
export interface ScheduleOverrides {
  readonly clock?: ScheduleClock;
  readonly ticker?: ScheduleTicker;
  readonly store?: ScheduleStore;
  readonly policy?: Partial<SchedulePolicy>;
}

/** 대기 예약 수. 값이 바뀌면 `onChange`로 알린다(유휴 종료 판정이 다시 계산한다) */
export interface PendingSchedulesPort {
  count(): number;
  onChange(listener: () => void): Unsubscribe;
}

export interface Engine {
  readonly mode: HostMode;
  /** 안전 모드로 열렸는가(`AssembleOptions.safeMode`). host.status.safeMode의 원천 */
  readonly safeMode: boolean;
  readonly storeId: StoreId;
  readonly catalog: SettingCatalog;
  /** ms. host.status.startedAt의 원천 */
  readonly startedAt: number;
  readonly ports: EnginePorts;
  /** 종료 협조 창구. stdio·서비스 호스트가 EOF, 신호, `host.shutdown`에서 요청한다(HS-31) */
  readonly shutdown: EngineShutdown;
  /**
   * 첫 실행 점검과 `doctor`가 부르는 진단 함수(`F.wire-settings.spec` §3.3의 `host.diagnose` 반려 판정: 진단은 `@xeon/host`의 함수를 직접 부른다).
   * 외부 바이너리 점검은 자식 프로세스를 띄우므로 엔진을 열 때가 아니라 이 호출에서 한다
   */
  diagnose(signal: AbortSignal): Promise<EngineDiagnostics>;
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
  /** L1.tasks, L1.tools, L2.schedule. 활동 집계는 예약 서비스의 대기·루프 수를 더한다 */
  readonly activity: ActivityPort;
  /** L2.schedule 예약 서비스(M3b). 서비스 모드에서만 `start`로 틱을 돌린다. 실행은 이 서비스의 실행 포트가 한다 */
  readonly schedule: ScheduleService;
  /** L0.os */
  readonly notify: UserNotifyPort;
  /** L0.os */
  readonly log: HostLogPort;
  /** L0.secrets 관리 서비스와 wire 밖 값 전달 통로 */
  readonly secrets: SecretsPort;
  /** L1.models 카탈로그 조회. 설정 쓰기가 모델 id를 검사한다(HS-78 [결정: M2 Mac 실기]) */
  readonly models: ModelCatalogPort;
  /** L2.dialog 슬래시 명령 */
  readonly commands: CommandPort;
  /** L2.web provider 상태와 웹 설정 값(`web.providers`, M3-REQ-96). 읽기 전용 */
  readonly web: WebPort;
  /** L2.dialog 상태줄 스냅숏과 첨부 추가(`status.list`, `attachments.add`, M3-REQ-16) */
  readonly dialog: DialogWirePort;
  /** 지식 제안 대기열 둘(학습 그룹, L2.knowledge)을 한 목록으로 보이고 결정한다(M3-REQ-18, D-M3-32 a) */
  readonly proposals: ProposalPort;
  /** X.loading-trust 프로젝트 신뢰. 클라이언트가 묻고 정한다(`trust.get`·`trust.decide`) */
  readonly trust: TrustPort;
  /** 새 id 발급(traceId, 연결 id). 엔진의 IdFactory다 */
  readonly ids: IdFactory;
  /** 엔진의 시계. 송신 큐 같은 호스트 자신의 시각에 쓴다 */
  readonly clock: Clock;
  /** 호스트 자신의 타이머(관찰 폴링, HS-16). L0.os의 스케줄러이고 시험은 수동 스케줄러를 넣는다 */
  readonly scheduler: Scheduler;
}

/** `thread.read`가 결과를 만들지 못한 이유. 처리기가 와이어 오류로 옮긴다(F wire §3.4.6 3항) */
export type ThreadReadFailure =
  | ReadFailure
  | Extract<StoreError, { readonly kind: "thread_not_found" }>
  | { readonly kind: "invalid_target"; readonly reason: "item_not_found" | "not_on_branch" };

/**
 * 수동 컴팩션(`thread.compact`, HS-77)이 요약을 끝내지 못한 이유. 처리기가 와이어 오류로 옮긴다(F wire §3.5.2).
 * 확장이 막은 경우는 실패가 아니라 `CompactOutcome`의 `cancelled`로 돌아온다
 */
export type ThreadCompactFailure =
  | ReadFailure
  | Extract<StoreError, { readonly kind: "thread_not_found" }>
  /** 종결된 thread에는 쓰기를 하지 않는다 */
  | { readonly kind: "thread_closed"; readonly threadId: ThreadId }
  /** 열린 turn이 있다. 컴팩션은 turn 사이에서만 한다 */
  | { readonly kind: "turn_running"; readonly turnId: TurnId }
  /** 요약에 쓸 현재 모델(역할 `main`)을 해석하지 못했다. 값은 `ModelError.kind`다 */
  | { readonly kind: "model_unavailable"; readonly detail: string }
  /** 컨텍스트 서비스가 읽기, 투영, 요약, 커밋 가운데 하나를 마치지 못했다 */
  | { readonly kind: "context_failed"; readonly error: ContextError };

export interface ThreadPort {
  create(input: {
    readonly workspace?: string;
    readonly title?: string;
  }): Promise<{ readonly threadId: ThreadId; readonly position: StreamPosition }>;
  /** 읽기 연결의 busy·io, 손상 행은 오류 값이다. 처리기가 store.* 와이어 오류로 옮긴다 */
  exists(threadId: ThreadId): Result<boolean, ReadFailure>;
  list(params: WireParams<"thread.list">): Promise<WireResult<"thread.list">>;
  /** 새 thread를 만든다. 쓰기 소유는 얻지 않는다(처리기가 `SessionLockPort`로 얻는다). 실패는 수명 주기 오류 값이다 */
  fork(
    threadId: ThreadId,
    at: ItemId | undefined,
  ): Promise<
    Result<{ readonly threadId: ThreadId; readonly position: StreamPosition }, LifecycleError>
  >;
  /** 쓰기 소유자만. 열린 turn이 있으면 `turn_running`이다 */
  revert(
    threadId: ThreadId,
    to: ItemId,
  ): Promise<Result<{ readonly position: StreamPosition }, LifecycleError>>;
  /** 쓰기 소유자만. 제목을 바꾸고(`thread.updated { title }` 커밋) 그 이벤트를 반영한 위치를 돌려준다. 호출마다 새 요청 키를 만든다 */
  rename(
    threadId: ThreadId,
    title: string,
  ): Result<{ readonly position: StreamPosition }, LifecycleError | ReadFailure>;
  /** 제목이 이미 있는가. 첫 입력 자동 제목이 사람이 정한 제목을 덮지 않게 한다. 모르는 thread는 없는 것(false)이다 */
  hasTitle(threadId: ThreadId): Result<boolean, ReadFailure>;
  /** 쓰기 소유자만. 지운 뒤 이 프로세스가 쥔 그 thread의 임대와 확장 상태를 거둔다 */
  remove(threadId: ThreadId): Promise<Result<void, LifecycleError>>;
  /**
   * 현재 가지의 내구 item을 오래된 것부터 `limit`개 읽는다(F wire §3.4.6). `position`은 item을 읽은 같은 동기 구간에서 잰 저장소 head다.
   * 프레임 한도를 넘지 않게 오래된 쪽을 잘라 적게 돌려줄 수 있고 그때도 `hasMore`는 정확하다
   */
  read(
    params: WireParams<"thread.read">,
  ): Promise<Result<WireResult<"thread.read">, ThreadReadFailure>>;
  position(threadId: ThreadId): Result<StreamPosition, ReadFailure>;
  /**
   * 대화를 지금 요약한다(`/compact`, 이유 `manual`). 쓰기 소유는 호출자가 이미 쥐었다고 본다. 열린 turn이 있으면 `turn_running`이다.
   * 요약 모델은 컨텍스트 서비스가 `summary` 역할로 고르고, 여기서는 컴팩션 뒤 재주입에 쓰는 현재 모델(역할 `main`)의 바인딩과 창 크기를 넘긴다.
   * 결과 `compacted`의 커밋 위치는 호출자가 `position`으로 읽는다
   */
  compact(
    threadId: ThreadId,
    instructions: string | undefined,
    signal: AbortSignal,
  ): Promise<Result<CompactOutcome, ThreadCompactFailure>>;
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
  /**
   * 열린 turn을 재개한다(자동 재개는 하지 않는다, L1.loop.spec §4.6). 재시작 뒤 승인 대기 turn은 재개해야 응답을 받아 이어진다.
   * wire 메서드 `turn.resume`이 사용자 확인 뒤 부르고, 서비스 모드의 자동 재개(M3)도 쓴다
   */
  resume(threadId: ThreadId): Promise<Result<ResumeResult, LoopError>>;
  /** 진행 중 turn을 다음 안전 경계에서 멈추고 체크포인트를 커밋한다. 시한 안에 끝나면 true */
  stopAtSafeBoundary(deadlineMs: number): Promise<boolean>;
  /** 그 thread에 진행 중인 turn이 있는가. 서비스 모드의 잠금 해제 판정(HS-27)이 쓴다 */
  isLive(threadId: ThreadId): boolean;
}

/** 슬래시 명령 질의·실행이 실패한 이유. 처리기가 와이어 오류로 옮긴다(F wire §3.3.1 command.*) */
export type CommandFailure =
  /** 명령 서비스(`dialog.commands`)를 가진 확장이 올라와 있지 않다 */
  | { readonly kind: "unavailable" }
  /** 명령 서비스가 입력을 거절했다. `code`는 능력 오류 코드(`command_args_invalid`, `command_shell_disabled`, `denied` 등) */
  | { readonly kind: "rejected"; readonly code: string; readonly message: string };

/**
 * 엔진에 등록한 슬래시 명령(L2.dialog `dialog.commands`)을 클라이언트가 읽고 실행한다(G1-01). 명령은 호스트가 호출한 것(호출자 `host`)으로
 * 돌고 사람이 입력 자리에 있다(대화형). 실행은 thread 문맥에서 한다
 */
export interface CommandPort {
  /** 이름 앞부분(`prefix`)으로 거른 명령 목록. `threadId`가 있으면 프로젝트 명령은 그 thread의 작업 폴더 기준이고 없으면 엔진의 기본 작업 폴더 기준이다(HS-72) */
  list(
    params: WireParams<"command.list">,
    signal: AbortSignal,
  ): Promise<Result<WireResult<"command.list">, CommandFailure>>;
  /** 한 줄을 실행한다. 호출마다 새 요청 키를 만들어 넘긴다(같은 줄을 다시 보내면 다시 실행된다) */
  run(
    threadId: ThreadId,
    params: Omit<WireParams<"command.run">, "threadId">,
    signal: AbortSignal,
  ): Promise<Result<WireResult<"command.run">, CommandFailure>>;
}

/** 상태줄 스냅숏과 첨부 추가가 실패한 이유. 처리기가 와이어 오류로 옮긴다(F wire §3.3.1 status.list, attachments.add) */
export type DialogWireFailure =
  /** 상태줄 서비스(`dialog.status`)나 첨부 서비스(`dialog.attachments`)를 가진 확장이 올라와 있지 않다 */
  | { readonly kind: "unavailable" }
  /** 능력이 입력을 거절했다. `code`는 능력 오류 코드(`attachment_too_large`, `not_found` 등)다 */
  | { readonly kind: "rejected"; readonly code: string; readonly message: string };

/**
 * 상태줄 세그먼트 스냅숏과 첨부 추가(M3-REQ-16, M3-20). 명령과 같이 호스트가 사람의 입력으로 부르고(호출자 `host`) thread가 있으면 그
 * 문맥을 싣는다. 첨부 원천의 상대 경로를 thread의 작업 폴더 기준으로 풀지는 능력이 정한다(L4.host-service.spec §10 미결)
 */
export interface DialogWirePort {
  /** thread의 상태줄 세그먼트 전체. 목록만 읽으므로 쓰기 소유를 얻지 않는다 */
  statusList(
    threadId: ThreadId,
    signal: AbortSignal,
  ): Promise<Result<WireResult<"status.list">, DialogWireFailure>>;
  /** 첨부 하나를 검사하고 저장해 입력 파트를 만든다. `threadId`가 있으면 그 thread 문맥으로 부른다 */
  attachmentsAdd(
    params: WireParams<"attachments.add">,
    signal: AbortSignal,
  ): Promise<Result<WireResult<"attachments.add">, DialogWireFailure>>;
}

/**
 * 웹 provider 상태와 웹 설정 값(`web.providers`, F wire-settings, M3-REQ-96). 읽기 전용이고 비밀 값을 싣지 않는다. cap-web이 올라와 있지 않으면
 * provider 목록은 비고 설정 값은 설정 층에서 읽는다(assembly/web-providers.ts)
 */
export interface WebPort {
  providers(signal: AbortSignal): Promise<WireResult<"web.providers">>;
}

/**
 * 지식 제안 대기열 `proposal.list`·`proposal.decide`(F wire §3.3.1, M3-REQ-18). 대기열은 둘이다: 학습 그룹(`source: "learning"`)과 L2.knowledge의
 * 쓰기 승인 대기열(`source: "knowledge"`). 한 출처를 읽지 못하면(그룹이 꺼짐, 안전 모드, 지식 저장소 없음) 그 출처만 `unavailable`에 올리고
 * 나머지는 돌려준다. 결정은 출처가 정한 오류를 wire의 결정 실패 이유로 옮긴 값이다(오류 값이고 던지지 않는다)
 */
export interface ProposalPort {
  list(
    params: WireParams<"proposal.list">,
    signal: AbortSignal,
  ): Promise<WireResult<"proposal.list">>;
  decide(
    params: WireParams<"proposal.decide">,
    signal: AbortSignal,
  ): Promise<WireResult<"proposal.decide">>;
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
  /** 쥔 잠금을 놓는다(`session.shutdown` 발화, 임대 반납). 쥐고 있지 않으면 아무 일도 하지 않는다 */
  release(threadId: ThreadId): Promise<void>;
}

/** 설정 쓰기가 실패한 이유. 처리기가 와이어 오류로 옮긴다(F wire §3.5.2 settings.*, store.*) */
export type SettingsWriteFailure =
  /** session·project·local 범위인데 `threadId`가 없다 */
  | { readonly kind: "thread_required"; readonly scope: SettingScope }
  | Extract<StoreError, { readonly kind: "thread_not_found" }>
  /** session 범위는 이 프로세스가 쓰기 소유를 쥔 thread에만 쓴다 */
  | { readonly kind: "not_owner"; readonly threadId: ThreadId }
  /** project·local 범위는 thread의 작업 폴더가 있어야 한다 */
  | { readonly kind: "workspace_required"; readonly scope: SettingScope }
  /** project·local 파일은 신뢰한 프로젝트에만 쓴다 */
  | { readonly kind: "untrusted_project"; readonly workspace: string }
  /** managed 범위는 사용자 앱이 쓰지 않는 읽기 전용 파일이다 */
  | { readonly kind: "managed_read_only" }
  /** 기존 파일이 JSON 객체가 아니다. 덮어쓰면 값을 잃으므로 쓰지 않는다 */
  | { readonly kind: "file_invalid"; readonly path: string }
  | { readonly kind: "file_unwritable"; readonly path: string; readonly code: string }
  /** session 범위 쓰기 키가 다른 값으로 재사용되었다. 키를 호출마다 새로 만들므로 일어나지 않는 방어 경로다 */
  | { readonly kind: "key_reused"; readonly requestKey: string }
  | StoreError;

/**
 * 설정이 바뀌었다는 신호. wire 알림 `settings.invalidated`의 원천이다(F wire §3.3.2). 값이 없다.
 * `keys`가 비면 어느 키인지 모르는 변경(신뢰 결정으로 project·local 층을 통째로 다시 읽음)이고, `threadId`는 `session` 범위일 때만 있다
 */
export interface SettingsChange {
  readonly keys: readonly SettingKey[];
  readonly scopes: readonly SettingScope[];
  readonly threadId: ThreadId | null;
}

export interface SettingsStorePort {
  layers(threadId: ThreadId | undefined): ScopeStack;
  /**
   * thread의 작업 폴더가 신뢰되었으면 그 폴더의 project·local 설정 파일을 읽어 `layers`가 쓰도록 한다. `layers`가 동기라서
   * 신뢰 판정(비동기)은 thread를 여는 곳에서 먼저 한다. 한 번 읽은 파일은 이 프로세스가 쓸 때까지 다시 읽지 않는다
   */
  prepare(threadId: ThreadId): Promise<void>;
  /** 값 검사(`checkSettingWrite`)는 호출자가 마쳤다. 파일 범위는 원자 교체로, session 범위는 `settings.changed` 커밋으로 쓴다 */
  write(
    scope: SettingScope,
    key: SettingKey,
    value: unknown,
    threadId: ThreadId | undefined,
  ): Promise<Result<void, SettingsWriteFailure>>;
  reset(
    scope: SettingScope,
    key: SettingKey,
    threadId: ThreadId | undefined,
  ): Promise<Result<void, SettingsWriteFailure>>;
  onChange(listener: (change: SettingsChange) => void): Unsubscribe;
}

/** `approval.list`가 목록을 만들지 못한 이유 */
export type ApprovalListFailure =
  | ReadFailure
  | Extract<StoreError, { readonly kind: "thread_not_found" }>;

export interface ApprovalPort {
  /**
   * 승인 요청이 기록된 표면 thread. 이 프로세스의 대기 목록에 없으면 쥔 thread마다 미해결 요청을 저장소에서 되살린(restore) 뒤 다시 찾고,
   * 그래도 없으면 저장소의 미해결 요청을 훑는다. 어디에도 없으면 undefined다
   */
  locate(approvalId: string): Promise<Result<ThreadId | undefined, ReadFailure>>;
  respond(params: WireParams<"approval.respond">): Promise<WireResult<"approval.respond">>;
  /** thread의 미해결 요청과 그 시점의 위치(F wire §3.4.6 5항). 이 프로세스가 쥐지 않은 thread도 읽는다 */
  list(threadId: ThreadId): Promise<Result<WireResult<"approval.list">, ApprovalListFailure>>;
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
  /**
   * 사용자 범위 `l1.models.providers`에 연결된 비밀에 모델 provider 사용 하나를 허용으로 더한다(HS-45 [결정: M2 Mac 실기]).
   * `settings.set`이 그 키를 쓴 뒤 부른다. 비밀이 아직 없으면 건너뛰고(만들 때 `newMeta`가 더한다) 실패는 경고로만 남긴다
   */
  linkModelProviders(): Promise<void>;
}

/** 모델 카탈로그 조회(L1.models `list`). 허용·차단 목록을 적용한 결과다 */
interface ModelCatalogPort {
  /** `provider`에 등록된 모델 id들 */
  modelIds(provider: string): readonly string[];
}

/** 신뢰 질의·결정이 실패한 이유. 처리기가 와이어 오류로 옮긴다(F wire §3.3.1 trust.*) */
export type TrustPortFailure =
  /** `workspace`가 절대 경로가 아니다 */
  | { readonly kind: "workspace_not_absolute" }
  /** `choice`가 질의 결과의 선택지에 없다 */
  | { readonly kind: "invalid_choice" }
  /** 저장 파일이 손상되었거나 쓰지 못했다(잠금을 얻지 못한 것 포함). 기존 결정은 그대로다 */
  | { readonly kind: "store_failed"; readonly reason: "corrupt" | "io" };

/**
 * 프로젝트 신뢰 질의와 결정(HS-58). 엔진은 프롬프트를 띄우지 않으므로 결정이 없는 폴더는 불신(`undecided`)이고,
 * 클라이언트가 폴더에서 thread를 열기 전에 묻고 사람의 결정을 `decide`로 보낸다.
 */
export interface TrustPort {
  /** 판정과 선택지. 아무것도 바꾸지 않는다 */
  get(
    workspace: string,
    signal: AbortSignal,
  ): Promise<Result<WireResult<"trust.get">, TrustPortFailure>>;
  /**
   * 결정을 저장하고(또는 세션에만 두고) 반영한 뒤의 판정을 돌려준다. 그 폴더의 project·local 설정 파일 층을 다시 읽고
   * 설정 변경을 알린다(`settings.invalidated`)
   */
  decide(
    workspace: string,
    choice: WireParams<"trust.decide">["choice"],
    signal: AbortSignal,
  ): Promise<Result<WireResult<"trust.decide">, TrustPortFailure>>;
}

export interface HostLogPort {
  error(message: string, fields: Readonly<Record<string, unknown>>): void;
  info(message: string, fields: Readonly<Record<string, unknown>>): void;
}
