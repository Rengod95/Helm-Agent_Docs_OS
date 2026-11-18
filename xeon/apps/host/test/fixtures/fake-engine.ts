import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok } from "@fresnel/contracts";
import type { MeasurePort } from "../../src/assembly/measure/read.ts";
import { createTurnRecordPort } from "../../src/assembly/measure/turn-read.ts";
import type { Notice } from "@fresnel/contracts/capabilities";
import type { IdFactory, ThreadId, TurnId, TurnInvoked } from "@fresnel/contracts/conversation";
import type {
  DurableEventEnvelope,
  EventKind,
  ReadFailure,
  VolatileEventEnvelope,
} from "@fresnel/contracts/records";
import type { TestRunControlPort, TraceReadPort } from "@fresnel/contracts/extensions";
import type { LoopError, ModelInfo } from "@fresnel/contracts/services";
import type { ScopeStack } from "@fresnel/contracts/settings";
import type { StoreId, StreamPosition, ThreadSummary } from "@fresnel/contracts/wire";
import type { FileLock } from "@fresnel/platform-os";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import type { ScheduleService } from "@fresnel/cap-schedule";
import { partial } from "./unsafe.ts";
import type { DevkitPort } from "../../src/handlers/m4/devkit.ts";
import type { PluginPort } from "../../src/handlers/m5/plugins.ts";
import type { OverlayPort } from "../../src/assembly/plugins/overlay.ts";
import type { MigrationSubmitPort } from "../../src/assembly/plugins/migration-submit.ts";
import type { MigrationPort } from "../../src/handlers/m5/migration.ts";
import type { PluginReviewPort } from "../../src/handlers/m5/plugin-review.ts";
import type { SandboxSelfTestPort } from "../../src/handlers/m4/sandbox-self-test.ts";
import type { DialogAreaPort } from "../../src/handlers/m4/dialog-area.ts";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { matchesFilter } from "../../src/handlers/events.ts";
import { threadLocked } from "../../src/handlers/owner.ts";
import { wireErrorOfStore } from "../../src/store-error.ts";
import type { M4HostEnv } from "../../src/assembly/m4/deps.ts";
import { createProfileTestRunPort } from "../../src/assembly/m4/profile-test-run-port.ts";
import type { PluginFact } from "../../src/assembly/m4/plugin-fact.ts";
import type { ReadText } from "../../src/assembly/m4/profile-cost.ts";
import { createExtReadPort, EMPTY_EXT_READ_SOURCES } from "../../src/assembly/m4/ext-read-port.ts";
import { createProjectPort } from "../../src/assembly/m4/project-port.ts";
import { createLocalIdFactory, systemRandom } from "@fresnel/platform-os";
import type { ExtUiVersionPort } from "../../src/handlers/m4/ext-ui-version.ts";
import type { ExtMethodPort } from "../../src/handlers/m4/ext-method.ts";
import { createFakeSecrets, NO_DISPLAY, type FakeSecrets } from "./fake-secrets.ts";
import { createProcessShutdown } from "@fresnel/platform-process";
import { createManualScheduler, type ManualScheduler } from "./manual-scheduler.ts";
import type {
  CommitBatch,
  Engine,
  EnginePorts,
  ApprovalPort,
  HostMode,
  LockOutcome,
  OwnerKind,
  SettingsChange,
  SettingsStorePort,
  StartupNoticePort,
  SubmitOutcome,
  CommandPort,
  DialogWirePort,
  EngineDiagnostics,
  WebPort,
  ThreadPort,
  ProposalPort,
  TrustPort,
  TurnPort,
  UsagePort,
  ActivityPort,
} from "../../src/types.ts";

// 아래 층 패키지 없이 호스트의 연결·처리기·전송을 시험하려는 가짜 엔진. 이벤트 로그는 메모리이고 커밋 알림은 커밋 직후 같은 턴에서
// 동기로 간다(TX-09). 실제 엔진으로 도는 시험은 real-engine.ts를 쓴다.

export const FAKE_STORE_ID: StoreId = "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV";

interface FakeLog {
  readonly errors: {
    readonly message: string;
    readonly fields: Readonly<Record<string, unknown>>;
  }[];
  readonly infos: {
    readonly message: string;
    readonly fields: Readonly<Record<string, unknown>>;
  }[];
}

/** 확장이 없는 확장 버전 포트. 조립 루트가 기본 그룹을 끈 것과 같다 */
const noExtensionsPort: ExtUiVersionPort = {
  versions: (name) => Promise.resolve(err({ kind: "unknown_extension", name })),
  rollback: (params) => Promise.resolve(err({ kind: "unknown_extension", name: params.name })),
  uiList: () => ({ items: [] }),
  uiPost: (params) =>
    Promise.resolve(err({ kind: "unknown_extension", extension: params.extension })),
  uiRequestApproval: (params) =>
    Promise.resolve(err({ kind: "unknown_extension", extension: params.extension })),
};

