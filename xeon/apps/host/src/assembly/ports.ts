import {
  assertNever,
  attempt,
  attemptAsync,
  Bug,
  detach,
  err,
  ok,
  parse,
  type Clock,
  type Result,
  type Scheduler,
  type LogFields,
  type LogValue,
  type Logger,
} from "@fresnel/contracts";
import {
  isId,
  type EventId,
  type IdFactory,
  type LocalIdFactory,
  type ThreadId,
  type TurnInvoked,
} from "@fresnel/contracts/conversation";
import type {
  LeaseHolder,
  LeaseToken,
  RewindId,
  SessionService,
  StoreService,
} from "@fresnel/contracts/records";
import type {
  ApprovalService,
  ContextService,
  FileRewindService,
  LoopService,
  ModelService,
  OsService,
  TaskService,
  ToolOutputFiles,
  ToolService,
} from "@fresnel/contracts/services";
import {
  StoreIdSchema,
  threadSummaryOf,
  wireError,
  type StartupNotice,
  type StoreId,
  type ThreadSummary,
  type TurnStartInput,
  type WhenBusy,
  type WireResult,
  START_DRIVE_REJECT_REASONS,
  type StartDriveRejectReason,
} from "@fresnel/contracts/wire";
import { cancelledByOwnerOf } from "./owner-cancel.ts";
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ScheduleService } from "@fresnel/cap-schedule";
import { itemPagesOf } from "@fresnel/core-persistence";
import { PrimitiveError, registrationToggleSourceOf, type ExtHost } from "@fresnel/ext-host";
import { createFileWatcher, createFsWatchBackend, type FileLock } from "@fresnel/platform-os";
import type {
  ActivityPort,
  ApprovalPort,
  EventFeedPort,
  EnginePorts,
  FileRewindPort,
  HostLogPort,
  HostMode,
  LockOutcome,
  OwnerKind,
  PendingSchedulesPort,
  ProposalPort,
  SessionLockPort,
  SettingsStorePort,
  SubmitOutcome,
  ThreadPort,
  TrustPort,
  TurnPort,
  SecretsPort,
  UserNotifyPort,
  WithdrawFailure,
} from "../types.ts";
import { threadLocked } from "../handlers/owner.ts";
import { startedRewindOf, undoneConversationOf } from "./file-rewind.ts";
import { wireErrorOfProject } from "../handlers/m4/project.ts";
import { wireErrorOfCreate, wireErrorOfLease, wireErrorOfStore } from "../store-error.ts";
import { messageOf, sequentially } from "../util.ts";
import { createApprovalPort } from "./approvals.ts";
import { createCommandPort } from "./commands.ts";
import { createDialogWirePort } from "./dialog-wire.ts";
import { unreadableInputNotice } from "@fresnel/cap-dialog";
import { userSkillsDir, type UserSkillSink } from "@fresnel/cap-knowledge";
import { createMeasurePort, type MeasureReadSource } from "./measure/read.ts";
import { createBacktestPort, type BacktestSource } from "./backtest/port.ts";
import { backtestSettingsOf } from "./backtest/settings.ts";
import {
  createTestRunMarks,
  decodeTestRunDrafts,
  draftRecordOf,
  encodeTestRunDrafts,
} from "./measure/test-run-marks.ts";
import {
  createUsageSource,
  EMPTY_TALLY,
  OFF_LOOP_ROLES,
  readEventsOfAllBranches,
  type BackgroundCallReader,
  type Tally,
} from "./usage.ts";
import { canonicalWorkspace, wireErrorOfWorkspace, workspaceFilterOf } from "./workspace.ts";
import type { CommandRegistryHolder } from "./l2-units.ts";
import { createWebPort, type WebStatusHolder } from "./web-providers.ts";
import type { SettingsEngine } from "./settings-engine.ts";
import { createSettingsStore } from "./settings-store.ts";
import { createThreadGate } from "./thread-gate.ts";
import { readThread } from "./thread-read.ts";
import type { DialogAreaHolder } from "./m4/dialog-area-bridge.ts";
import { createExtReadSources, type ExtReadAssembly } from "./m4/ext-read-sources.ts";
import { createM4Ports } from "./m4/index.ts";
import { pluginFactOf } from "./m4/plugin-fact.ts";
import { pluginLifecycleOf } from "./m4/plugin-lifecycle.ts";
import {
  approvalHooksOf,
  createMigrationService,
  createMigrationSubmitter,
  createPluginReview,
  createUserSkillSink,
  createDraftLoader,
  createOverlayPort,
  createTestRunDrafts,
  DRAFT_DRIVE_ENTRY,
  type PreparedTestRunDrafts,
  createPluginService,
  createSourceWatch,
  type PluginStore,
} from "./plugins/index.ts";
import { processPortOf, sandboxSourceOf } from "./plugin-host.ts";
import { currentSelf, type SelfRunTarget } from "../self-command.ts";
import { createProjectPort, type ProjectThreadRow } from "./m4/project-port.ts";
import { createCraftChatPort } from "./m4/craft-chat.ts";
import { deepestRoot, projectIdOf } from "./m4/project-scope.ts";
import { createAppEditLedger } from "./plugins/app-edits.ts";
import type { DiscoverProjectRoot } from "./plugins/discover.ts";
import { withPendingReview } from "./plugins/pending-overlay.ts";
import { CRAFT_PROFILE_ID, DEFAULT_PROFILE_ID } from "./m4/profile-defaults.ts";
import { ensureResidentDrive, type ResidentDriveDeps } from "./m4/resident-drive.ts";
import { restorableLeasesOf } from "./m4/drive-restore.ts";
import type { OverlayMark } from "./m4/plugin-set.ts";
import {
  PluginSubmitPortKey,
  CraftContextPortKey,
  pluginDeclsOf,
  pluginsOf,
  registrationIdOf,
  type ExternalToolStatus,
  type PluginStorePort,
  type RegistrationId,
} from "@fresnel/contracts/extensions";
import { DEFAULT_PLUGIN_NAMES } from "./default-plugins.ts";
import type { ExtUiVersionSource } from "./m4/ext-ui-version-source.ts";
import type { ProjectExtensions } from "./project-extensions.ts";
import type { ProjectTrust, TrustInspection } from "./trust.ts";

// L4.host-service.spec §3.3.2. 아래 층 서비스(F 서비스 인터페이스)를 EnginePorts로 감싸는 어댑터. 어댑터가 이 폴더 한 곳에 모이므로
// L1 서비스 이름이 바뀌어도 고칠 곳이 하나다(L4.host-service.plan §2). 조립 루트 코드(DR-14 예외 2).

export interface PortsDeps {
  /** 엔진 수명 신호. 닫히면 진행 중인 알림 같은 기다리지 않는 호출을 중단한다 */
  readonly signal: AbortSignal;
  /** 개발 모드처럼 모든 대화에 켜 두는 플러그인(대화별 켜짐 집합에 항상 든다) */
  readonly pluginsForced?: () => readonly string[];
  readonly mode: HostMode;
  readonly os: OsService;
  /** 지운 대화의 잘린 출력 사본을 함께 지운다 */
  readonly toolOutputs: Pick<ToolOutputFiles, "removeThread">;
  readonly clock: Clock;
  /** 관찰 폴링 같은 호스트 자신의 타이머. L0.os의 스케줄러다 */
  readonly scheduler: Scheduler;
  readonly ids: IdFactory;
  readonly logger: Logger;
  readonly session: SessionService;
  readonly store: StoreService;
  /** 플러그인 전용 저장소(`sys_plugin_store`)의 지우기. 제거 승인이 그 플러그인의 이름 공간을 지운다(X.primitives.spec §4.6.7) */
  readonly pluginDataStore: Pick<PluginStorePort, "clear"> &
    Partial<Pick<PluginStorePort, "usage">>;
  /**
   * 파일 되감기 포트. cap-workspace가 `fresnel.file-rewind`로 내놓은 서비스와 되감기 식별자 발급기다. 없으면(원본 저장 포트가
   * 없는 조립) 파일 되감기 메서드는 `notImplemented`다
   */
  readonly fileRewind?: {
    readonly service: FileRewindService;
    readonly newRewindId: () => RewindId;
  };
  readonly loop: LoopService;
  /** 수동 컴팩션(`thread.compact`)이 부른다 */
  readonly context: Pick<ContextService, "compact">;
  /** 수동 컴팩션이 현재 모델(역할 `main`)의 바인딩과 창 크기를 정할 때 쓴다. `usage`는 사용량 원천(`usage.get`)이 구독한다 */
  readonly models: Pick<ModelService, "resolve" | "list" | "usage" | "checkProviderAuth">;
  readonly tasks: TaskService;
  readonly approvals: ApprovalService;
  /** 열 때 복구가 도구의 현재 재실행 정책을 본다(ToolService.meta) */
  readonly tools: Pick<ToolService, "meta">;
  readonly ext: ExtHost;
  /** 훑기 자식을 띄울 때 쓰는 자기 실행 값. 시험이 넣고, 운영은 생략해 이 실행 파일을 쓴다(`plugin-host`와 같다) */
  readonly migrationSelf?: SelfRunTarget;
  readonly holder: LeaseHolder;
  readonly settings: SettingsEngine;
  readonly secrets: SecretsPort;
  /** 명령 등록부 자리. 브리지 확장이 명령 서비스 API를 채운다 */
  readonly commands: CommandRegistryHolder;
  /** 측정 저장소 읽기 원천(T-MEAS-READ) */
  readonly measure: MeasureReadSource;
  /**
   * 지난 턴에 돌려 보기의 격리와 설정 원천(늦게 묶는다). 없으면(플러그인 호스트를 조립하지 않은 시험) 격리가 없는 것이다:
   * 돌려 보기는 `3524`로 답한다
   */
  readonly backtest?: BacktestSource;
  /** 웹 런타임 자리. cap-web 확장이 채운다(`web.providers`) */
  readonly web: WebStatusHolder;
  /** 지식 제안 대기열 둘의 합친 조회·결정(`proposal.*`) */
  readonly proposals: ProposalPort;
  /** 사용자 설정 파일이 없을 때 새로 만들 디렉터리(L0.os의 `dirs.config`) */
  readonly configDir: string;
  /** 호스트 상태 디렉터리(L0.os의 `dirs.state`). 프로필 옮김 기록 `migration.log`가 여기에 놓인다 */
  readonly stateDir: string;
  /** 홈 폴더(`OsDirs.home`). 가져오기가 항목 경로를 `~/…`로 줄이고 감지가 홈의 공유 스킬 폴더를 세지 않게 쓴다 */
  readonly homeDir: string;
  /** `OsDirs.data`. 프로젝트 없는 대화의 기본 폴더(`default-project`)가 여기에 놓인다(review m5 §4.4.5) */
  readonly dataDir: string;
  /** 지역 접두 id 발급(`prj_`, `rvw_`, `drf_`). 프로젝트, 검토 항목, 초안의 id다 */
  readonly localIds: LocalIdFactory;
  /** 프로세스 사이 파일 잠금(`OsServiceHandle.fileLock`). 설정 파일 쓰기가 이 안에서 일어난다(M3-REQ-82) */
  readonly fileLock: FileLock;
  readonly trust: ProjectTrust;
  /** 서비스 모드의 프로젝트 확장 적재(M3-REQ-38). 쓰기 소유를 얻은 thread의 작업 폴더와 신뢰 결정 뒤에 부른다 */
  readonly projectExtensions: ProjectExtensions;
  /** thread의 작업 폴더 설정을 읽은 뒤 부른다. 외부 훅 단위를 그 thread에 맞춘다 */
  readonly afterSettingsPrepare?: ((threadId: ThreadId) => Promise<void>) | undefined;
  /** 확장 버전과 화면 목록의 원천(T-XV, HS-108). 없으면 확장이 없는 것으로 본다 */
  readonly extUi?: ExtUiVersionSource | undefined;
  /** thread의 작업 디렉터리(없으면 undefined) */
  readonly workspaceOf: (threadId: ThreadId) => string | undefined;
  /** 예약 서비스(L4.host-service.spec §4.17). 대기 예약·루프 수를 활동 집계에 낸다 */
  readonly schedule: ScheduleService;
  /** 대기 예약 수의 시험 주입. 있으면 예약 서비스의 대기 수 대신 이 값을 쓴다 */
  readonly pendingSchedules?: PendingSchedulesPort;
  /** 대화 영역 wire가 읽는 목표·작업 기능 API 자리. 조립 확장(`dialogAreaBridgePlugin`)이 채운다(T-WC) */
  readonly dialogArea: DialogAreaHolder;
  /** 확장 읽기 wire(`ext.*`, `group.*`, `hooks.list`)의 원천 재료. 조립 루트가 확장 목록, 운영 정책, 그룹 서비스를 넘긴다 */
  readonly extRead: ExtReadAssembly;
  /** 기본 플러그인 번들 뿌리(`defaultPluginsDir()` 또는 옵션). 플러그인 읽기 서비스가 번들 폴더로 본다 */
  readonly defaultPluginsDir: string;
  /** 도구 종류 플러그인의 마지막 점검 상태(AGE-76 질문 2). 플러그인 읽기 서비스가 응답 카드에 싣는다 */
  readonly toolStatusOf?: (name: string) => ExternalToolStatus | undefined;
  /** 검토본 저장소 읽기(플러그인 읽기 서비스가 검토 칸, 무결성, 보관 목록을 읽는다) */
  /** 검토본 저장소(M5c §4.6). 읽기 면과 검토 쓰기를 모두 쓴다 */
  readonly pluginStore: PluginStore;
  /** 시작 때 저장소 등이 알린 일(`host.status.startupNotices`). 없으면 알릴 것이 없는 것이다 */
  readonly startupNotices?: readonly StartupNotice[] | undefined;
}