export interface FakeEngineOptions {
  readonly mode?: HostMode;
  /** 화면 가림 면. 생략하면 아무것도 가리지 않는다. 값 가림을 보는 시험은 실제 redactor를 넘긴다 */
  readonly display?: EnginePorts["secrets"]["display"];
  /** 연속 시작 실패 수와 안전 모드 제안(`host.status`). 생략하면 0과 거짓 */
  readonly startup?: Engine["startup"];
  readonly storeId?: StoreId;
  /** 이 owner가 모든 thread를 쥐고 있다 */
  readonly lockedBy?: OwnerKind;
  /** 다시 보낼 수 있는 가장 오래된 seq. 기본 0 */
  readonly oldestReplayable?: number;
  /** feed.read가 불릴 때마다(0부터 센 호출 번호) 먼저 부른다. 재전송 중 커밋을 끼워 넣을 때 쓴다 */
  readonly onRead?: (call: number) => void;
  /** 값이 있으면 feed.read가 이 읽기 실패로 끝난다(호출 번호는 onRead와 같다) */
  readonly readFault?: (call: number) => ReadFailure | undefined;
  /** 값이 있으면 feed.headSeq가 이 읽기 실패로 끝난다 */
  readonly headFault?: ReadFailure;
  /** 값이 있으면 tryAcquire가 이 약속이 풀릴 때까지 기다린다. 획득을 기다리는 동안의 연결 종료를 만들 때 쓴다 */
  readonly acquireGate?: Promise<void>;
  /** settings.get이 보는 범위 층 */
  readonly layers?: ScopeStack;
  /** 허용 범위 밖이라 감시되지 않는 경로를 고른다(`schedule.list`의 `outsideWatchPaths`). 생략하면 아무것도 고르지 않는다 */
  readonly outsideWatchPaths?: Engine["outsideWatchPaths"];
  /** 코어 카탈로그에 더하는 앱 설정 그룹(예약 키 시험 등) */
  readonly settingGroups?: Parameters<typeof buildEngineCatalog>[0];
  /** 진단 함수를 바꿔 끼운다(`host.status`의 `includeBinaries`). 생략하면 필수 바이너리가 모두 있는 빈 점검이다 */
  readonly diagnose?: (signal: AbortSignal) => Promise<EngineDiagnostics>;
  /** 프로필·Test run 포트(T-WB)의 의존을 바꿔 끼운다. 생략하면 계측이 꺼진 읽기, `not_available`인 Test run 제어, 존재하지 않는 임시 폴더다 */
  readonly profiles?: {
    readonly configDir?: string;
    readonly traceRead?: TraceReadPort;
    readonly testRunControl?: TestRunControlPort;
    /** 설치된 플러그인의 매니페스트 사실. 생략하면 설치된 플러그인이 없다 */
    readonly pluginFacts?: () => readonly PluginFact[];
    /** 선언된 재료 파일 읽기(비용 추정). 생략하면 어떤 파일도 없다 */
    readonly readText?: ReadText;
    readonly env?: Partial<M4HostEnv>;
  };
  /** 확장 버전과 화면 목록 포트를 바꿔 끼운다(`ext.versions`·`ext.rollback`·`ext.ui.list`). 생략하면 확장이 없는 포트다 */
  readonly extUi?: ExtUiVersionPort;
  /** 확장 메서드 포트. 기본은 모든 호출이 not_found인 빈 포트 */
  readonly extMethod?: ExtMethodPort;
  /** 포트 일부를 바꿔 끼운다. 처리기가 오류를 어떻게 옮기는지, 어떤 순서로 부르는지 볼 때 쓴다 */
  readonly overrides?: {
    readonly threads?: Partial<ThreadPort>;
    readonly turns?: Partial<TurnPort>;
    readonly settings?: Partial<SettingsStorePort>;
    readonly startupNotices?: Partial<StartupNoticePort>;
    readonly approvals?: Partial<ApprovalPort>;
    readonly trust?: Partial<TrustPort>;
    readonly models?: Partial<Engine["ports"]["models"]>;
    readonly commands?: Partial<CommandPort>;
    readonly web?: Partial<WebPort>;
    readonly dialog?: Partial<DialogWirePort>;
    readonly proposals?: Partial<ProposalPort>;
    readonly usage?: Partial<UsagePort>;
    readonly measure?: Partial<MeasurePort>;
    readonly activity?: Partial<ActivityPort>;
    readonly schedule?: Partial<ScheduleService>;
    /** 대화 영역 포트(`goal.status`, `work.tasks.list`, `schedule.update`, `schedule.runs`)를 바꾼다. 쓰지 않는 멤버는 부르면 바로 실패한다 */
    readonly dialogArea?: Partial<DialogAreaPort>;
    readonly devkit?: Partial<DevkitPort>;
    /** 샌드박스 자가 시험 포트(`sandbox.lastSelfTest`, `sandbox.selfTest`). 쓰지 않는 멤버는 부르면 바로 실패한다 */
    readonly sandboxSelfTest?: Partial<SandboxSelfTestPort>;
    /** 플러그인 읽기 포트(`plugin.list`, `plugin.get`). 쓰지 않는 멤버는 부르면 바로 실패한다 */
    readonly plugins?: Partial<PluginPort>;
    /** 검토함 포트(`pluginReview.*`). 알림 구독은 기본으로 아무것도 보내지 않는다 */
    readonly pluginReview?: Partial<PluginReviewPort>;
    /** 가져오기 포트(`migration.*`, `trust.get`의 `foreignFormats`). 기본은 표지가 없고 알림을 보내지 않는다 */
    readonly migration?: Partial<MigrationPort>;
    /** 턴 덧씌우기 포트(`turn.start.overlay`). 쓰지 않는 멤버는 부르면 바로 실패한다 */
    readonly overlay?: Partial<OverlayPort>;
  };
}