export interface PortsHandle {
  readonly ports: EnginePorts;
  /** 사용자 범위 스킬 만들기를 플러그인 검토함으로 보내는 싱크(L2.knowledge §7.5 [제안]). cap-knowledge가 부른다 */
  readonly userSkillSink: UserSkillSink;
  /** 이 엔진이 쥔 thread의 세션 쓰기 토큰. 쥐지 않았으면 undefined */
  tokenOf(threadId: ThreadId): LeaseToken | undefined;
  /** 이 엔진이 지금 쓰기 소유를 쥔 thread 전부(쥔 순서) */
  heldThreads(): readonly ThreadId[];
  /** 가장 최근에 쓰기 소유를 쥔 thread(그룹 서비스가 상태를 보여 줄 thread). 쥔 thread가 없으면 null */
  activeThread(): ThreadId | null;
  /** 쥔 세션 임대를 모두 반납한다(엔진을 닫기 전). 각 thread에 session.shutdown("quit")을 발화한다 */
  releaseAll(): Promise<void>;
  /** 플러그인 원본 폴더 감시를 닫는다(엔진을 닫기 전). 진행 중인 훑기를 기다린다 */
  closeSourceWatch(): Promise<void>;
}

/** 엔진의 시작 Drive 거부 이유를 wire의 닫힌 목록으로 옮긴다. 목록 밖(`input_too_large` 등)은 비운다 */
function startDriveRejectReasonOf(kind: string): StartDriveRejectReason | undefined {
  return START_DRIVE_REJECT_REASONS.find((reason) => reason === kind);
}

function toLogValue(value: unknown): LogValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : `${value}`;
  if (value === undefined) return null;
  if (typeof value === "object") {
    const json = attempt(() => JSON.stringify(value));
    return json.ok ? json.value : "[unserializable]";
  }
  return `[${typeof value}]`;
}

export function toLogFields(fields: Readonly<Record<string, unknown>>): LogFields {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, toLogValue(value)]));
}

/** 판정과 선택지를 wire `TrustStatus`로 옮긴다. `details`는 미리 본 자원이 있을 때만 싣는다 */
function trustStatusOf(inspection: TrustInspection): WireResult<"trust.get"> {
  const { result, options, details } = inspection;
  return {
    projectRoot: result.projectRoot,
    required: result.required,
    verdict: result.verdict,
    via: result.via,
    resources: [...result.resources],
    ...(details === null ? {} : { details }),
    options: options.map((option) => ({
      choice: { kind: option.choice.kind, verdict: option.choice.verdict },
      label: option.label,
      savedPath: option.savedPath,
    })),
  };
}

function storeIdOf(raw: string): StoreId {
  const parsed = parse(StoreIdSchema, raw);
  // fresnel-disable-next-line fresnel/bug-for-expected -- 엔진 자신의 저장소가 만든 storeId라 형식 검증이 실패하면 코드 결함이다 (eng.typescript.guide TY-24)
  if (!parsed.ok) throw new Bug(`store.invalid_store_id: ${raw}`, { cause: parsed.error });
  return parsed.value;
}

interface HeldLease {
  readonly token: LeaseToken;
  readonly alive: Disposable;
}

/** provider에 등록된 모델 id들. `list`의 ref는 `provider/modelId`다(thinking 수준 접미 없음) */
function modelIdsOf(models: Pick<ModelService, "list">, provider: string): readonly string[] {
  const prefix = `${provider}/`;
  return models
    .list({ provider })
    .flatMap((info) => (info.ref.startsWith(prefix) ? [info.ref.slice(prefix.length)] : []));
}

/**
 * 예약이 만든 thread와 그 예약(W-16 `ThreadSummary.origin`). 예약 서비스의 실행 기록(`RunRecord.threadId`)이 원천이고, 보관하는 기록 수
 * (`maxRunRecords`)만큼만 거슬러 알 수 있다 [제안]. 사용자와 원격이 만든 thread는 호스트가 구별하지 못하므로 `origin`을 싣지 않는다
 */
function scheduleOriginsOf(schedule: ScheduleService): ReadonlyMap<string, string> {
  const origins = new Map<string, string>();
  for (const entry of schedule.list()) {
    for (const run of schedule.runs(entry.id, Number.MAX_SAFE_INTEGER)) {
      if (run.threadId !== null) origins.set(run.threadId, entry.id);
    }
  }
  return origins;
}

/** 측정 저장소의 배경 호출 행을 provider별 합계로 접는다. 측정이 꺼졌거나 저장소가 없으면 undefined */
function backgroundCallsOf(source: MeasureReadSource): BackgroundCallReader {
  return (threadId) => {
    const store = source.store();
    if (store === undefined || !source.enabled()) return undefined;
    const rows = store.callsOfRoles(OFF_LOOP_ROLES, threadId);
    if (!rows.ok) return undefined;
    const providers = new Map<string, Tally>();
    for (const row of rows.value) {
      const name = row.tags["provider"] ?? "";
      const tally = providers.get(name) ?? EMPTY_TALLY;
      providers.set(name, {
        tokens: tally.tokens + (row.metrics["totalTokens"] ?? 0),
        usd: tally.usd + (row.metrics["usd"] ?? 0),
        requests: tally.requests + 1,
        cacheRead: tally.cacheRead + (row.metrics["cacheRead"] ?? 0),
        cacheWrite: tally.cacheWrite + (row.metrics["cacheWrite"] ?? 0),
      });
    }
    return providers;
  };
}

/**
 * 닫히지 않은 대화가 저장한 프로필 id를 대화마다 하나씩 돌려준다. 저장한 id가 없으면 null(기본 프로필)이다.
 * 목록을 쪽마다 끝까지 읽는다(프로필을 쓰는 대화를 셀 때)
 */