export interface FakeEngine {
  readonly engine: Engine;
  readonly ids: IdFactory;
  readonly log: FakeLog;
  readonly events: readonly DurableEventEnvelope[];
  /** 이벤트를 커밋한다. 하나의 커밋 배치로 한 번에 알린다 */
  commit(
    entries: readonly {
      readonly kind: EventKind;
      readonly threadId: ThreadId;
      readonly payload?: unknown;
    }[],
  ): CommitBatch;
  /** 다른 프로세스의 커밋을 흉내 낸다: 저장소에는 들어가지만 이 프로세스의 커밋 알림은 오지 않는다 */
  commitForeign(
    entries: readonly {
      readonly kind: EventKind;
      readonly threadId: ThreadId;
      readonly payload?: unknown;
    }[],
  ): CommitBatch;
  /** 호스트가 쓰는 스케줄러. 관찰 폴링과 종료 시한이 여기에 타이머를 건다 */
  readonly scheduler: ManualScheduler;
  /** 종료 협조 시한을 넘겨 불린 exit의 종료코드. 대역의 exit는 프로세스를 끝내지 않고 던진다 */
  readonly exits: number[];
  emitVolatile(
    event: Pick<VolatileEventEnvelope, "threadId" | "turnId" | "n" | "afterSeq"> & {
      /** 생략하면 `{ delta: "x" }`다. 파트 조각을 흉내 낼 때 넘긴다 */
      readonly payload?: unknown;
      readonly kind?: VolatileEventEnvelope["kind"];
    },
  ): void;
  /** 설정 변경 신호를 낸다(`SettingsStorePort.onChange` 구독자에게). 실제 엔진에서는 설정 저장소와 신뢰 결정이 낸다 */
  emitSettingsChange(change: SettingsChange): void;
  /**
   * 알림 하나를 알림 포트의 구독자(`subscribeNotices`)에게 낸다. `threadId`가 null이면 대화에 묶이지 않은 알림이다.
   * 실제 엔진에서는 cap-dialog의 알림 서비스가 낸다
   */
  emitNotice(threadId: ThreadId | null, notice: Notice): void;
  /** 진단 함수가 불린 횟수 */
  readonly diagnoseCalls: () => number;
  /** 다음 turn.start가 turn.busy가 되게 한다 */
  setRunningTurn(turnId: TurnId | undefined): void;
  /** 다음 turn.start를 루프가 거부한 것으로 만든다 */
  setRejection(error: LoopError | undefined): void;
  /** 시크릿 관리 서비스 대역과 맡긴 수단 저장소 */
  readonly secrets: FakeSecrets;
  readonly submitted: {
    readonly threadId: ThreadId;
    readonly requestId: string | undefined;
    readonly invoked: readonly TurnInvoked[] | undefined;
  }[];
  readonly held: ReadonlySet<ThreadId>;
  /** release가 불린 thread */
  readonly released: readonly ThreadId[];
  /** tryAcquire가 불린 기록 */
  readonly acquisitions: { readonly threadId: ThreadId; readonly kind: OwnerKind }[];
  /** 연결을 거치지 않고 thread를 만든다(다른 프로세스가 만든 thread를 흉내 낸다) */
  seedThread(): ThreadId;
  /** `thread.rename`과 첫 입력 자동 제목이 정한 제목 */
  readonly titles: ReadonlyMap<ThreadId, string>;
  /** `thread.setModel`이 정한 모델 */
  readonly chosenModels: ReadonlyMap<ThreadId, string>;
  /** `thread.create`와 `thread.setProfile`이 정한 프로필 id */
  readonly chosenProfiles: ReadonlyMap<ThreadId, string>;
  /** `thread.create`가 `threads.create`에 넘긴 입력(받은 순서). 기본 폴더 여부와 프로필을 본다 */
  readonly threadCreates: readonly FakeThreadCreate[];
  /** 대화의 작업 폴더(`threads.create`가 받은 값). 없으면 null로 읽는다 */
  readonly workspaces: ReadonlyMap<ThreadId, string>;
}