function openThreadProfilesOf(session: PortsDeps["session"]): readonly (string | null)[] {
  const profiles: (string | null)[] = [];
  let cursor: string | undefined;
  do {
    const page = session.threads.list({
      ...(cursor === undefined ? {} : { cursor }),
      limit: 200,
      // 프로필을 쓰는 대화를 셀 때는 테스트 대화도 든다(이 층은 계산을 바꾸지 않는다)
      includeCraft: true,
    });
    for (const row of page.threads) {
      if (row.status !== "closed") profiles.push(row.profileId ?? null);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return profiles;
}

/** 열기 훅이 낸 경로를 정규 경로로 바꾼다. 없거나 폴더가 아니면 undefined다(H-7 `workspace_missing`) */
async function canonicalFolder(path: string): Promise<string | undefined> {
  const canonical = await canonicalWorkspace(path);
  return canonical.ok ? canonical.value : undefined;
}

/** 덧씌우기 적재를 기다리는 상한(ms). 넘으면 그 플러그인 없이 턴을 시작하고 기록을 남긴다 */
const OVERLAY_LOAD_TIMEOUT_MS = 10_000;

export function createEnginePorts(deps: PortsDeps): PortsHandle {
  const { session, store, loop, tasks, ext, logger } = deps;
  const storeId = storeIdOf(store.storeId);
  const held = new Map<ThreadId, HeldLease>();
  // 수동 컴팩션과 turn을 여는 일이 같은 thread에서 겹치지 않게 한다(HS-77, §10 미결 31)
  const gate = createThreadGate();

  const log: HostLogPort = {
    error: (message, fields) => {
      logger.error(message, toLogFields(fields));
    },
    info: (message, fields) => {
      logger.info(message, toLogFields(fields));
    },
  };

  /** Test run 대화(X-19). 만들 때 표지하고 다시 열 때도 확장 호스트에 넘긴다. 지우면 비운다 */
  const testRunThreads = new Set<ThreadId>();
  /** 같은 표지를 측정 저장소에도 적는다(규칙 32). 재시작 뒤 메모리 표지가 비어도 되살린다 */
  const testMarks = createTestRunMarks({
    store: () => deps.measure.store(),
    clock: deps.clock,
    logger,
  });
  /**
   * 이름의 플러그인이 주도할 수 있는 Registration id(drive-isolation.md 2.2). 매니페스트가 주도를 선언한 Registration을 먼저 본다.
   * 없으면 undefined다. 시작 Drive(프로필과 덧씌우기)가 함께 쓴다
   */
  function driveRegistrationOf(named: string): RegistrationId | undefined {
    const registrations = deps.ext.registrations();
    // 세대는 대화가 그 플러그인을 켤 때 열리므로 첫 열기에서는 아직 "none"일 수 있다. 매니페스트가 주도를 선언한 Registration을 먼저 본다
    const record = deps.extRead.extensions().find((one) => one.manifest.name === named);
    const declared = new Set(
      pluginDeclsOf(record?.manifest ?? {})
        .filter((decl) => decl.drives === true)
        .map((decl) => registrationIdOf({ name: named }, decl.id)),
    );
    return (
      registrations.find((info) => info.extension === named && declared.has(info.id))?.id ??
      registrations.find((info) => info.extension === named && info.drive !== "none")?.id
    );
  }

  /**
   * 대화가 참조하는 프로필의 시작 Drive(`startDrive`)를 Registration id로 푼다(drive-isolation.md 2.2).
   * 프로필을 못 읽거나 시작 Drive가 없거나 그 플러그인에 drive 등록이 없으면 undefined다(시작 요청 없음).
   * 테스트 실행의 고정 초안이 시작 Drive를 가졌으면 그 초안의 등록이 프로필의 것을 대신한다(§4.8.1 항목 2 [결정: 2026-11-18, AGE-56]).
   * 열기는 시작 요청을 하나만 받으므로 둘을 함께 걸 수 없다. 초안의 등록이 없으면 프로필의 것으로 넘어가지 않고 시작 요청이 없다
   */
  async function startDriveOf(threadId: ThreadId): Promise<RegistrationId | undefined> {
    const fixedStart = ports.m4.pluginSet
      .testRunDraftsOf(threadId)
      ?.find((mark) => mark.startDrive === true);
    if (fixedStart !== undefined) {
      const found = driveRegistrationOf(fixedStart.plugin);
      if (found === undefined) {
        logger.warn("testrun.draft_start_unavailable", {
          threadId,
          plugin: fixedStart.replaces,
        });
      }
      return found;
    }
    const stored = session.query.thread(threadId);
    const profileId = stored.ok
      ? (stored.value?.profileId ?? DEFAULT_PROFILE_ID)
      : DEFAULT_PROFILE_ID;
    const profile = await ports.m4.profileTestRun.get(profileId);
    if (!profile.ok || profile.value.startDrive === null) return undefined;
    const named = profile.value.startDrive;
    // 관리 잠금으로 빌더가 빠진 테스트 챗은 시작 Drive 없이 빈 대화로 연다(오류 아님) [결정: 2026-11-19, 사용자, AGE-60]
    if (
      profileId === CRAFT_PROFILE_ID &&
      ports.m4.pluginSet.sourceOf(threadId, named) === "managed"
    ) {
      return undefined;
    }
    const found = driveRegistrationOf(named);
    // 조용히 넘어가지 않는다: 이 대화는 시작 Drive 없이 열린다. 같은 사유는 `profile.preview`의 이슈(`driver_unavailable` 등)로도 보인다
    if (found === undefined) {
      logger.warn("profile.start_drive_unavailable", { profileId, plugin: named, threadId });
    }
    return found;
  }
  /**
   * 재시작 뒤 Drive 덧씌우기 되살리기(M5c §4.3.5). 저장된 열린 임대 가운데 프로필 밖 플러그인의 프레임을 `release` 표지로 얹는다.
   * `ext.openThread`보다 먼저 부른다: 열 때 scope가 살아 있어야 프레임이 죽은 scope로 반납되지 않는다. 검토본이 없거나 내용 해시가
   * 임대와 다르면(업데이트됨) 얹지 않는다. 그 프레임은 열 때 `restart`로 반납된다. 읽지 못하면 열 때 저장소 오류로 알린다
   */
  async function restoreDriveOverlays(threadId: ThreadId): Promise<void> {
    const snapshot = await session.ext.loadThread(threadId);
    // 읽지 못하면 얹지 않는다. 같은 읽기를 하는 `ext.openThread`가 저장소 오류로 알린다
    if (!snapshot.ok) {
      log.error("plugin.overlay.restore_unreadable", { threadId, kind: snapshot.error.kind });
      return;
    }
    // 등록 id마다 플러그인 이름. 로더가 싣지 않은 플러그인도 매니페스트 기록으로 이름을 안다
    const pluginOfScope = new Map<string, string>();
    for (const record of deps.extRead.extensions()) {
      for (const entry of pluginsOf(record.manifest)) {
        pluginOfScope.set(entry.registrationId, record.manifest.name);
      }
    }
    // 후보마다 검토본을 확인한다. 검토본이 없거나 판이 바뀌었으면 얹지 않는다(판 식별자가 다르면 같은 프레임이 아니다)
    const verified = await Promise.all(
      restorableLeasesOf(snapshot.value.openLeases, (scopeId) => pluginOfScope.get(scopeId)).map(
        async (lease): Promise<OverlayMark[]> => {
          const target = await pluginService.overlayTarget(lease.plugin);
          return target.ok && target.value?.reviewedHash === lease.contentHash
            ? [{ plugin: lease.plugin, contentHash: lease.contentHash, until: "release" }]
            : [];
        },
      ),
    );
    const marks = verified.flat();
    if (marks.length === 0) return;
    await ports.m4.pluginSet.restoreOverlay(threadId, marks);
  }

  /**
   * 재시작 뒤 테스트 실행의 고정 초안을 되살린다(M5c §4.8.1 3). 저장된 `draft_json`의 초안을 하나씩 싣고, 싣지 못한 것(폴더가 없다,
   * 내용 해시가 다르다, 싣기 실패)은 뺀 채 연다(`testrun.draft_restore_failed`로 남긴다). 대화가 열기 전에 묶인 것은 그대로 둔다.
   */
  async function restoreTestRunDrafts(threadId: ThreadId): Promise<void> {
    // 만들 때 묶은 구성이 이미 있으면(같은 프로세스에서 만든 대화를 처음 여는 것) 다시 싣지 않는다
    if (ports.m4.pluginSet.testRunDraftsOf(threadId) !== undefined) return;
    const stored = testMarks.recall(threadId);
    // 테스트 실행이 아니면 할 일이 없다
    if (stored === undefined) return;
    const listed = decodeTestRunDrafts(stored.draftJson);
    if (!listed.ok) {
      log.error("testrun.draft_restore_failed", { threadId, kind: listed.error.kind });
    }
    const wanted = listed.ok ? listed.value.drafts : [];
    // 승인 방식도 저장된 기록에서 되살린다(§4.8.1 항목 10). 기록이 깨졌으면 `ask`다
    const approval = listed.ok ? listed.value.approval : undefined;
    const restored: PreparedTestRunDrafts[] = [];
    for (const draft of wanted) {
      // 초안 하나씩 싣는다. 하나가 실패해도 나머지와 대화는 연다
      // oxlint-disable-next-line no-await-in-loop -- 되살리는 초안은 차례로 싣는다(싣기 큐와 같은 순서)
      const prepared = await testRunDrafts.prepare([
        {
          plugin: draft.plugin,
          draftId: draft.draftId,
          ...(draft.startDrive === true ? { entry: DRAFT_DRIVE_ENTRY } : {}),
        },
      ]);
      const current = prepared.ok ? prepared.value.marks[0] : undefined;
      if (!prepared.ok || current === undefined || current.contentHash !== draft.contentHash) {
        if (prepared.ok) prepared.value.unhold();
        log.error("testrun.draft_restore_failed", {
          threadId,
          plugin: draft.plugin,
          draftId: draft.draftId,
          kind: prepared.ok ? "content_changed" : prepared.error.kind,
        });
        continue;
      }
      restored.push(prepared.value);
    }
    await testRunDrafts.bind(threadId, restored, approval);
    // 못 되살린 초안이 있으면 기록도 맞춘다: 턴 기록과 표지는 실제로 돈 구성을 싣는다(승인 방식은 그대로 둔다)
    const marks = restored.flatMap((part) => part.marks);
    if (marks.length !== wanted.length) {
      testMarks.remember(
        threadId,
        stored.testBaseProfile,
        "test",
        stored.runGroupId ?? undefined,
        encodeTestRunDrafts(marks.map(draftRecordOf), approval),
      );
    }
  }

  /** Test run 대화인가. 메모리에 없으면 측정 저장소의 표지에서 되살린다(재시작 뒤) */
  function isTestRunThread(threadId: ThreadId): boolean {
    if (testRunThreads.has(threadId)) return true;
    if (testMarks.recall(threadId) === undefined) return false;
    testRunThreads.add(threadId);
    return true;
  }

  /** 모든 대화(닫힌 것 포함)를 최근순으로. Test run 표지를 붙인다(프로젝트 소속과 프로필 기본값의 원천) */
  function allThreadRows(): ProjectThreadRow[] {
    const rows: ProjectThreadRow[] = [];
    let cursor: string | undefined;
    do {
      // 테스트 대화도 본다(includeCraft). 프로젝트 계산에서 빼는 일은 다음 층이 한다
      const page = session.threads.list({
        includeClosed: true,
        includeCraft: true,
        limit: 200,
        ...(cursor === undefined ? {} : { cursor }),
      });
      for (const row of page.threads) {
        rows.push({
          threadId: row.threadId,
          workspace: row.workspace,
          status: row.status,
          profileId: row.profileId ?? null,
          updatedAt: row.updatedAt,
          testRun: isTestRunThread(row.threadId),
          craftChat: row.craftChat !== undefined,
        });
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return rows;
  }
  // 프로젝트 포트(review m5 §4.4). 설정과 저장소 폴더는 조립이 넘기고, 대화 목록은 위 원천이다
  const projects = createProjectPort({
    configDir: deps.configDir,
    dataDir: deps.dataDir,
    fileLock: deps.fileLock,
    clock: deps.clock,
    signal: deps.signal,
    ids: deps.localIds,
    settingValue: (key) => deps.settings.value(key),
    threadRows: allThreadRows,
    report: (message, fields) => {
      log.error(message, fields);
    },
    // 프로젝트를 등록하면 그 루트의 동반 플러그인을 검토 항목으로 만든다(M5c §4.4.10)
    onRegistered: () => scanOpenedAndWatch(),
  });
  /**
   * 원본 훑기의 프로젝트 루트(M5c §4.5.2): 등록된 프로젝트의 루트와 닫히지 않은 대화의 작업 폴더(Test run과 테스트 대화는 뺀다). 같은 폴더는 한 번만 준다.
   * 읽지 못한 등록 목록은 빈 목록으로 두고 로그에 남긴다(등록된 루트가 훑이지 않을 뿐 다른 훑기는 계속된다)
   */
  async function scanRootsOfProjects(): Promise<readonly DiscoverProjectRoot[]> {
    const registered = await projects.roots();
    if (!registered.ok) log.error("plugin.scan.roots_failed", { kind: registered.error.kind });
    const scope = registered.ok ? registered.value : [];
    const explicit: DiscoverProjectRoot[] = scope.map((root) => ({
      root: root.root,
      projectId: root.projectId,
    }));
    // 테스트 대화(Craft)의 작업 폴더는 플러그인 원본 폴더다. 프로젝트 루트가 아니므로 훑지 않는다(§4.8.3)
    // 닫히지 않은 대화의 작업 폴더는 가장 깊은 루트의 프로젝트에 속한다(없으면 id가 없다)
    const opened: DiscoverProjectRoot[] = allThreadRows().flatMap((row) =>
      row.testRun || row.craftChat || row.status === "closed" || row.workspace === null
        ? []
        : [{ root: row.workspace, projectId: projectIdOf(row.workspace, scope) }],
    );
    const byRoot = new Map<string, DiscoverProjectRoot>();
    for (const item of [...explicit, ...opened]) {
      if (!byRoot.has(item.root)) byRoot.set(item.root, item);
    }
    return [...byRoot.values()];
  }

  // 테스트 대화의 원본 폴더와 초안 묶기(M5c §4.8.2, §4.8.7). 저장은 세션 원천을 거친다
  const measurePort = createMeasurePort(deps.measure);
  const craftChat = createCraftChatPort({
    configDir: deps.configDir,
    store: {
      thread: (threadId) => session.query.thread(threadId),
      setCraftPlugin: (threadId, plugin, requestKey) =>
        session.threads.setCraftPlugin(threadId, plugin, requestKey),
      // 맥락 참조(`craft.context`, M5c §4.8.8): 쓰기는 대화의 쓰기 소유자가 부르고, 읽기는 모든 가지의 기록을 본다
      recordCraftContext: (threadId, payload, requestKey) =>
        session.threads.recordCraftContext(threadId, payload, requestKey),
      readContextEvents: (threadId) => readEventsOfAllBranches(session, threadId, "craft.context"),
    },
    nextKey: () => deps.ids.next("evt"),
    logger,
  });

  /**
   * 대화 폴더가 속한 프로젝트와 그 루트(`thread.started.project`). 기본 폴더 대화와 작업 폴더가 없는 대화는 null이다.
   * 어느 루트에도 없는 폴더는 프로젝트 없는 대화다(§4.4.3). 프로젝트를 만들지 않는다
   */
  async function projectOfWorkspace(
    workspace: string | undefined,
  ): Promise<{ readonly id: string; readonly root: string } | null> {
    if (workspace === undefined) return null;
    const attached = await projects.projectOf(workspace);
    if (!attached.ok) throw wireErrorOfProject(attached.error);
    if (attached.value === null) return null;
    const all = await projects.roots();
    if (!all.ok) throw wireErrorOfProject(all.error);
    const deepest = deepestRoot(workspace, all.value);
    // 확인과 읽기 사이에 프로젝트가 지워졌으면 대화를 만들지 않고 거절한다
    if (deepest === undefined || deepest.projectId !== attached.value.projectId) {
      throw wireErrorOfProject({ kind: "root_invalid" });
    }
    return { id: deepest.projectId, root: deepest.root };
  }

  const threads: ThreadPort = {
    async create(input) {
      // 작업 폴더는 정규 경로로 저장한다(HS-76). 상대 경로와 없는 폴더는 thread를 만들기 전에 거절한다
      let workspace: string | undefined;
      if (input.workspace !== undefined) {
        const canonical = await canonicalWorkspace(input.workspace);
        if (!canonical.ok) throw wireErrorOfWorkspace(canonical.error);
        workspace = canonical.value;
      }
      // 같은 creationKey의 재생이면 세션이 처음 thread의 id를 돌려준다. 여기서 발급한 id는 쓰이지 않고 버려진다
      const threadId = deps.ids.next("thr");
      // 작업 폴더가 없으면 기본 폴더 아래 `<threadId>` 폴더를 만든다(review m5 §4.4.5). 재생이면 빈 폴더 하나가 남는다
      if (workspace === undefined && input.defaultFolder === true) {
        const folder = await projects.defaultWorkspace(threadId);
        if (!folder.ok) throw wireErrorOfProject(folder.error);
        workspace = folder.value;
      }
      // 소속은 thread.started가 싣는다(§4.4.2). `thread.create`만 정한다(`attachProject`). 시험 대화는 프로젝트 묶음에서 뺀다(§4.8).
      // 열기 훅이 폴더를 바꾸면 이 값과 나중의 `projectOf`가 다를 수 있다 [미결]
      let project: { readonly id: string; readonly root: string } | null | undefined;
      if (input.attachProject === true) {
        project = input.testRun === true ? null : await projectOfWorkspace(workspace);
      }
      const created = session.threads.create({
        threadId,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(workspace === undefined ? {} : { workspace }),
        ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
        ...(input.creationKey === undefined ? {} : { creationKey: input.creationKey }),
        ...(input.craftChat === undefined ? {} : { craftChat: input.craftChat }),
        ...(project === undefined ? {} : { project }),
      });
      if (!created.ok) throw wireErrorOfCreate(created.error, "threads.create failed");
      if (input.testRun === true) {
        testRunThreads.add(created.value.threadId);
        // 범위 표지는 계측 설정과 무관하게 쓴다(`tr_thread.scope_kind = test`)
        testMarks.remember(created.value.threadId, null);
      }
      // 테스트 대화의 턴은 `scope_kind = craft`로 적어 지표 기본 필터에서 뺀다(M5c §4.8.9, 규칙 36)
      if (input.craftChat !== undefined) testMarks.remember(created.value.threadId, null, "craft");
      const head = session.feed.headSeq();
      if (!head.ok) throw wireErrorOfStore(head.error, "threads.create position");
      return { threadId: created.value.threadId, position: { storeId, seq: head.value } };
    },
    exists(threadId) {
      const found = session.query.thread(threadId);
      return found.ok ? ok(found.value !== undefined) : found;
    },
    titleOf(threadId) {
      const found = session.query.thread(threadId);
      return found.ok
        ? ok(found.value === undefined ? undefined : { title: found.value.title })
        : found;
    },
    workspaceOf(threadId) {
      const found = session.query.thread(threadId);
      return found.ok ? ok(found.value?.workspace ?? null) : found;
    },
    isCraftChat(threadId) {
      const found = session.query.thread(threadId);
      return found.ok ? ok(found.value?.craftChat !== undefined) : found;
    },
    lastTurnIdOf(threadId) {
      const found = session.query.thread(threadId);
      return found.ok ? ok(found.value?.lastTurnId ?? null) : found;
    },
    async list(params) {
      // 필터는 저장된 값(정규 경로)과 같은 형태로 견준다(HS-76)
      let workspace: string | undefined;
      if (params.workspace !== undefined) {
        const filter = await workspaceFilterOf(params.workspace);
        if (!filter.ok) throw wireErrorOfWorkspace(filter.error);
        workspace = filter.value;
      }
      const page = session.threads.list({
        ...(workspace === undefined ? {} : { workspace }),
        ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
        ...(params.limit === undefined ? {} : { limit: params.limit }),
        // 테스트 대화는 `include: "craft"`일 때만 낸다(M5c §4.8.3)
        ...(params.include === "craft" ? { includeCraft: true } : {}),
      });
      const summaries: ThreadSummary[] = [];
      // 기록은 읽은 뒤에만 보인다. 읽지 못하면(저장소 실패) 출처를 모르는 것이라 싣지 않는다
      const scheduleLoaded = await deps.schedule.open();
      const origins = scheduleLoaded.ok
        ? scheduleOriginsOf(deps.schedule)
        : new Map<string, string>();
      for (const listed of page.threads) {
        // 위임으로 만든 자식 thread의 열린 turn은 요청의 맥락 없이 이어 끝낼 수 없다. 부모가 같은 requestId로 다시 부를 때만 이어지므로
        // 재개 후보(`resumable`)에서 뺀다(L1.loop.spec §4.13)
        let row = listed;
        const link = session.query.agentOfChild(row.threadId);
        if (!link.ok) throw wireErrorOfStore(link.error, "thread.list child lookup");
        if (row.marker !== null && link.value !== undefined) row = { ...row, marker: null };
        // 열린 turn의 표식이 있는데 이 프로세스에 그 turn의 범위가 없으면 turn은 이미 멈췄다(강제 종료 뒤 재시작). 저장된 상태는 running으로
        // 남아 있으므로 idle로 알려 화면이 거짓 "실행 중"을 그리지 않게 한다. 표식은 그대로라 "이어서 실행"은 남는다
        const stale =
          row.status === "running" &&
          listed.marker !== null &&
          tasks.find("turn", listed.marker.turnId) === undefined;
        const summary = threadSummaryOf(stale ? { ...row, status: "idle" } : row);
        if (!summary.ok) {
          throw wireError("internal", {
            message: `thread.list: ${summary.error.field} of ${row.threadId} is not a valid time`,
          });
        }
        const scheduleId = origins.get(row.threadId);
        const spawnedBy: Pick<ThreadSummary, "spawnedBy"> =
          link.value === undefined
            ? {}
            : {
                spawnedBy: {
                  threadId: link.value.parentThreadId,
                  kind: link.value.ownerKind === "scope" ? "internal" : "subagent",
                },
              };
        summaries.push({
          ...summary.value,
          ...spawnedBy,
          ...(scheduleId === undefined ? {} : { origin: { kind: "schedule", scheduleId } }),
        });
      }
      return { threads: summaries, nextCursor: page.nextCursor };
    },
    async fork(threadId, at) {
      const forked = await session.threads.fork(threadId, at, deps.ids.next("thr"));
      if (!forked.ok) return forked;
      const head = session.feed.headSeq();
      if (!head.ok) return head;
      return ok({ threadId: forked.value.threadId, position: { storeId, seq: head.value } });
    },
    async applyOpenWorkspace(threadId) {
      // 열기마다 새 키다. 같은 키로 다른 폴더를 쓰면 key_reused라서 호출 한 번이 커밋 한 번이다
      const applied = await session.threads.applyOpenWorkspace(
        threadId,
        canonicalFolder,
        deps.ids.next("evt"),
      );
      if (!applied.ok) {
        logger.warn("host.open_workspace_failed", { threadId, reason: applied.error.kind });
        return;
      }
      for (const diagnostic of applied.value.diagnostics) {
        logger.warn(`hook.${diagnostic.code}`, { threadId, candidate: diagnostic.candidate });
      }
    },
    sameFolder(threadId) {
      const found = session.threads.sameFolder(threadId);
      if (!found.ok) {
        logger.warn("host.same_folder_unreadable", { threadId, reason: found.error.kind });
        return [];
      }
      return found.value.map((thread) => ({ threadId: thread.threadId, status: thread.status }));
    },
    async revert(threadId, to) {
      // 되감기마다 새 키다: 같은 키로 다시 부르면 처음 결과를 돌려주므로 호출 한 번이 한 번의 되감기다
      const reverted = await session.threads.revert(threadId, to, deps.ids.next("evt"));
      if (!reverted.ok) return reverted;
      return ok({
        leaf: reverted.value.leaf,
        position: { storeId, seq: reverted.value.headSeq },
      });
    },
    openTurnOf(threadId) {
      const open = session.query.openTurn(threadId);
      if (!open.ok) return open;
      return ok(open.value?.turnId);
    },
    closed(threadId) {
      const found = session.query.thread(threadId);
      if (!found.ok) return found;
      return ok(found.value?.status === "closed");
    },
    async leafOf(threadId) {
      // 활성 가지는 루트에서 leaf 순서로 나온다. 마지막 이벤트가 현재 leaf다
      let leaf: EventId | null = null;
      for await (const item of session.readBranch(threadId)) {
        if (!item.ok) return err(item.error);
        leaf = item.value.id;
      }
      return ok(leaf);
    },
    async restoreLeaf(threadId, target) {
      // 되돌리기마다 새 키다. 파일 되돌리기가 대화를 되감기 직전으로 돌릴 때만 부른다(L1.persistence §4.13.2)
      const moved = await session.threads.moveLeaf(threadId, target, {
        reason: "restore",
        requestKey: deps.ids.next("evt"),
      });
      if (!moved.ok) return moved;
      return ok({ position: { storeId, seq: moved.value.headSeq } });
    },
    rename(threadId, title) {
      // 제목마다 새 키다: 같은 키로 다른 제목을 쓰면 key_reused라 호출 한 번이 제목 한 번이다
      const renamed = session.threads.setTitle(threadId, title, deps.ids.next("evt"), "user");
      if (!renamed.ok) return renamed;
      const head = session.feed.headSeq();
      if (!head.ok) return head;
      return ok({ position: { storeId, seq: head.value } });
    },
    setModel(threadId, model) {
      // 호출마다 새 키다: 같은 키로 다른 모델을 쓰면 key_reused라 호출 한 번이 모델 한 번이다
      const set = session.threads.setModel(threadId, model, deps.ids.next("evt"));
      if (!set.ok) return set;
      const head = session.feed.headSeq();
      if (!head.ok) return head;
      return ok({ position: { storeId, seq: head.value } });
    },
    setProfile(threadId, profileId) {
      // 호출마다 새 키다: 같은 키로 다른 프로필을 쓰면 key_reused라 호출 한 번이 전환 한 번이다
      const set = session.threads.setProfile(threadId, profileId, deps.ids.next("evt"));
      if (!set.ok) return set;
      const head = session.feed.headSeq();
      if (!head.ok) return head;
      return ok({ position: { storeId, seq: head.value } });
    },
    async switchStartDrive(threadId) {
      const found = session.query.thread(threadId);
      if (!found.ok) return found;
      if (found.value === undefined)
        return ok({ startDrive: "rejected", reason: "unknown_thread" });
      // 첫 메시지 전의 빈 대화: turn도 큐에 든 입력도 없다. 이때는 시작 Drive가 첫 메시지를 받는다(AGE-47)
      const fresh = found.value.lastTurnId === null && found.value.queuedInputs === 0;
      const scopeId = await startDriveOf(threadId);
      // 스택을 어떻게 바꿀지(메시지를 받지 않은 시작 Drive만 내린다, 일하는 Drive는 끝난 뒤 바꾼다)는 엔진이 정한다(X.primitives §4.4.1c)
      const switched = deps.ext.switchStartDrive(threadId, scopeId ?? null, fresh);
      if (!switched.ok) {
        logger.warn("profile.switch_start_drive_rejected", { threadId, kind: switched.error.kind });
        const reason = startDriveRejectReasonOf(switched.error.kind);
        return ok(
          reason === undefined ? { startDrive: "rejected" } : { startDrive: "rejected", reason },
        );
      }
      return ok({ startDrive: switched.value });
    },
    hasTitle(threadId) {
      const found = session.query.thread(threadId);
      if (!found.ok) return found;
      const title = found.value?.title ?? null;
      return ok(title !== null && title !== "");
    },
    title(threadId) {
      const found = session.query.thread(threadId);
      if (!found.ok) return found;
      return ok(found.value?.title ?? null);
    },
    async remove(threadId) {
      const removed = session.threads.remove(threadId);
      if (!removed.ok) return removed;
      testRunThreads.delete(threadId);
      await dropHeldThread(threadId);
      await deps.toolOutputs.removeThread(threadId);
      return removed;
    },
    read(params) {
      // 쪽 질의는 L1.persistence가 세션 서비스에 딸려 내놓는다. 그 서비스가 아닌 구현이 들어왔다면 조립이 틀린 것이다
      const itemPages = itemPagesOf(session);
      if (itemPages === undefined) {
        throw new Bug("host.item_pages_missing: fresnel.session has no item page query");
      }
      return readThread(itemPages, storeId, params);
    },
    position() {
      const head = session.feed.headSeq();
      return head.ok ? ok({ storeId, seq: head.value }) : head;
    },
    // 요약(모델 호출, 수 초)과 커밋이 끝날 때까지 같은 thread의 `turn.start`·`turn.resume`은 기다린다
    compact: (threadId, instructions, signal) =>
      gate.run(threadId, async () => {
        const found = session.query.thread(threadId);
        if (!found.ok) return found;
        if (found.value === undefined) return err({ kind: "thread_not_found", threadId });
        if (found.value.status === "closed") return err({ kind: "thread_closed", threadId });
        // 열린 turn이 있는 동안 컴팩션을 커밋하면 루프가 쥔 가지 끝과 어긋난다. turn 사이에서만 한다(HS-77)
        const running = loop.threadStatus(threadId).runningTurnId;
        if (running !== null) return err({ kind: "turn_running", turnId: running });
        const resolved = deps.models.resolve("main", {});
        if (!resolved.ok) return err({ kind: "model_unavailable", detail: resolved.error.kind });
        const compacted = await deps.context.compact(threadId, {
          reason: "manual",
          binding: resolved.value.binding,
          contextWindow: resolved.value.model.contextWindow,
          ...(instructions === undefined ? {} : { instructions }),
          willRetry: false,
          signal,
        });
        if (!compacted.ok) return err({ kind: "context_failed", error: compacted.error });
        return ok(compacted.value);
      }),
  };

  /** 테스트 대화의 상주 시작 Drive(M5c §4.8.6)가 쓰는 의존. 주도 스택은 엔진의 임대 목록에서 읽는다 */
  const residentDriveDeps: ResidentDriveDeps = {
    isCraftChat: (threadId) => {
      const found = threads.isCraftChat(threadId);
      if (found.ok) return found.value;
      log.error("craft.drive_read_failed", { threadId, kind: found.error.kind });
      return false;
    },
    framePlugins: (threadId) =>
      deps.ext
        .driveFrames(threadId)
        .flatMap((frame) => (frame.plugin === null ? [] : [frame.plugin])),
    startDriveOf,
    startDrive: (threadId, scopeId, requested) => deps.ext.startDrive(threadId, scopeId, requested),
    report: (message, fields) => {
      log.error(message, fields);
    },
  };

  /** `turns.submit`의 본문. 같은 thread의 컴팩션과 겹치지 않게 부르는 쪽이 gate 안에서 부른다 */
  async function submitInput(
    threadId: ThreadId,
    input: TurnStartInput,
    requestId: string | undefined,
    whenBusy: WhenBusy | undefined,
    invoked: readonly TurnInvoked[] | undefined,
  ): Promise<SubmitOutcome> {
    // 같은 requestId의 재제출은 처음 turnId를 돌려준다(HS-22, F wire turn.start)
    if (requestId !== undefined) {
      const existing = session.query.turnByRequestId(threadId, null, requestId);
      if (!existing.ok) return { ok: false, reason: "rejected", error: existing.error };
      if (existing.value !== undefined) return { ok: true, turnId: existing.value.turnId };
    }
    const running = loop.threadStatus(threadId).runningTurnId;
    // whenBusy가 없으면 큐에 넣지 않고 거절한다(호환). 있으면 루프가 그 자리의 큐에 넣는다(L1.loop.spec §4 admit)
    if (running !== null && whenBusy === undefined) {
      return { ok: false, reason: "busy", turnId: running };
    }
    // 테스트 대화는 입력을 받기 전에 주도 프레임이 있어야 한다(M5c §4.8.6). 요청은 입력 접수 앞에 큐에 든다
    await ensureResidentDrive(residentDriveDeps, threadId);
    const admitted = await loop.admit({
      threadId,
      content: input,
      ...(requestId === undefined ? {} : { requestId }),
      via: "interactive",
      ...(whenBusy === undefined ? {} : { whenBusy }),
      ...(invoked === undefined || invoked.length === 0 ? {} : { invoked }),
    });
    // 저장소 부족·소유 상실 같은 실패는 예상 가능하다. 결함(Bug)으로 올리지 않고 처리기가 와이어 오류로 옮기게 돌려준다
    if (!admitted.ok) return { ok: false, reason: "rejected", error: admitted.error };
    const outcome = admitted.value;
    switch (outcome.status) {
      case "started":
        return { ok: true, turnId: outcome.turnId };
      case "duplicate":
        if (outcome.turnId !== null) return { ok: true, turnId: outcome.turnId };
        // 같은 requestId로 이미 큐에 든 입력의 재제출이다. 아직 turn이 없으므로 지금 실행 중인 turn 뒤에 있다고 답한다
        if (whenBusy !== undefined && running !== null) {
          return { ok: true, turnId: running, queued: true };
        }
        throw new Bug("loop.admit returned a duplicate without a turn");
      case "queued":
        // 유휴 thread에서 queued가 나오는 것은 input 훅이 입력을 보류했을 때다. 접수된 turn이 없다
        if (outcome.runningTurnId !== null) {
          if (whenBusy !== undefined)
            return { ok: true, turnId: outcome.runningTurnId, queued: true };
          return { ok: false, reason: "busy", turnId: outcome.runningTurnId };
        }
        throw new Bug("loop.admit queued the input without a running turn");
      case "handled":
        // 주도 중인 플러그인이 받았거나 input 훅이 처리를 끝냈다. 접수는 됐고 turn은 아직 없다
        return { ok: true, delivered: true };
      default:
        return assertNever(outcome, "AdmitResult");
    }
  }

  /**
   * `turn.withdraw`(W-17). 요청 키가 맞는 대기 입력을 그 입력 id로 거둔다. 배치된 입력은 대기열에 없으므로 거두지 않는다(`false`).
   * 같은 입력을 두 번 거두면 두 번째는 `false`다(철회 커밋이 입력 id에 묶여 있다)
   */
  async function withdrawByRequest(
    threadId: ThreadId,
    requestId: string,
  ): Promise<Result<boolean, WithdrawFailure>> {
    const queued = session.query.queuedInputs(threadId);
    if (!queued.ok) return err(queued.error);
    const input = queued.value.find((view) => view.requestId === requestId);
    if (input === undefined) return ok(false);
    const withdrawn = await tasks.inputs.withdraw(threadId, input.inputId, "user");
    if (!withdrawn.ok) return err(withdrawn.error);
    return ok(withdrawn.value > 0);
  }

  const turns: TurnPort = {
    // 같은 thread의 수동 컴팩션이 도는 동안은 기다렸다가 제출한다(HS-77, §10 미결 31)
    submit: (threadId, input, requestId, whenBusy, invoked) =>
      gate.run(threadId, () => submitInput(threadId, input, requestId, whenBusy, invoked)),
    interrupt: (threadId, turnId) => loop.interrupt(threadId, turnId),
    resume: (threadId) => gate.run(threadId, () => loop.resume(threadId)),
    stopAtSafeBoundary: (deadlineMs) => loop.stopAtSafeBoundary(deadlineMs),
    isLive: (threadId) => loop.threadStatus(threadId).runningTurnId !== null,
    withdraw: withdrawByRequest,
  };

  const feed: EventFeedPort = {
    headSeq: () => session.feed.headSeq(),
    oldestReplayableSeq: () => session.feed.oldestReplayableSeq(),
    read: (after, upto, filter, limit, scanLimit) =>
      session.feed.read(after, upto, filter, limit, scanLimit),
    onCommit: (listener) => session.feed.onCommit(listener),
    onVolatile: (listener) => session.feed.onVolatile(listener),
  };

  function onLeaseLost(threadId: ThreadId): void {
    // HS-29: 소유를 잃으면 그 thread의 쓰기를 멈춘다. 의도는 쓰지 않는다(쓸 권한이 없다)
    const lost = held.get(threadId);
    held.delete(threadId);
    lost?.alive[Symbol.dispose]();
    log.error("lease.lost", { threadId });
    const scope = tasks.find("thread", threadId);
    if (scope !== undefined) {
      tasks
        .abort(scope, { code: "lease_lost", message: null }, { background: true })
        .catch((caught: unknown) => {
          log.error("lease.lost_abort_failed", { threadId, message: messageOf(caught) });
        });
    }
  }

  /**
   * 지운 thread의 임대를 거둔다. `session.threads.remove`는 호스트가 준 토큰을 반납하지 않는다(호스트가 반납한다, L1.persistence ownership).
   * 이벤트가 없으므로 `thread.shutdown`은 발화하지 않고 확장의 thread 상태만 닫는다
   */
  async function dropHeldThread(threadId: ThreadId): Promise<void> {
    const lease = held.get(threadId);
    if (lease === undefined) return;
    held.delete(threadId);
    lease.alive[Symbol.dispose]();
    try {
      await ext.closeThread(threadId);
    } finally {
      ports.m4.pluginSet.forget(threadId);
      const released = store.leases.release(lease.token);
      if (!released.ok) log.error("lease.release_failed", { threadId, kind: released.error.kind });
    }
  }

  /**
   * `acquireFresh`가 세션을 연 뒤 실패했을 때 되돌린다(`openThread` 실패, `restore` 실패). 단계마다 따로 감싸서 하나가 실패해도
   * 나머지(`closeThread`, 임대 반납)가 돈다. 정리 중 오류는 원래 실패를 가리지 않도록 기록만 한다
   */
  async function abandonOpened(
    threadId: ThreadId,
    token: LeaseToken,
    alive: Disposable,
  ): Promise<void> {
    alive[Symbol.dispose]();
    const released = await attemptAsync(() => session.release(threadId, "quit"));
    if (!released.ok) {
      log.error("thread.open_cleanup_failed", {
        threadId,
        step: "session.release",
        message: messageOf(released.error.cause),
      });
    }
    const closed = await attemptAsync(() => ext.closeThread(threadId));
    if (!closed.ok) {
      log.error("thread.open_cleanup_failed", {
        threadId,
        step: "ext.closeThread",
        message: messageOf(closed.error.cause),
      });
    }
    // 열지 못한 대화가 얹은 덧씌우기(재시작 복원)와 적재 참조를 놓는다(M5c §4.1.11)
    ports.m4.pluginSet.forget(threadId);
    const lease = store.leases.release(token);
    if (!lease.ok) log.error("lease.release_failed", { threadId, kind: lease.error.kind });
  }

  async function releaseThread(threadId: ThreadId): Promise<void> {
    const lease = held.get(threadId);
    if (lease === undefined) return;
    held.delete(threadId);
    lease.alive[Symbol.dispose]();
    try {
      await session.release(threadId, "quit");
      await ext.closeThread(threadId);
    } finally {
      // 대화가 닫혔다. 이 대화가 쓰던 플러그인의 참조를 놓는다(M5c §4.1.11). 쥐었던 대화마다 한 번이다
      ports.m4.pluginSet.forget(threadId);
      const released = store.leases.release(lease.token);
      if (!released.ok) log.error("lease.release_failed", { threadId, kind: released.error.kind });
    }
  }

  /** 같은 thread의 획득이 진행 중이면 그 결과를 함께 기다린다: 같은 프로세스의 두 연결이 자기 자신과 잠금을 다투지 않게 한다(HS-23) */
  const acquiring = new Map<ThreadId, Promise<LockOutcome>>();

  async function acquireFresh(threadId: ThreadId, kind: OwnerKind): Promise<LockOutcome> {
    const current = held.get(threadId);
    if (current !== undefined) {
      return { ok: true, token: current.token, release: () => releaseThread(threadId) };
    }
    // 신뢰한 작업 폴더의 project·local 설정을 읽어 둔다. 자원(임대)을 쥐기 전에 해서 실패해도 정리할 것이 없다
    await settings.prepare(threadId);
    await deps.afterSettingsPrepare?.(threadId);
    // 이 thread의 작업 폴더가 신뢰되어 있으면 그 프로젝트의 확장을 싣는다(모든 호스트 모드. 결정이 없으면 클라이언트가 trust.decide로 정한 뒤 싣는다)
    await deps.projectExtensions.ensure(deps.workspaceOf(threadId), deps.signal);
    const acquired = store.leases.acquire(`thread:${threadId}`, { ...deps.holder, kind });
    if (!acquired.ok) {
      const error = acquired.error;
      if (error.kind === "lock_busy") return { ok: false, ownerKind: error.owner?.kind ?? null };
      // lock_io·busy·disk_full은 환경 문제다. 결함이 아니므로 store.* 와이어 오류로 알린다
      throw wireErrorOfLease(error, "lease.acquire failed");
    }
    const token = acquired.value;
    const opened = session.openForWrite(threadId, token);
    if (!opened.ok) {
      store.leases.release(token);
      // guard_mismatch는 토큰과 thread가 맞지 않는 호출 결함이다. 나머지는 예상 가능한 실패다
      if (opened.error.kind === "guard_mismatch") {
        throw new Bug("session.openForWrite: lease token does not match the thread", {
          cause: opened.error,
        });
      }
      throw wireErrorOfStore(opened.error, "session.openForWrite failed");
    }
    // 열 때 복구(L4.host-service.spec §4.1 7단계, L1.persistence.spec §4.8.1): 이전 프로세스가 남긴 결과 불명 효과를 합성 결과로 닫는다.
    // 실행은 시작하지 않는다. 재실행 후보와 열린 turn은 그대로 두고 재개·새 입력이 이어받는다
    const recovered = session.recover(threadId, {
      toolReplay: (name) => deps.tools.meta(name)?.replay ?? null,
      cancelledByOwner: cancelledByOwnerOf(session),
      hostMode: deps.mode,
    });
    if (!recovered.ok) {
      store.leases.release(token);
      throw wireErrorOfStore(recovered.error, "session.recover failed");
    }
    const alive = store.leases.keepAlive(token, () => {
      onLeaseLost(threadId);
    });
    try {
      // 테스트 실행의 고정 초안을 되살린다(열 때 실린 초안이 있어야 대화의 집합이 맞는다)
      await restoreTestRunDrafts(threadId);
      // 재시작 뒤 Drive 덧씌우기를 되살린다. 프레임이 열 때 scope를 찾도록 `ext.openThread`보다 먼저 한다
      await restoreDriveOverlays(threadId);
      const testRun = isTestRunThread(threadId);
      const startDrive = await startDriveOf(threadId);
      await ext.openThread(
        threadId,
        testRun || startDrive !== undefined
          ? {
              ...(testRun ? { testRun: true } : {}),
              ...(startDrive === undefined ? {} : { startDrive }),
            }
          : undefined,
      );
    } catch (caught) {
      await abandonOpened(threadId, token, alive);
      // 확장 상태를 읽지 못한 것(busy, io, 손상 행)은 저장소 오류로 알린다. 빈 상태로 열면 켜짐과 상태 판을 잃는다
      if (caught instanceof PrimitiveError && caught.code === "storage_unavailable") {
        throw wireError("store.io", {
          message: `ext.openThread failed: ${caught.message}`.slice(0, 200),
          details: { code: "ext_state_unreadable" },
        });
      }
      throw caught;
    }
    // 이전 프로세스가 남긴 미해결 승인 요청을 메모리 대기 목록으로 되살린다. approval.respond가 재시작 뒤에도 그 요청을 찾는다(HOST.4)
    const restored = await deps.approvals.restore(threadId);
    if (!restored.ok) {
      // 세션과 확장 상태가 이미 열렸다. 임대만 놓으면 열린 것이 남으므로 닫고 놓는다
      await abandonOpened(threadId, token, alive);
      throw wireErrorOfStore(restored.error, "approvals.restore failed");
    }
    held.set(threadId, { token, alive });
    // 열린 대화의 E(T)를 맞추고, 이 대화가 쓰는 플러그인이 실릴 때까지 기다린다(M5c §4.1.11)
    await ports.m4.pluginSet.opened(threadId);
    return { ok: true, token, release: () => releaseThread(threadId) };
  }

  const locks: SessionLockPort = {
    tryAcquire(threadId, kind: OwnerKind): Promise<LockOutcome> {
      const pending = acquiring.get(threadId);
      if (pending !== undefined) return pending;
      const started = acquireFresh(threadId, kind).finally(() => {
        acquiring.delete(threadId);
      });
      acquiring.set(threadId, started);
      return started;
    },
    holds: (threadId) => held.has(threadId),
    release: (threadId) => releaseThread(threadId),
  };

  const settings: SettingsStorePort = createSettingsStore({
    engine: deps.settings,
    session,
    configDir: deps.configDir,
    fileLock: deps.fileLock,
    trust: deps.trust,
    ids: deps.ids,
    logger: logger.child({ component: "settings" }),
    signal: deps.signal,
    holds: (threadId) => held.has(threadId),
  });

  /** 신뢰가 바뀐 뒤: 작업 폴더의 project·local 층을 다시 읽고 알린 뒤 허용된 프로젝트 확장을 싣는다(결정과 지우기가 같이 쓴다) */
  const afterTrustChanged = async (workspace: string, signal: AbortSignal): Promise<void> => {
    // 신뢰가 바뀌었으므로 작업 폴더의 project·local 층을 다시 판정해 읽는다. 쥔 thread는 지금 바로 다시 읽는다
    deps.settings.clearWorkspaceFiles();
    await sequentially(Array.from(held.keys()), async (threadId) => {
      await settings.prepare(threadId);
      await deps.afterSettingsPrepare?.(threadId);
    });
    // 어느 키가 바뀌었는지 모르는 변경이다(keys가 빈 알림, F wire §3.3.2)
    deps.settings.notifyChanged({ keys: [], scopes: ["project", "local"], threadId: null });
    // 허용된 작업 폴더의 프로젝트 확장을 지금 싣는다(모든 호스트 모드)
    await deps.projectExtensions.ensure(workspace, signal);
  };

  const trust: TrustPort = {
    async list() {
      const listed = await deps.trust.list();
      if (!listed.ok) {
        return err({
          kind: "store_unreadable",
          reason: listed.error.kind === "corrupt" ? "corrupt" : "io",
        });
      }
      // 옛 형식 항목은 `savedAt`이 없다. 키를 만들지 않아야 `exactOptionalPropertyTypes`가 맞는다
      return ok({
        entries: listed.value.map((entry) =>
          entry.savedAt === undefined
            ? { path: entry.path, verdict: entry.verdict }
            : { path: entry.path, verdict: entry.verdict, savedAt: entry.savedAt },
        ),
      });
    },
    async get(workspace, signal) {
      if (!isAbsolute(workspace)) return err({ kind: "workspace_not_absolute" });
      return ok(trustStatusOf(await deps.trust.inspect(workspace, signal)));
    },
    async decide(workspace, choice, signal) {
      if (!isAbsolute(workspace)) return err({ kind: "workspace_not_absolute" });
      const decided = await deps.trust.decide(workspace, choice, signal);
      if (!decided.ok) return decided;
      await afterTrustChanged(workspace, signal);
      return ok(trustStatusOf(decided.value));
    },
    async remove(workspace, signal) {
      if (!isAbsolute(workspace)) return err({ kind: "workspace_not_absolute" });
      const removed = await deps.trust.remove(workspace, signal);
      if (!removed.ok) return removed;
      await afterTrustChanged(workspace, signal);
      return ok(trustStatusOf(removed.value));
    },
  };

  const approvals: ApprovalPort = createApprovalPort({
    approvals: deps.approvals,
    session,
    storeId,
    heldThreads: () => Array.from(held.keys()),
  });

  const activity: ActivityPort = {
    snapshot() {
      const snapshot = tasks.activity();
      return {
        liveTurns: snapshot.liveTurns,
        // 켜진 루프는 백그라운드 작업으로 센다(M3-10)
        liveTasks: snapshot.liveTasks + deps.schedule.liveSchedulerTasks(),
        // 대기 예약은 유휴 종료 판정이 쓴다. 승인 대기는 이 프로세스가 쥔 thread의 미해결 요청이다
        waitingApprovals: Array.from(held.keys()).reduce(
          (sum, threadId) => sum + deps.approvals.pending(threadId).length,
          0,
        ),
        pendingSchedules: deps.pendingSchedules?.count() ?? deps.schedule.pendingSchedules(),
      };
    },
    onChange: (listener) => {
      const offTasks = tasks.onActivity(listener);
      const offSchedules = deps.pendingSchedules?.onChange(listener);
      const offSchedule = deps.schedule.onChange(listener);
      return () => {
        offTasks();
        offSchedules?.();
        offSchedule();
      };
    },
  };

  // 큐에 남았지만 읽을 수 없는 입력은 조용히 남지 않게 사용자 알림(`dialog.notify`, 내구 `dialog.notified`)으로 알린다.
  // 알림 서비스가 아직 없으면 로그만 남고(L1.tasks가 이미 남겼다), 같은 입력은 requestId로 한 번만 기록된다
  tasks.inputs.onUnreadable((input) => {
    const api = deps.commands.notify;
    if (api === undefined) return;
    detach(
      api.emit(unreadableInputNotice(input.reason), {
        requestId: `unreadable:${input.inputId}`.slice(0, 64),
        context: { threadId: input.threadId, caller: { kind: "host" } },
      }),
      (cause) => {
        log.error("notify.unreadable_input_failed", {
          threadId: input.threadId,
          message: messageOf(cause),
        });
      },
    );
  });

  const notify: UserNotifyPort = {
    async show(input) {
      const result = await deps.os.notify(
        {
          kind: "done",
          title: input.title.slice(0, 80),
          body: input.body.slice(0, 400),
          ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        },
        deps.signal,
      );
      if (!result.ok && result.error.kind !== "disabled") {
        log.error("notify.failed", { kind: result.error.kind });
      }
    },
  };

  // 시작 때 알린 일은 저장소가 열린 뒤 정해져 엔진이 뜬 동안 바뀌지 않는다. 호출마다 복사본을 준다
  const startupNotices: readonly StartupNotice[] = deps.startupNotices ?? [];
  // 플러그인 읽기 서비스(M5c §3.4)와 검토 서비스(§4.7, §4.9). 프로필 목록은 M4 포트가 쥔 것을 부를 때마다 읽는다(`ports`는 아래에서 채워진다)
  const pluginService = createPluginService({
    configDir: deps.configDir,
    projectRoots: scanRootsOfProjects,
    // 관리 폴더는 아직 조립되지 않았다
    managedDir: null,
    bundleDir: deps.defaultPluginsDir,
    records: () => deps.extRead.extensions(),
    profiles: { list: () => ports.m4.profileTestRun.list() },
    store: deps.pluginStore,
    ...(deps.toolStatusOf === undefined ? {} : { toolStatusOf: deps.toolStatusOf }),
    // 느슨한 스킬 폴더는 옮긴 뒤에도 원본으로 남는다(제거 항목을 만들지 않게 이름만 본다)
    looseSkillsDir: userSkillsDir(deps.dataDir),
    log,
  });
  // 사용자 플러그인 폴더(`<config>/plugins`). 읽기 서비스, 한 줄 지침(§4.10), 마이그레이션 제출(§7.5)이 같이 본다
  const userPluginsDir = join(deps.configDir, "plugins");
  // 설치된 플러그인 사실(AGE-33 의존 검사). 읽기 서비스와 프로필 검증이 보는 목록과 같은 원천이다
  const installedFacts = () =>
    deps.extRead.extensions().map((record) => pluginFactOf(record.manifest, record.location));
  // 앱의 편집 통신이 쓴 폴더의 해시 장부. 제작 포트가 적고 검토 서비스가 읽는다(AGE-33)
  const appEdits = createAppEditLedger();
  const pluginReview = createPluginReview({
    appEdits,
    store: deps.pluginStore,
    plugins: pluginService,
    profiles: { list: () => ports.m4.profileTestRun.list() },
    // 한 줄 지침(§4.10)이 쓰는 사용자 플러그인 폴더. 읽기 서비스가 보는 것과 같다
    userDir: userPluginsDir,
    ids: deps.localIds,
    now: () => new Date(deps.clock.now()).toISOString(),
    log: deps.logger,
    envSandboxed: () => deps.settings.value("l0.sandbox.sandboxImportedHooks") === true,
    narrowDrafts: () => deps.settings.value("l0.sandbox.narrowDrafts") === true,
    facts: installedFacts,
    // 제거 미리 보기가 전용 저장소에 값이 있는지 부를 때만 읽는다(저장소 포트가 사용량을 안 주면 "없음"으로 본다)
    pluginData: {
      usage: (name) =>
        deps.pluginDataStore.usage?.(name) ?? Promise.resolve(err({ kind: "storage_unavailable" })),
    },
    // 승인의 프로필 반영과 커밋 뒤 실행 중인 판 맞추기(M5c §4.7.3, §4.6.7). 프로필과 플러그인 집합은 엔진 포트가 올라온 뒤에 읽는다
    approvalHooks: approvalHooksOf({
      profiles: {
        checkPluginEdit: (request) => ports.m4.profileTestRun.checkPluginEdit(request),
        applyPluginEdit: (request) => ports.m4.profileTestRun.applyPluginEdit(request),
      },
      loader: () => deps.extRead.loader(),
      refreshPluginSet: () => ports.m4.pluginSet.refresh(),
      pluginDataStore: deps.pluginDataStore,
      facts: installedFacts,
      log: deps.logger,
    }),
    // 돌려보내기 사유를 만든 대화의 다음 입력으로 넣는다(입력 큐, 사용자가 보낸 것으로 기록한다 [제안])
    notifyOrigin: async ({ threadId, reason, itemId }) => {
      if (!isId("thr", threadId)) return false;
      const found = session.query.thread(threadId);
      if (!found.ok || found.value === undefined) return false;
      const queued = await attemptAsync(() =>
        tasks.inputs.enqueue({
          threadId,
          mode: "next",
          item: { kind: "user", content: reason },
          requestId: `plugin-review-${itemId}`,
          source: { type: "user", via: "rpc" },
        }),
      );
      if (!queued.ok) {
        deps.logger.error("plugin.review.notify_failed", { itemId });
        return false;
      }
      return queued.value.ok;
    },
  });
  // 읽기 면: 리뷰 대기 항목이 있는 플러그인은 검토 칸이 `pending`이다. 읽기 서비스는 검토 서비스를 모르므로(검토 서비스가 읽기 서비스를 쓴다) 조립에서 얹는다
  const pluginRead = withPendingReview(pluginService, pluginReview);
  // 원본 폴더 감시(M5c §4.5.7). 사용자 플러그인 폴더와 프로젝트 루트의 `.fresnel/plugins`를 본다. 바뀌면 훑기가 검토 항목을 만든다(승인은 하지 않는다).
  // 감시 루트는 호스트가 발견 결과에서 정한다(OS 서비스의 앱 폴더 허용 목록과 별개로 루트마다 하나만 허용하는 감시자를 연다)
  const sourceWatch = createSourceWatch({
    enabled: () => deps.settings.value("x.loading-trust.sourceWatch") !== false,
    containers: async () => {
      const roots = await scanRootsOfProjects();
      return [
        userPluginsDir,
        join(deps.configDir, "extensions"),
        ...roots.flatMap((root) => [
          join(root.root, ".fresnel", "plugins"),
          join(root.root, ".fresnel", "extensions"),
        ]),
      ];
    },
    sourceDirs: async () => {
      const sources = await pluginService.sources();
      return sources.ok ? sources.value.entries.map((entry) => entry.dir) : [];
    },
    exists: async (path) => (await attemptAsync(() => stat(path))).ok,
    watch: (root, opts, onBatch) =>
      createFileWatcher({
        allowedRoots: [root],
        scheduler: deps.scheduler,
        logger: deps.logger,
        backends: [createFsWatchBackend({ logger: deps.logger, startMs: 50 })],
      }).watch(root, opts, onBatch),
    scan: async () => {
      const scanned = await pluginReview.scan();
      if (!scanned.ok) log.error("plugin.watch.scan_failed", { kind: scanned.error.kind });
    },
    logger: deps.logger,
  });
  /** 열린 루트를 훑고 감시 집합을 맞춘다(새로 열린 프로젝트의 `.fresnel/plugins`를 보게 된다) */
  async function scanOpenedAndWatch(): Promise<void> {
    await pluginReview.scanOpened();
    await sourceWatch.sync();
  }
  // 설정이 live로 바뀌면 감시 집합을 맞춘다(끄면 전부 닫는다)
  const offSourceWatchSetting = deps.settings.onChange((change) => {
    if (change.keys.length > 0 && !change.keys.includes("x.loading-trust.sourceWatch")) return;
    detach(sourceWatch.sync(), (cause) => {
      log.error("plugin.watch.sync_failed", { message: messageOf(cause) });
    });
  });
  // 맥락 참조 읽기 포트를 플랫폼 모듈로 낸다(M5c §4.8.8). 빌더 서비스의 `craftContext`가 호출 때 찾는다
  detach(
    ext
      .registerPlatform({
        name: "fresnel.craft-context",
        setup(ctx) {
          ctx.providePort(CraftContextPortKey, {
            read: (threadId) => craftChat.readContext(threadId),
          });
        },
      })
      .then((registered) => {
        if (!registered.ok) deps.logger.error("craft_context.register_failed", {});
        return registered.ok;
      }),
    (cause) => {
      deps.logger.error("craft_context.register_failed", {
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    },
  );
  // 담당 AI의 제출 포트를 플랫폼 모듈로 낸다(M5c §3.5). 키 이름은 스펙이 정하지 않아 [제안]이다. m4의 `fresnel.plugin-set`과 같은 등록 방식이다
  detach(
    ext
      .registerPlatform({
        name: "fresnel.plugin-submit",
        setup(ctx) {
          ctx.providePort(PluginSubmitPortKey, pluginReview.submitPort);
        },
      })
      .then((registered) => {
        if (!registered.ok) deps.logger.error("plugin_submit.register_failed", {});
        return registered.ok;
      }),
    (cause) => {
      deps.logger.error("plugin_submit.register_failed", {
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    },
  );
  // 턴 덧씌우기(M5c §4.3). 검사는 플러그인 서비스가 주는 대상으로, 집합은 호스트의 E(T)로 본다. 적재되지 않은 플러그인은 검토본 로더로 적재한다
  // 초안 싣기(§4.3.8). 격리 포트가 없으면 로더가 거부하므로 초안은 엔진 안에서 돌지 않는다
  const loadDrafts = createDraftLoader({
    loader: () => deps.extRead.loader(),
    report: (event, fields) => log.error(event, fields),
    timeoutMs: OVERLAY_LOAD_TIMEOUT_MS,
  });
  // 덧씌우기의 적재도 대화의 참조와 같은 길을 쓴다(AGE-33 enDep 5b): 기록이 있는 이름은 hard 대상을 먼저 싣고, 같은 로더의 진행 중인 적재를 함께 쓴다
  const overlayLifecycle = pluginLifecycleOf({
    loader: () => deps.extRead.loader(),
    // 덧씌우기는 내리지 않는다(내리기는 대화의 참조가 맡는다)
    busy: () => false,
    signal: deps.signal,
  });
  const overlay = createOverlayPort({
    targetOf: (name) => pluginService.overlayTarget(name),
    draftOf: (draftId) => pluginReview.draftOf(draftId),
    loadDrafts,
    inSet: (threadId) => ports.m4.pluginSet.port.resolve(threadId).plugins,
    ensureLoaded: async (names) => {
      const loader = deps.extRead.loader();
      if (loader === undefined) return;
      // 적재는 이름마다 서로 독립이라 함께 기다린다. 각 적재는 상한 시간을 가진다
      await Promise.all(
        names.map(async (name) => {
          const signal = AbortSignal.timeout(OVERLAY_LOAD_TIMEOUT_MS);
          // 기록이 있으면(시작 때 미룬 것, 내린 것) `ensureLoaded`가 싣는다. 기록이 없으면 검토본에서 새로 설치한다
          if (loader.list().some((info) => info.name === name)) {
            const attempted = await attemptAsync(() => overlayLifecycle.ensureLoaded(name, signal));
            // 상태는 적재 뒤의 기록에서 읽는다(`ensureLoaded`의 돌려주는 값은 호출하는 쪽마다 다르다)
            const state = loader.list().find((info) => info.name === name)?.state;
            if (!attempted.ok || state !== "active") {
              log.error("plugin.overlay.load_failed", {
                name,
                kind: attempted.ok ? (state ?? "missing") : "thrown",
              });
            }
            return;
          }
          const installed = await loader.loadInstalled(name, signal);
          if (!installed.ok) {
            log.error("plugin.overlay.load_failed", { name, kind: installed.error.kind });
          }
        }),
      );
    },
    pluginSet: {
      attachOverlay: (threadId, marks) => ports.m4.pluginSet.attachOverlay(threadId, marks),
      cancelOverlay: (threadId, keepDrive) => ports.m4.pluginSet.cancelOverlay(threadId, keepDrive),
      hold: (names) => ports.m4.pluginSet.hold(names),
    },
    // 시작 Drive 덧씌우기(§4.3.2): 사용자 명령으로 주도를 요청한다. 실패는 기록하고 거절 값으로 돌려준다
    startDrive: (threadId, plugin) => {
      const scopeId = driveRegistrationOf(plugin);
      if (scopeId === undefined) {
        log.error("plugin.overlay.drive_failed", { plugin, kind: "no_drive" });
        return err({ kind: "no_drive" });
      }
      const started = deps.ext.startDrive(threadId, scopeId, { trigger: "user" });
      if (started.ok) return ok(undefined);
      log.error("plugin.overlay.drive_failed", { plugin, kind: started.error.kind });
      return err({ kind: "not_started", reason: started.error.kind });
    },
  });
  // Test run 초안 구성(M5c §4.8.1). 덧씌우기와 같은 검사와 싣기를 쓰고, 싣은 초안은 대화에 묶는다
  const testRunDrafts = createTestRunDrafts({
    targetOf: (name) => pluginService.overlayTarget(name),
    draftOf: (draftId) => pluginReview.draftOf(draftId),
    loadDrafts,
    hasDrive: (internalName) => driveRegistrationOf(internalName) !== undefined,
    pluginSet: {
      hold: (names) => ports.m4.pluginSet.hold(names),
      setTestRunDrafts: (threadId, marks, approval) =>
        ports.m4.pluginSet.setTestRunDrafts(threadId, marks, approval),
    },
  });
  // 사용자 범위 스킬 만들기의 검토 싱크(L2.knowledge §7.5 [제안]). 지식 기능이 검토 서비스가 뜬 뒤에 얻는다(`PortsHandle.userSkillSink`)
  const userSkillSink = createUserSkillSink({
    intake: pluginReview.intake,
    decide: (itemId, decision) => pluginReview.decide(itemId, decision),
    log: deps.logger,
  });
  // 마이그레이션 제출(M5g 전 조각, migration.md §7.5 [제안]). wire로 열지 않고 `engine.ports`로만 낸다. `migration.apply`가 부른다
  const pluginMigration = createMigrationSubmitter({
    userDir: userPluginsDir,
    intake: pluginReview.intake,
    review: pluginReview,
    log: deps.logger,
  });
  // 가져오기 서비스(migration.md §6, §7.7 [제안]): 감지, 훑기, 제안, 적용, 보고서, 표지 숨기기. wire 처리기는 `handlers/m5/migration.ts`다.
  // 프로필 저장소는 `profile.list`, `profile.put`이 쓰는 포트를 그대로 부른다(wire를 거치지 않는다). 포트 객체는 호출 때 읽는다
  const migration = createMigrationService({
    homeDir: deps.homeDir,
    stateDir: deps.stateDir,
    submitter: pluginMigration,
    profiles: {
      list: () => ports.m4.profileTestRun.list(),
      put: (input, baseRev) => ports.m4.profileTestRun.put(input, baseRev),
    },
    clock: deps.clock,
    log: deps.logger,
    // 훑기 자식의 띄우기 원천(migration.md §7.4 [제안]). 포트와 샌드박스는 호출 때 찾는다: 조립 순서상 나중에 올라온다
    scanSource: {
      process: () => processPortOf(deps.ext),
      sandbox: sandboxSourceOf(deps.ext),
      self: deps.migrationSelf ?? currentSelf(),
      scheduler: deps.scheduler,
    },
  });
  // 파일 되감기 포트(M4). 서비스와 발급기는 조립이 주고, 시작 기록 읽기는 이 대화 저장소 세션이 한다
  const fileRewind: FileRewindPort | undefined =
    deps.fileRewind === undefined
      ? undefined
      : {
          service: deps.fileRewind.service,
          newRewindId: deps.fileRewind.newRewindId,
          startedOf: (threadId, rewindId) => startedRewindOf(session, threadId, rewindId),
          undoneConversationOf: (threadId, rewindId) =>
            undoneConversationOf(session, threadId, rewindId),
        };
  const ports: EnginePorts = {
    threads,
    ...(fileRewind === undefined ? {} : { fileRewind }),
    turns,
    feed,
    locks,
    settings,
    startupNotices: { notices: () => [...startupNotices] },
    approvals,
    activity,
    notify,
    log,
    secrets: deps.secrets,
    models: {
      modelIds: (provider) => modelIdsOf(deps.models, provider),
      available: () => deps.models.list({ available: true }),
      checkAuth: (provider, signal) => deps.models.checkProviderAuth(provider, signal),
    },
    commands: createCommandPort({ holder: deps.commands, ids: deps.ids }),
    web: createWebPort({ holder: deps.web, settings: deps.settings }),
    dialog: createDialogWirePort({ holder: deps.commands }),
    usage: createUsageSource(
      deps.models.usage,
      (threadId, query) => readEventsOfAllBranches(deps.session, threadId, query.kindPrefix),
      (provider, modelId) =>
        deps.models.list({ provider }).find((info) => info.ref === `${provider}/${modelId}`)
          ?.contextWindow,
      backgroundCallsOf(deps.measure),
    ),
    measure: measurePort,
    backtest: createBacktestPort({
      turns: measurePort.turnRecord,
      session: deps.session,
      plugins: deps.pluginStore,
      threadIds: () => allThreadRows().map((row) => row.threadId),
      isolation: () => deps.backtest?.isolation() ?? { available: false },
      settings: () => deps.backtest?.settings() ?? backtestSettingsOf(() => undefined),
      now: () => deps.clock.now(),
      // 실행 id는 `bt_` 접두와 공용 id의 ULID 부분이다(지역 접두 표에 `bt`를 더하지 않는다 [제안])
      newRunId: () => `bt_${deps.ids.next("evt").slice("evt_".length)}`,
    }),
    proposals: deps.proposals,
    trust,
    schedule: deps.schedule,
    ids: deps.ids,
    clock: deps.clock,
    scheduler: deps.scheduler,
    // 플러그인 읽기와 검토 흐름(M5c §3.4). 읽기는 서비스가, 검토 쓰기는 검토 서비스가 한다
    plugins: {
      list: (filter) => pluginRead.list(filter),
      get: (name) => pluginRead.get(name),
      scan: async () => {
        const scanned = await pluginReview.scan();
        await sourceWatch.sync();
        return scanned;
      },
      requestRemove: (name) => pluginReview.requestRemove(name),
      revert: (name) => pluginReview.revert(name),
      draftCreate: async (dir, originThreadId) => {
        const made = await pluginReview.draftCreate(dir, originThreadId);
        // 테스트 대화가 만든 초안이면 그 대화를 초안의 플러그인에 한 번 묶는다(M5c §4.8.2)
        if (made.ok && originThreadId !== undefined) {
          craftChat.bindDraft(originThreadId, made.value.info.name);
        }
        return made;
      },
      draftList: (name) => pluginReview.draftList(name),
      draftDiscard: (draftId) => pluginReview.draftDiscard(draftId),
      draftFiles: (draftId) => pluginReview.draftFiles(draftId),
      draftFile: (draftId, path) => pluginReview.draftFile(draftId, path),
      draftFromInstruction: (params) => pluginReview.fromInstruction(params),
      invocables: async (threadId) => {
        if (!isId("thr", threadId)) return err({ kind: "thread_not_found", threadId });
        const exists = threads.exists(threadId);
        if (!exists.ok) return err({ kind: "store", code: exists.error.kind });
        if (!exists.value) return err({ kind: "thread_not_found", threadId });
        return pluginService.invocables();
      },
    },
    overlay,
    testRunDrafts,
    pluginReview,
    scanOpenedRoots: () => scanOpenedAndWatch(),
    pluginMigration,
    craftChat,
    migration,
    m4: createM4Ports(
      deps.ext,
      {
        schedule: deps.schedule,
        threads,
        dialogArea: deps.dialogArea,
        log,
        projects,
        appEdits,
        // 제작 포트가 읽는 원본 폴더와 초안 목록(M5c §4.9.2, §4.9.3). 플러그인 wire와 같은 서비스다
        plugins: {
          get: (name) => pluginService.get(name),
          draftList: (name) => pluginReview.draftList(name),
        },
        draftCreate: (dir, originThreadId) => pluginReview.draftCreate(dir, originThreadId),
        testRunDrafts,
        // 발견의 근거 묶음(`findings.bundle`과 같은 턴 기록 읽기, M5c §4.8.8)
        findingsBundle: (findingId) => measurePort.turnRecord.findingsBundle(findingId),
      },
      {
        catalog: deps.settings.catalog,
        settings,
        errors: { ofStore: wireErrorOfStore, threadLocked: () => threadLocked(null) },
        settingValue: (key, threadId) => deps.settings.value(key, threadId),
        threadExists: (threadId) => threads.exists(threadId),
        // 호출 때 만든다: 확장 호스트가 아닌 대역을 넘긴 시험은 이 통로를 부르지 않는다
        toggles: {
          scopes: () => registrationToggleSourceOf(deps.ext).scopes(),
          request: (scopeId, enabled, reason, threadId) => {
            registrationToggleSourceOf(deps.ext).request(scopeId, enabled, reason, threadId);
          },
          requestApply: (threadId) => {
            registrationToggleSourceOf(deps.ext).requestApply(threadId);
          },
          applyNow: (threadId) => registrationToggleSourceOf(deps.ext).applyNow(threadId),
        },
        registrations: () => deps.ext.registrations(),
        // 오류로 멈춘 확장(M5c §4.1.12). 자동 끄기 장부가 든 `ext:<이름>`이다
        stopped: (name) => deps.extRead.operations.autoDisabler.disabled().includes(`ext:${name}`),
        // 대화의 프로필 설정 값이 바뀌면 설정 구독자(wire 알림, 확장 구독)에게 바뀐 키를 전한다
        settingsChanged: (change) => {
          deps.settings.notifyChanged({
            keys: [...change.keys],
            scopes: [...change.scopes],
            threadId: change.threadId,
          });
        },
        configDir: deps.configDir,
        stateDir: deps.stateDir,
        // 검토본·초안 저장소(`assemble.ts`의 `pluginStoreRoot`와 같다). 제작 포트가 이 폴더 안을 편집하지 않게 막는다
        pluginStoreDir: join(deps.dataDir, "plugin-store"),
        secretNames: async () => {
          const listed = await deps.secrets.admin.ls({ usage: false });
          if (!listed.ok) return null;
          return new Set(
            listed.value.flatMap((listing) => (listing.meta === null ? [] : [listing.meta.name])),
          );
        },
        openThreadProfiles: () => openThreadProfilesOf(session),
        // 엔진이 쥔 대화만 E(T)의 대상이다(`acquireFresh`가 연다, `releaseThread`·`dropHeldThread`가 닫는다)
        openThreadIds: () => Array.from(held.keys()),
        // 대화의 참조로 플러그인을 싣고 내린다(M5c §4.1.11). 로더 연결은 조립 뒤에 찾는다(호출 때 읽는다)
        lifecycle: pluginLifecycleOf({
          loader: () => deps.extRead.loader(),
          busy: (name) =>
            Array.from(held.keys()).some((threadId) =>
              ext.driveFrames(threadId).some((frame) => frame.plugin === name),
            ),
          signal: deps.signal,
        }),
        whenIdle: (threadId, fn) => loop.whenIdle(threadId, fn),
        driveFramePlugins: (threadId) =>
          deps.ext
            .driveFrames(threadId)
            .flatMap((frame) => (frame.plugin === null ? [] : [frame.plugin])),
        // 대화의 모델 참조로 main 역할을 풀어 캐시 정책을 읽는다(`core-loop`의 `roleOf`와 같은 기준). 없으면 undefined
        cachePolicyOf: (threadId) => {
          const found = session.query.thread(threadId);
          if (!found.ok || found.value === undefined) return undefined;
          const ref = found.value.model;
          const resolved = deps.models.resolve("main", ref === undefined ? {} : { ref });
          return resolved.ok ? resolved.value.cachePolicy : undefined;
        },
        forcedPlugins: () => deps.pluginsForced?.() ?? [],
        // 번들 기본 플러그인(`DEFAULT_PLUGIN_NAMES`)은 기본 프로필에 항상 든다. 나머지는 m4가 등급으로 더한다(§4.1.2)
        defaultPlugins: () => [...DEFAULT_PLUGIN_NAMES],
        // 하위 대화의 부모(테스트 실행의 고정 구성을 물려받는다, §4.8.1 9)
        parentOf: (threadId: ThreadId) => {
          const link = session.query.agentOfChild(threadId);
          return link.ok ? link.value?.parentThreadId : undefined;
        },
        threadProfileId: (threadId) => {
          const found = session.query.thread(threadId);
          return found.ok ? (found.value?.profileId ?? null) : null;
        },
        fileLock: deps.fileLock,
        clock: deps.clock,
        signal: deps.signal,
        // 지금 실행 중인 판의 해시. 바뀌면 열린 대화가 `profile.applied { reason: "plugin_updated" }`를 남긴다
        loadedHash: (name) =>
          deps.extRead
            .loader()
            ?.list()
            .find((info) => info.name === name)?.contentHash,
        // 검토 대기 이름. 읽지 못하면 빈 목록으로 두고 실패를 기록한다(프로필 검증은 그 이름을 `plugin_not_reviewed`로 보지 못한다)
        pendingPluginNames: async () => {
          const pending = await pluginReview.pendingNames();
          if (!pending.ok) {
            deps.logger.error("plugin.review.pending_unreadable", { kind: pending.error.kind });
            return [];
          }
          return [...pending.value];
        },
        testRunMarks: testMarks,
      },
      createExtReadSources(deps.extRead, {
        ext: deps.ext,
        settings: deps.settings,
        threadExists: (threadId) => threads.exists(threadId),
        errors: { ofStore: wireErrorOfStore },
        heldThreads: () => Array.from(held.keys()),
        activeThread: () => Array.from(held.keys()).at(-1) ?? null,
        prepareThread: (threadId) => settings.prepare(threadId),
      }),
      deps.extUi,
    ),
  };

  return {
    ports,
    userSkillSink,
    tokenOf: (threadId) => held.get(threadId)?.token,
    heldThreads: () => Array.from(held.keys()),
    activeThread: () => Array.from(held.keys()).at(-1) ?? null,
    async closeSourceWatch() {
      offSourceWatchSetting();
      await sourceWatch.close();
    },
    releaseAll() {
      return sequentially(Array.from(held.keys()), async (threadId) => {
        try {
          await releaseThread(threadId);
        } catch (caught) {
          log.error("lease.release_all_failed", { threadId, message: messageOf(caught) });
        }
      });
    },
  };
}