/** `threads.create`가 받은 입력의 기록 */
interface FakeThreadCreate {
  readonly workspace?: string;
  readonly profileId?: string;
  readonly defaultFolder?: boolean;
  readonly testRun?: boolean;
}

const RECORDED_AT = 1_767_571_200_000;

const TAPE_MODEL: ModelInfo = {
  ref: "tape/tape-1",
  name: "Tape One",
  contextWindow: 8192,
  maxTokens: 1024,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  supportedThinkingLevels: [],
  available: true,
};

let profileDirs = 0;

const OFF_TRACE: TraceReadPort = {
  enabled: () => false,
  turn: () => undefined,
  timings: () => ({ traceEnabled: false, timings: [] }),
};

const UNAVAILABLE_TEST_RUN: TestRunControlPort = {
  pause: () => err({ kind: "not_available" }),
  resume: () => err({ kind: "not_available" }),
  step: () => err({ kind: "not_available" }),
  phase: () => err({ kind: "not_available" }),
};

export function createFakeEngine(options: FakeEngineOptions = {}): FakeEngine {
  const ids = fixedIdFactory();
  const built = buildEngineCatalog(options.settingGroups);
  if (!built.ok) throw new Error("the core catalog must build");
  const events: DurableEventEnvelope[] = [];
  const commitListeners = new Set<(batch: CommitBatch) => void>();
  const volatileListeners = new Set<(event: VolatileEventEnvelope) => void>();
  const settingsListeners = new Set<(change: SettingsChange) => void>();
  const noticeListeners = new Set<(threadId: ThreadId | null, notice: Notice) => void>();
  const threads = new Set<ThreadId>();
  const held = new Set<ThreadId>();
  const titles = new Map<ThreadId, string>();
  const models = new Map<ThreadId, string>();
  const chosenProfiles = new Map<ThreadId, string>();
  const workspaces = new Map<ThreadId, string>();
  const threadCreates: FakeThreadCreate[] = [];
  // 마지막 활동 순서(만들기와 프로필 전환이 올린다). 대화 목록 원천의 `updatedAt`이다
  const activity = new Map<ThreadId, number>();
  let activitySeq = 0;
  const testRuns = new Set<ThreadId>();
  const summaryOf = (threadId: ThreadId): ThreadSummary => {
    const model = models.get(threadId);
    const profileId = chosenProfiles.get(threadId);
    return {
      threadId,
      title: titles.get(threadId) ?? null,
      status: "idle",
      workspace: workspaces.get(threadId) ?? null,
      createdAt: new Date(RECORDED_AT).toISOString(),
      updatedAt: new Date(RECORDED_AT).toISOString(),
      headSeq: 0,
      forkedFrom: null,
      resumable: null,
      queuedInputs: 0,
      pendingApprovals: 0,
      ...(model === undefined ? {} : { model }),
      ...(profileId === undefined ? {} : { profileId }),
    };
  };
  const submitted: {
    threadId: ThreadId;
    requestId: string | undefined;
    invoked: readonly TurnInvoked[] | undefined;
  }[] = [];
  const acquisitions: { threadId: ThreadId; kind: OwnerKind }[] = [];
  const released: ThreadId[] = [];
  const log: FakeLog = { errors: [], infos: [] };
  const state: { running: TurnId | undefined; rejection: LoopError | undefined } = {
    running: undefined,
    rejection: undefined,
  };
  const storeId = options.storeId ?? FAKE_STORE_ID;
  const secrets = createFakeSecrets();
  const scheduler = createManualScheduler();
  const exits: number[] = [];
  const shutdown = createProcessShutdown({
    timeoutMs: 3000,
    clock: { now: () => RECORDED_AT },
    scheduler,
    exit: (code) => {
      exits.push(code);
      throw new Error(`exit(${String(code)})`);
    },
  });
  const counters = { reads: 0, diagnoses: 0 };

  function commit(
    entries: readonly { kind: EventKind; threadId: ThreadId; payload?: unknown }[],
    notify = true,
  ): CommitBatch {
    const firstSeq = events.length + 1;
    const batch: DurableEventEnvelope[] = entries.map((entry, index) => ({
      id: ids.next("evt"),
      kind: entry.kind,
      version: 1,
      durable: true,
      seq: firstSeq + index,
      parentId: null,
      threadId: entry.threadId,
      turnId: null,
      stepId: null,
      causationId: null,
      correlationId: null,
      recordedAt: RECORDED_AT + firstSeq + index,
      payload: entry.payload ?? {},
    }));
    events.push(...batch);
    const result: CommitBatch = { firstSeq, lastSeq: events.length, events: batch };
    if (notify) for (const listener of Array.from(commitListeners)) listener(result);
    return result;
  }

  // 프로필과 프로젝트 파일이 놓이는 임시 폴더. 기본 폴더도 그 아래 둔다(실제 사용자 폴더를 쓰지 않는다)
  const fakeConfigDir =
    options.profiles?.configDir ??
    join(tmpdir(), `fresnel-fake-profiles-${String(process.pid)}-${String((profileDirs += 1))}`);
  const fakeFileLock: FileLock = {
    scope: "process",
    withLock: async (_path, fn) => ok(await fn()),
    updateText: () => Promise.reject(new Error("updateText is not part of the fake")),
  };
  const fakeClock = { now: () => RECORDED_AT };
  // 프로젝트 포트는 실제 구현을 임시 폴더에 붙인다. 대화 목록은 가짜 대화 집합에서 읽는다
  const projects = createProjectPort({
    configDir: fakeConfigDir,
    dataDir: join(fakeConfigDir, "data"),
    fileLock: fakeFileLock,
    clock: fakeClock,
    signal: new AbortController().signal,
    ids: createLocalIdFactory(fakeClock, systemRandom()),
    settingValue: () => undefined,
    // 배경 갱신의 실패는 가짜 로그에 남긴다(실제 조립은 호스트 로그로 보낸다)
    report: (message, fields) => {
      log.errors.push({ message, fields });
    },
    threadRows: () =>
      [...threads]
        .map((threadId) => ({
          threadId,
          workspace: workspaces.get(threadId) ?? null,
          status: "idle" as const,
          profileId: chosenProfiles.get(threadId) ?? null,
          updatedAt: activity.get(threadId) ?? 0,
          testRun: testRuns.has(threadId),
        }))
        // 최근순(마지막 활동이 큰 것이 먼저)이다. 대화 목록의 정렬과 같다
        .toSorted((left, right) => right.updatedAt - left.updatedAt),
  });

  const ports: EnginePorts = {
    threads: {
      create(input) {
        const threadId = ids.next("thr");
        threads.add(threadId);
        threadCreates.push({
          ...(input.workspace === undefined ? {} : { workspace: input.workspace }),
          ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
          ...(input.defaultFolder === undefined ? {} : { defaultFolder: input.defaultFolder }),
          ...(input.testRun === undefined ? {} : { testRun: input.testRun }),
        });
        if (input.workspace !== undefined) workspaces.set(threadId, input.workspace);
        if (input.profileId !== undefined) chosenProfiles.set(threadId, input.profileId);
        if (input.testRun === true) testRuns.add(threadId);
        activitySeq += 1;
        activity.set(threadId, activitySeq);
        commit([{ kind: "thread.started", threadId }]);
        return Promise.resolve({ threadId, position: position() });
      },
      exists: (threadId) => ok(threads.has(threadId)),
      workspaceOf: (threadId) => ok(workspaces.get(threadId) ?? null),
      // 열기 훅과 같은 폴더 알림은 이 가짜에서 할 일이 없다
      applyOpenWorkspace: () => Promise.resolve(),
      sameFolder: () => [],
      list: () =>
        Promise.resolve({
          threads: [...threads].map(summaryOf),
          nextCursor: null,
        }),
      fork: () => Promise.reject(new Error("fork is not part of the fake")),
      revert: () => Promise.reject(new Error("revert is not part of the fake")),
      remove: () => Promise.reject(new Error("remove is not part of the fake")),
      read: () => Promise.reject(new Error("read is not part of the fake")),
      rename(threadId, title) {
        // 제목 변경은 쓰기 소유자만 한다(SessionService.threads.setTitle)
        if (!held.has(threadId)) return err({ kind: "not_owner", threadId });
        titles.set(threadId, title);
        commit([{ kind: "thread.updated", threadId, payload: { title } }]);
        return ok({ position: position() });
      },
      setModel(threadId, model) {
        if (!held.has(threadId)) return err({ kind: "not_owner", threadId });
        if (model === null) models.delete(threadId);
        else models.set(threadId, model);
        commit([{ kind: "thread.updated", threadId, payload: { model } }]);
        return ok({ position: position() });
      },
      setProfile(threadId, profileId) {
        if (!held.has(threadId)) return err({ kind: "not_owner", threadId });
        chosenProfiles.set(threadId, profileId);
        activitySeq += 1;
        activity.set(threadId, activitySeq);
        commit([{ kind: "thread.updated", threadId, payload: { profileId } }]);
        return ok({ position: position() });
      },
      compact: () => Promise.reject(new Error("compact is not part of the fake")),
      hasTitle: (threadId) => ok((titles.get(threadId) ?? "") !== ""),
      title: (threadId) => ok(titles.get(threadId) ?? null),
      position: () => ok(position()),
      ...options.overrides?.threads,
    },
    turns: {
      submit(threadId, _input, requestId, whenBusy, invoked): Promise<SubmitOutcome> {
        submitted.push({ threadId, requestId, invoked });
        if (state.rejection !== undefined) {
          return Promise.resolve({ ok: false, reason: "rejected", error: state.rejection });
        }
        if (state.running !== undefined) {
          if (whenBusy !== undefined) {
            return Promise.resolve({ ok: true, turnId: state.running, queued: true });
          }
          return Promise.resolve({ ok: false, reason: "busy", turnId: state.running });
        }
        const turnId = ids.next("trn");
        commit([{ kind: "turn.started", threadId }]);
        return Promise.resolve({ ok: true, turnId });
      },
      interrupt: () => Promise.resolve(false),
      resume: () => Promise.reject(new Error("resume is not part of the fake")),
      stopAtSafeBoundary: () => Promise.resolve(true),
      isLive: () => state.running !== undefined,
      withdraw: () => Promise.resolve(ok(false)),
      ...options.overrides?.turns,
    },
    feed: {
      headSeq: () => (options.headFault === undefined ? ok(events.length) : err(options.headFault)),
      oldestReplayableSeq: () => options.oldestReplayable ?? 0,
      read(after, upto, filter, limit, scanLimit) {
        options.onRead?.(counters.reads);
        const fault = options.readFault?.(counters.reads);
        counters.reads += 1;
        if (fault !== undefined) return err(fault);
        const rows = events.filter((event) => event.seq > after && event.seq <= upto);
        const scanned = rows.slice(0, scanLimit);
        const matched: DurableEventEnvelope[] = [];
        let scannedTo = after;
        for (const row of scanned) {
          scannedTo = row.seq;
          if (matchesFilter(row, filter)) matched.push(row);
          if (matched.length >= limit) return ok({ events: matched, scannedTo });
        }
        return ok({ events: matched, scannedTo: scanned.length < scanLimit ? upto : scannedTo });
      },
      onCommit(listener) {
        commitListeners.add(listener);
        return () => {
          commitListeners.delete(listener);
        };
      },
      onVolatile(listener) {
        volatileListeners.add(listener);
        return () => {
          volatileListeners.delete(listener);
        };
      },
    },
    locks: {
      async tryAcquire(threadId, kind): Promise<LockOutcome> {
        acquisitions.push({ threadId, kind });
        await options.acquireGate;
        if (options.lockedBy !== undefined) {
          return Promise.resolve({ ok: false, ownerKind: options.lockedBy });
        }
        held.add(threadId);
        return Promise.resolve({
          ok: true,
          token: { resource: `thread:${threadId}`, holderId: "fake", epoch: 1 },
          release() {
            held.delete(threadId);
            return Promise.resolve();
          },
        });
      },
      holds: (threadId) => held.has(threadId),
      release(threadId) {
        held.delete(threadId);
        released.push(threadId);
        return Promise.resolve();
      },
    },
    settings: {
      layers: () => options.layers ?? [],
      prepare: () => Promise.resolve(),
      write: () => Promise.reject(new Error("write is not part of the fake")),
      reset: () => Promise.reject(new Error("reset is not part of the fake")),
      readFile: () => Promise.reject(new Error("readFile is not part of the fake")),
      writeFile: () => Promise.reject(new Error("writeFile is not part of the fake")),
      refreshUserFile: () => Promise.resolve(),
      problems: () => [],
      onChange(listener) {
        settingsListeners.add(listener);
        return () => {
          settingsListeners.delete(listener);
        };
      },
      ...options.overrides?.settings,
    },
    startupNotices: {
      notices: () => [],
      ...options.overrides?.startupNotices,
    },
    approvals: {
      locate: () => Promise.resolve(ok(undefined)),
      respond: () => Promise.resolve({ applied: false }),
      list: () => Promise.reject(new Error("list is not part of the fake")),
      listAll: () => Promise.reject(new Error("listAll is not part of the fake")),
      ...options.overrides?.approvals,
    },
    commands: {
      list: () => Promise.reject(new Error("command.list is not part of the fake")),
      run: () => Promise.reject(new Error("command.run is not part of the fake")),
      ...options.overrides?.commands,
    },
    web: {
      providers: () => Promise.reject(new Error("web.providers is not part of the fake")),
      ...options.overrides?.web,
    },
    dialog: {
      statusList: () => Promise.reject(new Error("status.list is not part of the fake")),
      attachmentsAdd: () => Promise.reject(new Error("attachments.add is not part of the fake")),
      notifyList: () => Promise.reject(new Error("notify.list is not part of the fake")),
      subscribeNotices(listener) {
        noticeListeners.add(listener);
        return () => {
          noticeListeners.delete(listener);
        };
      },
      ...options.overrides?.dialog,
    },
    proposals: {
      list: () => Promise.reject(new Error("proposal.list is not part of the fake")),
      decide: () => Promise.reject(new Error("proposal.decide is not part of the fake")),
      ...options.overrides?.proposals,
    },
    usage: {
      gauges: () => Promise.resolve([]),
      context: () => Promise.resolve(undefined),
      ...options.overrides?.usage,
    },
    measure: {
      turn: () => ok({ enabled: false, rows: [] }),
      daily: () => ok({ enabled: false, days: [] }),
      turnRecord: createTurnRecordPort({
        store: () => undefined,
        enabled: () => false,
        retentionDays: () => 30,
        logTurnStartedAt: () => ok(undefined),
        events: { subscribe: () => () => undefined },
        now: () => 0,
        metrics: () => ({
          minSample: 20,
          defaultWindowDays: 30,
          findingsEnabled: true,
          findingOverrides: {},
        }),
      }),
      ...options.overrides?.measure,
    },
    trust: {
      get: () => Promise.reject(new Error("trust.get is not part of the fake")),
      decide: () => Promise.reject(new Error("trust.decide is not part of the fake")),
      list: () => Promise.reject(new Error("trust.list is not part of the fake")),
      remove: () => Promise.reject(new Error("trust.remove is not part of the fake")),
      ...options.overrides?.trust,
    },
    activity: {
      snapshot: () => ({ liveTurns: 0, liveTasks: 0, waitingApprovals: 0, pendingSchedules: 0 }),
      onChange: () => () => undefined,
      ...options.overrides?.activity,
    },
    // 예약 서비스는 `overrides.schedule`로 쓰는 멤버만 채운다. 채우지 않은 멤버를 부르면 undefined라 시험이 바로 실패한다
    schedule: partial<ScheduleService>({ ...options.overrides?.schedule }),
    notify: { show: () => Promise.resolve() },
    log: {
      error: (message, fields) => {
        log.errors.push({ message, fields });
      },
      info: (message, fields) => {
        log.infos.push({ message, fields });
      },
    },
    secrets: { ...secrets.port, display: options.display ?? NO_DISPLAY },
    models: {
      modelIds: (provider) => (provider === "tape" ? ["tape-1"] : []),
      available: () => [TAPE_MODEL],
      // 인증 확인은 기본으로 확인 경로가 없는 provider로 답한다. 시험은 `overrides.models`로 바꾼다
      checkAuth: () => Promise.resolve({ kind: "unsupported" }),
      ...options.overrides?.models,
    },
    ids,
    clock: { now: () => RECORDED_AT },
    scheduler,
    // 확장 버전·화면 목록 처리기는 T-XV가 채웠으므로 확장이 없는 포트를 넘긴다(시험은 `extUi`로 바꿔 끼운다)
    // M4 처리기는 소유 트랙이 채울 때까지 모두 기본(notImplemented)이다. 포트는 빈 구현이다. 프로필·Test run은 T-WB가 채웠다
    plugins: partial<PluginPort>({ ...options.overrides?.plugins }),
    pluginReview: partial<PluginReviewPort>({
      onChanged: () => () => undefined,
      ...options.overrides?.pluginReview,
    }),
    overlay: partial<OverlayPort>({ ...options.overrides?.overlay }),
    // 프로젝트를 여는 훑기는 검토 포트를 쓰지 않는 시험에서 아무 일도 하지 않는다
    scanOpenedRoots: () => Promise.resolve(),
    pluginMigration: partial<MigrationSubmitPort>({}),
    migration: partial<MigrationPort>({
      foreignFormatsOf: () => Promise.resolve(undefined),
      onChanged: () => () => undefined,
      onProgress: () => () => undefined,
      ...options.overrides?.migration,
    }),
    m4: {
      extRead: createExtReadPort(
        {
          traceRead: options.profiles?.traceRead ?? OFF_TRACE,
          env: {
            // 순서 쓰기(`hooks.order.*`)가 설정 저장소를 쓴다. 포트가 호출할 때마다 읽는다(프로필 처리기와 같다)
            get settings() {
              return ports.settings;
            },
            errors: { ofStore: wireErrorOfStore, threadLocked: () => threadLocked(null) },
          },
        },
        EMPTY_EXT_READ_SOURCES,
      ),
      extUi: options.extUi ?? noExtensionsPort,
      extMethod: options.extMethod ?? { call: () => Promise.resolve({ kind: "not_found" }) },
      // 대화별 켜짐 집합은 시험 가짜에서 항상 기본 집합을 준다. 실제 집합은 `createPluginSet`이 낸다(plugin-set 시험)
      pluginSet: {
        port: {
          resolve: () => ({ plugins: [], profileId: "default", profileRev: 0, commonRev: 0 }),
        },
        refresh: () => Promise.resolve(),
        recompute: () => undefined,
        attachOverlay: () => Promise.resolve(),
        cancelOverlay: () => Promise.resolve(),
        recomputeAll: () => undefined,
        opened: () => Promise.resolve(),
        forget: () => undefined,
        defaultView: () => ({ plugins: [], profileId: "default", profileRev: 0, commonRev: 0 }),
        settingsOf: () => new Map(),
        sourceOf: () => "none",
        dispose: () => undefined,
      },
      project: projects,
      profileTestRun: createProfileTestRunPort({
        traceRead: options.profiles?.traceRead ?? OFF_TRACE,
        testRunControl: options.profiles?.testRunControl ?? UNAVAILABLE_TEST_RUN,
        pluginFacts: options.profiles?.pluginFacts ?? (() => []),
        pendingNames: () => Promise.resolve([]),
        readText: options.profiles?.readText ?? (() => Promise.resolve(undefined)),
        projects,
        env: {
          catalog: built.catalog,
          pendingPluginNames: () => Promise.resolve([]),
          loadedHash: () => undefined,
          // 포트가 호출할 때마다 읽는다: `ports`는 이 객체가 만들어진 뒤에 채워진다
          get settings() {
            return ports.settings;
          },
          errors: { ofStore: wireErrorOfStore, threadLocked: () => threadLocked(null) },
          settingValue: () => undefined,
          threadExists: (threadId) => ports.threads.exists(threadId),
          toggles: {
            scopes: () => [],
            request: () => undefined,
            requestApply: () => undefined,
            applyNow: () => Promise.resolve(),
          },
          registrations: () => [],
          stopped: () => false,
          settingsChanged: () => undefined,
          // 시크릿과 대화 수는 빈 저장소의 값이다. 시험이 `env`로 바꿔 끼운다
          secretNames: () => Promise.resolve(new Set<string>()),
          // 닫히지 않은 대화가 저장한 프로필 id. 가짜 대화 목록의 값이다
          openThreadProfiles: () =>
            [...threads].map((threadId) => chosenProfiles.get(threadId) ?? null),
          openThreadIds: () => [...threads],
          driveFramePlugins: () => [],
          threadProfileId: (threadId) => chosenProfiles.get(threadId) ?? null,
          forcedPlugins: () => [],
          defaultPlugins: () => ["helm"],
          stateDir: join(tmpdir(), "fresnel-fake-profiles-state"),
          configDir: fakeConfigDir,
          fileLock: fakeFileLock,
          clock: fakeClock,
          signal: new AbortController().signal,
          ...options.profiles?.env,
        },
      }),
      dialogArea: partial<DialogAreaPort>({ ...options.overrides?.dialogArea }),
      devkit: partial<DevkitPort>({ ...options.overrides?.devkit }),
      sandboxSelfTest: partial<SandboxSelfTestPort>({ ...options.overrides?.sandboxSelfTest }),
    },
  };

  function position(): StreamPosition {
    return { storeId, seq: events.length };
  }

  const engine: Engine = {
    mode: options.mode ?? "in-process",
    scheduleRuns: () => (options.mode ?? "in-process") === "service",
    outsideWatchPaths: options.outsideWatchPaths ?? (() => []),
    storeId,
    catalog: built.catalog,
    safeMode: false,
    startup: options.startup ?? { failures: 0, suggestSafeMode: false },
    startedAt: RECORDED_AT,
    ports,
    shutdown,
    diagnose: (signal) => {
      counters.diagnoses += 1;
      if (options.diagnose !== undefined) return options.diagnose(signal);
      return Promise.resolve({
        binaries: ok({ platform: "linux", items: [], ready: true, blocking: [], degraded: [] }),
      });
    },
    close: () => Promise.resolve(),
  };

  return {
    engine,
    ids,
    log,
    events,
    commit: (entries) => commit(entries),
    commitForeign: (entries) => commit(entries, false),
    scheduler,
    exits,
    released,
    emitVolatile(partial) {
      const event: VolatileEventEnvelope = {
        id: ids.next("evt"),
        kind: partial.kind ?? "item.updated",
        version: 1,
        durable: false,
        threadId: partial.threadId,
        turnId: partial.turnId,
        stepId: null,
        recordedAt: RECORDED_AT,
        causationId: null,
        correlationId: null,
        payload: partial.payload ?? { delta: "x" },
        n: partial.n,
        afterSeq: partial.afterSeq,
      };
      for (const listener of Array.from(volatileListeners)) listener(event);
    },
    emitSettingsChange(change) {
      for (const listener of Array.from(settingsListeners)) listener(change);
    },
    emitNotice(threadId, notice) {
      for (const listener of Array.from(noticeListeners)) listener(threadId, notice);
    },
    setRunningTurn(turnId) {
      state.running = turnId;
    },
    setRejection(error) {
      state.rejection = error;
    },
    diagnoseCalls: () => counters.diagnoses,
    secrets,
    titles,
    chosenModels: models,
    chosenProfiles,
    threadCreates,
    workspaces,
    submitted,
    held,
    acquisitions,
    seedThread() {
      const threadId = ids.next("thr");
      threads.add(threadId);
      commit([{ kind: "thread.started", threadId }]);
      return threadId;
    },
  };
}
