import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createChunkNumbering } from "@fresnel/cap-dialog";
import {
  assertNever,
  attemptAsync,
  Bug,
  detach,
  err,
  parse,
  type Logger,
} from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ExtensionManifest, PortKey } from "@fresnel/contracts/extensions";
import {
  SessionServiceName,
  StoreServiceName,
  storeFailureKindOf,
  type LeaseHolder,
  type ScopeHandlerFailedPayload,
  type SessionService,
  type StoreFailureKind,
  type StoreService,
} from "@fresnel/contracts/records";
import {
  ApprovalServiceName,
  ContextServiceName,
  LoopServiceName,
  ModelServiceName,
  OsPortKey,
  TaskServiceName,
  ToolServiceName,
  type ApprovalService,
  type ContextService,
  type LoopService,
  type ModelService,
  type OsService,
  type TaskService,
  type ToolService,
} from "@fresnel/contracts/services";
import { StoreIdSchema } from "@fresnel/contracts/wire";
import {
  createExtHost,
  createOperationsPolicy,
  createRegistrationControl,
  createVolatileNotifier,
  hookUnitName,
  registrationToggleSourceOf,
  TIERS,
  traceReadOf,
  type ExtHost,
  type ExtensionLoader,
  type ExtensionUnit,
  type OperationsPolicy,
  type RegistrationControl,
} from "@fresnel/ext-host";
import type { ScheduleService } from "@fresnel/cap-schedule";
import { createExecPlatformModule, detectExecPlatform } from "@fresnel/platform-exec";
import {
  PRODUCT,
  createIdFactory,
  createLocalIdFactory,
  readOsRuntime,
  type OsRuntime,
  type OsServiceHandle,
} from "@fresnel/platform-os";
import {
  createProcessShutdown,
  processPlugin,
  type ProcessShutdown,
} from "@fresnel/platform-process";
import { createSecretsRuntime } from "@fresnel/platform-secrets";
import type { GroupServiceWithUsage } from "@fresnel/group-sdk";
import {
  openStore,
  storePlugin,
  type OpenedStore,
  type StoreOpenError,
  type StoreWarning,
} from "@fresnel/platform-store";
import { capabilityDefsOf } from "./assembly/capability-defs.ts";
import { buildEngineCatalog } from "./assembly/catalog.ts";
import {
  builtinUnits,
  installFailureOf,
  scheduleUnit,
  unitOfModule,
} from "./assembly/extensions.ts";
import { isGroupCatalogManifest } from "./assembly/groups.ts";
import {
  createLearningWiring,
  learningAgentsLoaded,
  learningLoaded,
  registerLearningProjection,
} from "./assembly/learning.ts";
import { createHostSchedule, type ScheduleRunnerPorts } from "./assembly/schedule.ts";
import { createStoreScheduleLeader, schedulerLeaderIsLive } from "./assembly/schedule-leader.ts";
import { createHandlerFailedEmitter } from "./assembly/handler-failed.ts";
import { createProposalPort } from "./assembly/proposals.ts";
import type { WebStatusHolder } from "./assembly/web-providers.ts";
import { createLateLogSink } from "./assembly/log-sink.ts";
import { startAutoTitle, titleModelFor, type AutoTitle } from "./assembly/auto-title.ts";
import { startDataOps, type DataOps } from "./assembly/data-ops.ts";
import { createExtDiagnosticSink } from "./assembly/diagnostics.ts";
import { createHostMcpProcessPort } from "./assembly/mcp-process.ts";
import type { CommandRegistryHolder } from "./assembly/l2-units.ts";
import { createDialogAreaHolder } from "./assembly/m4/dialog-area-bridge.ts";
import { registerExtensionKeys } from "./assembly/ext-keys.ts";
import { createExtensionRecords } from "./assembly/m4/ext-read-sources.ts";
import type { RequestBodyOffer } from "@fresnel/core-models";
import type { CapabilityApi, McpClient } from "@fresnel/contracts/capabilities";
import {
  startMeasurement,
  type HandlerFailureInput,
  type RequestBodyInput,
} from "./assembly/measure/recorder.ts";
import { DEFAULT_RETENTION_DAYS } from "./assembly/measure/store.ts";
import { pruneOnOpen } from "./assembly/retention.ts";
import { osPlatform, sandboxPlatform, secretsPlatform } from "./assembly/platform.ts";
import { createEnginePorts, type PortsHandle } from "./assembly/ports.ts";
import { watchUserSettings, type SettingsWatch } from "./assembly/settings-watch.ts";
import {
  createSecretsPort,
  effectiveSecretsConfig,
  settingKeysReferencing,
} from "./assembly/secrets.ts";
import { createProjectTrust, createLoaderFs, fileBackend } from "./assembly/trust.ts";
import {
  bundledPluginVersionOf,
  defaultPluginNamesFor,
  installDefaultPlugins,
  installedAgentDefinitions,
} from "./assembly/default-plugins.ts";
import { bridgeExtensionCommands } from "./assembly/extension-commands.ts";
import {
  BUILTIN_GROUP_NAMES,
  followBuiltinEnabled,
  followExtEnabled,
  followThreadEnabled,
} from "./assembly/ext-enabled.ts";
import { loadExternalExtensions } from "./assembly/external.ts";
import { createExtUiVersionSource } from "./assembly/m4/ext-ui-version-source.ts";
import { createProjectExtensions } from "./assembly/project-extensions.ts";
import { createProviderLinker } from "./secrets/provider-link.ts";
import { createSettingsEngine, type SettingsEngine } from "./assembly/settings-engine.ts";
import { resolveSetting, type SettingCatalog } from "@fresnel/contracts/settings";
import {
  execOptionsOf,
  layersSource,
  logLevelOf,
  operationsSource,
  primitivesSource,
  sandboxSource,
  secretsSource,
  shutdownTimeoutMs,
  spillRetentionDaysOf,
  storeSettingsOf,
} from "./assembly/settings-sources.ts";
import { ownerKindOf } from "./handlers/owner.ts";
import { createFileStartupHealth, startupHealthOf } from "./assembly/startup-health.ts";
import { defaultPluginsDir, hostResourceDir } from "./state-paths.ts";
import type { AssembleIssue, AssembleOptions, Engine } from "./types.ts";
import { createExternalHooks, HOOK_DEFS_KEY, stringsOf } from "./assembly/external-hooks.ts";
import { messageOf, sequentially } from "./util.ts";

export type {
  ActivityPort,
  ActivitySnapshot,
  ApprovalPort,
  AssembleIssue,
  AssembleOptions,
  CommitBatch,
  Engine,
  EngineDiagnostics,
  EnginePorts,
  EventFeedPort,
  HostLogPort,
  HostMode,
  HostPluginModule,
  LockOutcome,
  OwnerKind,
  SessionLockPort,
  SettingsStorePort,
  SubmitOutcome,
  ThreadPort,
  TurnPort,
  UserNotifyPort,
} from "./types.ts";
export { buildEngineCatalog, coreSettingGroups } from "./assembly/catalog.ts";

/** 릴리즈 빌드가 `bun build --define FRESNEL_BUILD_VERSION="x.y.z"`로 넣는 값(scripts/build-sidecar.ts). 소스 실행에는 없다 */
declare const FRESNEL_BUILD_VERSION: string | undefined;

/** 엔진 빌드 버전. 등록 파일 version과 host.hello server.version이 같은 값을 쓴다. 주입이 없으면 "0.0.0"이다(L4.release.spec §8.1) */
export const ENGINE_VERSION: string =
  typeof FRESNEL_BUILD_VERSION === "string" ? FRESNEL_BUILD_VERSION : "0.0.0";

/** DB 파일 이름. 제품 이름에 묶인 값이라 platform-os의 PRODUCT에서 온다(L0.os.spec §3.12) */
const DB_FILE_NAME = PRODUCT.dbFileName;

/** 조립 결함. 선언 결함은 Result 대신 예외로 알린다(eng.typescript.guide TY-11) */
export class AssembleError extends Error {
  override readonly name: string = "AssembleError";
  readonly issues: readonly AssembleIssue[];

  constructor(issues: readonly AssembleIssue[], options?: { readonly cause?: unknown }) {
    super(`assemble failed: ${issues.map(describeIssue).join("; ")}`, options);
    this.issues = issues;
  }
}

/** `x.operations.safeMode.default`가 켜져 있는가. 카탈로그에 없으면 꺼진 것이다 */
function safeModeSettingOn(catalog: SettingCatalog, settings: SettingsEngine): boolean {
  const key = "x.operations.safeMode.default";
  return catalog.has(key) && settings.value(key) === true;
}

/** `x.operations.safeMode.suggestAfter`. 카탈로그에 없거나 정수가 아니면 기본값(3)이다 */
function suggestAfterOf(catalog: SettingCatalog, settings: SettingsEngine): number {
  const key = "x.operations.safeMode.suggestAfter";
  const value = catalog.has(key) ? settings.value(key) : undefined;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : 3;
}

/** `x.operations.trace.retentionDays`. 카탈로그에 없거나 1 미만이면 기본값(30)이다 */
function retentionDaysOf(catalog: SettingCatalog, settings: SettingsEngine): number {
  const key = "x.operations.trace.retentionDays";
  const value = catalog.has(key) ? settings.value(key) : undefined;
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : DEFAULT_RETENTION_DAYS;
}

function describeIssue(issue: AssembleIssue): string {
  switch (issue.code) {
    case "catalog":
      return `catalog: ${issue.issues.map((entry) => `${entry.code} ${"key" in entry ? entry.key : ""}`).join(", ")}`;
    case "store":
      return `store: ${issue.message} (${issue.failure})`;
    case "missingService":
      return `missing service ${issue.service}`;
    case "plugin":
      return `plugin ${issue.plugin}: ${issue.message}`;
    default:
      return assertNever(issue, "AssembleIssue");
  }
}

/** CLI가 구별하는 이름. 분류(`failure`)마다 안내가 달라서 한 이름으로 합치지 않는다(`F.records.spec` §3.7 7항) */
const STORE_MESSAGE_BY_FAILURE: Readonly<Record<StoreFailureKind, string>> = {
  future_version: "storeFutureVersion",
  corrupt: "storeCorrupt",
  migration_failed: "storeMigrationFailed",
  unavailable: "storeUnavailable",
};

/** 저장소를 열지 못한 이유를 분류와 CLI가 구별하는 이름으로 옮긴다(L4.host-service.spec §3.3.5 EngineStartError 대응) */
export function storeIssueOf(error: StoreOpenError): AssembleIssue & { readonly code: "store" } {
  const failure = storeFailureKindOf(error.kind);
  if (error.kind === "fts5_missing") return { code: "store", message: "fts5Missing", failure };
  if (error.kind === "permission" || error.kind === "unsupported_filesystem") {
    return { code: "store", message: "dataDirPermission", failure };
  }
  return { code: "store", message: STORE_MESSAGE_BY_FAILURE[failure], failure };
}

function defaultProjectTrustOf(value: unknown): "ask" | "always" | "never" {
  return value === "always" || value === "never" ? value : "ask";
}

function causeKind(caught: unknown): string | undefined {
  if (!(caught instanceof Error)) return undefined;
  const cause: unknown = caught.cause;
  if (typeof cause === "object" && cause !== null && "kind" in cause) {
    const kind: unknown = cause.kind;
    if (typeof kind === "string") return kind;
  }
  return undefined;
}

function pluginIssue(plugin: string, caught: unknown): AssembleIssue {
  const kind = causeKind(caught);
  return {
    code: "plugin",
    plugin,
    message: kind === undefined ? messageOf(caught) : `${messageOf(caught)} (${kind})`,
  };
}

const SESSION_KEY: PortKey<SessionService> = { name: SessionServiceName };
const STORE_KEY: PortKey<StoreService> = { name: StoreServiceName };
const LOOP_KEY: PortKey<LoopService> = { name: LoopServiceName };
const TASKS_KEY: PortKey<TaskService> = { name: TaskServiceName };
const APPROVALS_KEY: PortKey<ApprovalService> = { name: ApprovalServiceName };
const TOOLS_KEY: PortKey<ToolService> = { name: ToolServiceName };
const MODELS_KEY: PortKey<ModelService> = { name: ModelServiceName };
const CONTEXT_KEY: PortKey<ContextService> = { name: ContextServiceName };

function requirePort<Api>(ext: ExtHost, key: PortKey<Api>, service: string): Api {
  const found = ext.ports.get(key);
  if (found === undefined) throw new AssembleError([{ code: "missingService", service }]);
  return found;
}

/**
 * thread의 작업 디렉터리. 세션 서비스가 올라오기 전이거나 모르는 thread, 작업 디렉터리가 없는 thread면 undefined다(호출자는 ""로 본다).
 * thread 읽기가 실패하면(busy, io, row_invalid) 같이 undefined를 돌려주되 `host.thread_workspace_unreadable`로 남긴다: 읽기 실패를
 * 작업 디렉터리가 없는 것으로 조용히 바꾸면 project·local 설정과 `input.bash.before`의 cwd가 왜 비었는지 알 수 없다.
 * 설정 층(project·local 파일)과 `input.bash.before`의 cwd가 같은 값을 쓴다
 */
export function threadWorkspaceOf(
  ext: ExtHost,
  logger: Logger,
): (threadId: ThreadId) => string | undefined {
  return (threadId) => {
    const found = ext.ports.get(SESSION_KEY)?.query.thread(threadId);
    if (found === undefined) return undefined;
    if (!found.ok) {
      logger.warn("host.thread_workspace_unreadable", { threadId, reason: found.error.kind });
      return undefined;
    }
    return found.value?.workspace ?? undefined;
  };
}

/**
 * 저장소 열기 경고를 로그에 남긴다(L0.store.spec §4.6.1). 마이그레이션 전 스냅샷은 사용자 DB를 지키는 복구 수단이라 위치를 info로 남기고,
 * 보관 수를 넘은 옛 스냅샷을 지우지 못한 것은 warn이다. 그 밖의 경고도 종류를 warn으로 남긴다. 값은 싣지 않는다
 */
export function logStoreWarning(logger: Logger, warning: StoreWarning): void {
  switch (warning.kind) {
    case "migration_snapshot":
      logger.info("store.migration_snapshot", {
        path: warning.path,
        owner: warning.owner,
        from: warning.from,
        to: warning.to,
      });
      return;
    case "snapshot_prune_failed":
      logger.warn("store.snapshot_prune_failed", { path: warning.path, code: warning.code });
      return;
    case "fs_unknown":
      logger.warn("store.warning", { kind: warning.kind, dir: warning.dir });
      return;
    case "permission_fixed":
      logger.warn("store.warning", {
        kind: warning.kind,
        path: warning.path,
        from: warning.from,
        to: warning.to,
      });
      return;
    case "checkpoint_incomplete":
      logger.warn("store.warning", {
        kind: warning.kind,
        busy: warning.busy,
        log: warning.log,
        checkpointed: warning.checkpointed,
      });
      return;
    case "fts5_missing":
    case "lock_provider_none":
      logger.warn("store.warning", { kind: warning.kind });
      return;
    case "read_only":
      // 미래 버전 DB를 읽기 전용으로 열었다(L0.store.spec §4.11). 쓰기 기능이 꺼진 이유를 남긴다
      logger.warn("store.warning", {
        kind: warning.kind,
        reason: warning.reason,
        owner: warning.owner,
        dbVersion: warning.dbVersion,
        codeVersion: warning.codeVersion,
      });
      return;
    default:
      assertNever(warning, "StoreWarning");
  }
}

/** 엔진 하나를 만든다. 실패하면 AssembleError를 던지고, 그때까지 연 자원을 닫는다 */
export async function assemble(options: AssembleOptions): Promise<Engine> {
  // 설정 카탈로그는 순수 계산이라 자원을 열기 전에 만든다. 코어 키 문제는 시작 거부다(F wire §5, AH-13)
  const builtCore = buildEngineCatalog(options.settingGroups);
  if (!builtCore.ok) throw new AssembleError([{ code: "catalog", issues: builtCore.issues }]);
  // 확장 예약 키(`ext.<이름>.enabled`)는 단위와 외부 확장이 정해진 뒤에 더한다(`registerExtensionKeys`). 그래서 같은 Map을 모두가 쥔다
  const built = { catalog: new Map(builtCore.catalog) };
  const settings = createSettingsEngine(built.catalog);
  const extensionKeys: { sync: () => void } = { sync: () => undefined };

  const baseRuntime = readOsRuntime();
  const runtime: OsRuntime =
    options.clock === undefined ? baseRuntime : { ...baseRuntime, clock: options.clock };
  const clock = runtime.clock;
  const ids = options.ids ?? createIdFactory(clock, runtime.random);
  const localIds = createLocalIdFactory(clock, runtime.random);
  const startedAt = clock.now();

  const lifetime = new AbortController();
  const logSink = createLateLogSink();
  const redact: { current: (line: string) => string } = { current: (line) => line };
  const late: {
    host: ExtHost | undefined;
    scopes: RegistrationControl | undefined;
    logger: Logger | undefined;
    /** 4단계에서 채운다. 그 전의 확장 실패 알림은 발신하지 못하고 운영 로그에 남는다 */
    session: SessionService | undefined;
  } = { host: undefined, scopes: undefined, logger: undefined, session: undefined };
  const opened: { store: OpenedStore | undefined; registered: boolean } = {
    store: undefined,
    registered: false,
  };

  const scopeControl: RegistrationControl = {
    requestDisable: (scopeId, reason) => {
      late.scopes?.requestDisable(scopeId, reason);
    },
    requestEnable: (scopeId, reason) => {
      late.scopes?.requestEnable(scopeId, reason);
    },
    scopesOf: (extension) => late.scopes?.scopesOf(extension) ?? [],
  };
  const setTimer = (ms: number, fn: () => void): (() => void) => {
    const handle = runtime.scheduler.setTimeout(fn, ms);
    return () => {
      runtime.scheduler.clearTimeout(handle);
    };
  };
  const logOperations = (line: string): void => {
    late.logger?.warn("ext.operations", { line });
  };
  // 휘발 조각 번호 발급기. `scope.handler_failed`와 `dialog.status`가 같은 (thread, turn) 키의 번호를 한 열로 나눈다(F.records.spec §4.3)
  const chunkNumbering = createChunkNumbering();
  // 확장 핸들러 실패를 `scope.handler_failed` 휘발 이벤트로 보낸다(M3-REQ-35, L4.host-service HS-92). 열린 thread는 허브가 있어야 읽을 수 있어 옵션으로 받는다
  const emitHandlerFailed = createHandlerFailedEmitter({
    emitVolatile: (event) => {
      late.session?.emitVolatile(event);
    },
    headSeq: () => late.session?.feed.headSeq() ?? err({ kind: "unavailable" }),
    openThreads: () => options.openThreads?.() ?? [],
    ids,
    clock,
    numbering: chunkNumbering,
    log: logOperations,
    mask: (text) => redact.current(text),
  });
  // 같은 실패를 측정 저장소에도 남긴다(T-MEAS-EV). 휘발 이벤트는 재시작 뒤 사라지므로 이 기록이 남는 사본이다. 저장소는 늦게 열린다
  const handlerFailed = (payload: ScopeHandlerFailedPayload): void => {
    emitHandlerFailed(payload);
    measureSlot.recordFailure?.({
      at: clock.now(),
      ...payload,
      message: redact.current(payload.message),
    });
  };
  // 외부 훅 실행기(X.operations.spec §4.7). 장부(operations)가 늦게 만들어지므로 보고는 늦게 연결한다
  const hookHome: { dir: string } = { dir: "" };
  const hookLedger: { policy: OperationsPolicy | undefined } = { policy: undefined };
  const externalHooks = createExternalHooks({
    layers: (threadId) => settings.layers(threadId),
    ports: { get: (key) => late.host?.ports.get(key) },
    workspaceOf: (threadId) =>
      late.host === undefined || late.logger === undefined
        ? undefined
        : threadWorkspaceOf(late.host, late.logger)(threadId),
    homeDir: () => hookHome.dir,
    parentEnv: () => process.env,
    savedDisabled: () => stringsOf(settings.value("x.operations.hookDisabled")),
    envAllow: () => stringsOf(settings.value("x.operations.hookEnvAllow")),
    budgetMs: () => operationsSource(settings).budgets().hook,
    setTimer,
    now: () => clock.now(),
    report: (record) => {
      hookLedger.policy?.autoDisabler.onOutcome(record);
    },
    log: (line) => {
      late.logger?.warn("ext.operations", { line });
    },
  });
  // 훅 정의나 폴더 신뢰가 바뀌면 훅마다 단위를 넣고 뺀다. `keys`가 빈 알림은 어느 키인지 모르는 변경(신뢰 결정)이다
  settings.onChange((change) => {
    if (change.keys.length > 0 && !change.keys.includes(HOOK_DEFS_KEY)) return;
    detach(externalHooks.sync(), (caught) => {
      late.logger?.warn("ext.operations", {
        line: `external hooks sync failed: ${String(caught)}`,
      });
    });
  });
  const operations = createOperationsPolicy({
    now: () => clock.now(),
    setTimer,
    hooks: externalHooks.runner,
    settings: operationsSource(settings),
    scopes: scopeControl,
    ports: {
      get: (key) => late.host?.ports.get(key),
    },
    notifier: createVolatileNotifier({ emit: handlerFailed, log: logOperations }),
    log: logOperations,
    // 답할 화면(연결된 클라이언트)이 없으면 자동 끄기 기준을 넘어도 묻지도 끄지도 않는다(X.operations §4.3.3)
    canAsk: () => options.hasClient?.() === true,
  });
  hookLedger.policy = operations;
  /** 확장 진단. 상한(256)을 넘으면 오래된 것부터 버린다(L0.os.spec §3.14, M3-REQ-52) */
  const diagnostics = createExtDiagnosticSink(undefined, (text) => redact.current(text));
  const ext = createExtHost({
    ids,
    now: () => clock.now(),
    setTimer,
    policy: operations,
    setupBudgetMs: () => operations.setupBudgetMs(),
    // x.operations.trace.* 유효 값. 새 Turn이 처음 보일 때 읽는다(X.operations §4.8.3)
    trace: () => operations.trace(),
    methodRun: operations.runMethod,
    onMethodSettled: operations.onMethodSettled,
    settings: primitivesSource(settings),
    capabilityDefs: capabilityDefsOf(options.extraCapabilityDefs),
    report: (diagnostic) => {
      diagnostics.push(diagnostic);
      late.logger?.warn("ext.diagnostic", {
        level: diagnostic.level,
        code: diagnostic.code,
        message: diagnostic.message,
      });
    },
  });
  late.host = ext;
  late.scopes = createRegistrationControl(registrationToggleSourceOf(ext));

  let portsHandle: PortsHandle | undefined;
  let shutdownCoordinator: ProcessShutdown | undefined;
  const osSlot: { handle: OsServiceHandle | undefined } = { handle: undefined };
  /** 예약 서비스. 서비스 등록 뒤(4단계)에 채운다. 닫을 때 아직 없으면 건너뛴다 */
  const scheduleSlot: { service: ScheduleService | undefined } = { service: undefined };
  /** 보관 정리와 블롭 GC 타이머. 닫을 때 먼저 끊는다(저장소를 닫기 전) */
  const dataOpsSlot: { ops: DataOps | undefined } = { ops: undefined };
  const measureSlot: {
    stop: (() => void) | undefined;
    recordFailure: ((input: HandlerFailureInput) => void) | undefined;
    recordBody: ((input: RequestBodyInput) => void) | undefined;
  } = { stop: undefined, recordFailure: undefined, recordBody: undefined };
  // 모델 호출마다 최종 요청 본문을 측정 기록기에 넘긴다(T-MEAS-REC, B18). 저장 여부는 기록기가 설정으로 정한다. 단계 번호는 같은 Turn의 호출 순번이다
  const bodySteps = new Map<string, number>();
  const offerRequestBody = (offer: RequestBodyOffer): void => {
    const record = measureSlot.recordBody;
    if (record === undefined) return;
    const anchor = offer.ctx.turnId ?? offer.ctx.threadId;
    const stepIndex = (bodySteps.get(anchor) ?? 0) + 1;
    bodySteps.delete(anchor);
    bodySteps.set(anchor, stepIndex);
    // 끝난 Turn의 순번이 쌓이지 않게 오래된 것부터 버린다
    if (bodySteps.size > 256) {
      const oldest = bodySteps.keys().next();
      if (!oldest.done) bodySteps.delete(oldest.value);
    }
    record({
      threadId: offer.ctx.threadId,
      turnId: offer.ctx.turnId,
      stepIndex,
      at: offer.at,
      body: offer.body,
    });
  };
  /** 자동 제목 연결. 엔진 포트가 올라온 뒤에 연다. 닫을 때 구독을 거둔다 */
  const autoTitleSlot: { title: AutoTitle | undefined } = { title: undefined };
  const closing: { promise: Promise<void> | undefined } = { promise: undefined };
  /** 외부 확장 로더(기본 플러그인 포함). 닫을 때 먼저 내린다 */
  const external: {
    loader: ExtensionLoader | undefined;
    unbridge: (() => void) | undefined;
    unfollowEnabled: (() => void) | undefined;
    unfollowBuiltin: (() => void) | undefined;
  } = {
    loader: undefined,
    unbridge: undefined,
    unfollowEnabled: undefined,
    unfollowBuiltin: undefined,
  };

  const settingsWatchSlot: { watch: SettingsWatch | undefined } = { watch: undefined };

  async function closeAll(): Promise<void> {
    try {
      // 설정 파일 감시를 먼저 닫는다: 닫은 뒤에는 다시 읽기가 시작되지 않는다
      await settingsWatchSlot.watch?.close();
      // 자동 제목과 보관 정리를 먼저 끊는다. 예약을 멈추고 저장소를 닫기 전이어야 한다
      autoTitleSlot.title?.close();
      dataOpsSlot.ops?.close();
      measureSlot.stop?.();
      // 예약을 먼저 멈춘다: 틱과 감시를 끊고 진행 중인 저장을 기다린다. 저장소를 닫기 전이어야 한다
      await scheduleSlot.service?.close();
      await portsHandle?.releaseAll();
      external.unfollowEnabled?.();
      external.unfollowBuiltin?.();
      external.unbridge?.();
      await external.loader?.dispose();
      await ext.dispose();
    } finally {
      lifetime.abort();
      // 저장소가 플랫폼 모듈로 올라가기 전에 실패했으면 직접 닫는다(close는 여러 번 불러도 된다)
      if (opened.store !== undefined && !opened.registered) await opened.store.close();
    }
  }

  /** 여러 번, 동시에 불러도 닫기는 한 번이고 모두 같은 약속을 기다린다 */
  function shutdown(): Promise<void> {
    closing.promise ??= closeAll();
    return closing.promise;
  }

  async function register(
    name: string,
    module: Parameters<ExtHost["registerPlatform"]>[0],
  ): Promise<void> {
    let registered: Awaited<ReturnType<ExtHost["registerPlatform"]>>;
    try {
      registered = await ext.registerPlatform(module);
    } catch (caught) {
      throw new AssembleError([pluginIssue(name, caught)], { cause: caught });
    }
    if (!registered.ok) {
      const { reason, cause } = registered.error;
      throw new AssembleError(
        [
          {
            code: "plugin",
            plugin: name,
            message: `${name} failed to start (${reason})`,
            ...(reason === "permission_too_open"
              ? { failure: "data_dir_permission" as const }
              : {}),
          },
        ],
        { cause },
      );
    }
  }

  try {
    // 1. 경로: L0.os
    await register(
      "platform-os",
      osPlatform(
        {
          resourceDir: hostResourceDir(),
          logSink: logSink.sink,
          logRedact: (line) => redact.current(line),
          // 설정 l0.os.log.level은 live다: 로그를 낼 때마다 읽어 변경이 다음 줄부터 반영된다(G1-12)
          logLevel: logLevelOf(settings),
          // 시험이 OS 알림 도구를 띄우지 않도록 provider를 바꿔 끼운다(AssembleOptions.osNotifier). 운영은 생략해 OS 기본을 쓴다
          ...(options.osNotifier === undefined ? {} : { notifier: options.osNotifier }),
        },
        runtime,
        (handle) => {
          osSlot.handle = handle;
        },
      ),
    );
    const os: OsService = requirePort(ext, OsPortKey, "fresnel.os");
    hookHome.dir = os.dirs.home;
    const osHandle = osSlot.handle;
    // fresnel.os를 올린 setup이 핸들을 넘긴다. 없으면 조립 순서가 깨진 것이다
    // fresnel-disable-next-line fresnel/bug-for-expected -- osPlatform의 setup이 성공하면 핸들이 항상 채워진다 (eng.typescript.guide TY-24)
    if (osHandle === undefined) throw new Bug("platform-os did not hand over its handle");
    logSink.attach(join(os.dirs.state, "logs", `${options.mode}.log`));
    const logger = os.logger("host");
    late.logger = logger;
    // 연속 시작 실패 수(X.operations.spec §4.6.4). 조립이 던지면 "진행 중" 표시가 남아 다음 시작에서 1이 는다
    const startupHealth = createFileStartupHealth(os.dirs.state);
    const startupFailures = startupHealth.beginStartup();
    await settings.loadUserFile(join(os.dirs.config, "settings.json"));
    // 훅 순서 덮어쓰기의 적용 상태는 정책을 만들 때(위) 읽는다. 그때 설정 파일은 아직 안 읽혔으므로 지금 저장된 순서를 든다(X.operations §4.1.5)
    operations.hookOrder.start();
    for (const line of settings.diagnostics) logger.warn(line);
    // 안전 모드(X.operations.spec §4.6.1): 시작 옵션(`options.safeMode`, CLI `--safe-mode`)이나 설정 `x.operations.safeMode.default`(관리·사용자 범위)가 켠다.
    // 옵션이 `false`를 명시하면 설정보다 앞서 끈다
    const safeModeSource: "flag" | "setting" | undefined =
      options.safeMode === true
        ? "flag"
        : options.safeMode === false
          ? undefined
          : safeModeSettingOn(built.catalog, settings)
            ? "setting"
            : undefined;
    const safeMode = safeModeSource !== undefined;
    const reportSetting = (message: string): void => {
      logger.warn("settings.invalid", { message });
    };
    // 프로젝트 신뢰: 프로젝트 설정 파일(settings-store), 프로젝트 스킬, MCP 서버 정의가 같은 판정을 쓴다(결정 D6, X.loading-trust §4.7)
    const projectTrust = createProjectTrust({
      configDir: os.dirs.config,
      fileLock: osHandle.fileLock,
      homeDir: os.dirs.home,
      clock,
      logger: os.logger("trust"),
      defaultTrust: () =>
        defaultProjectTrustOf(settings.value("x.loading-trust.defaultProjectTrust")),
    });

    // 2. 나머지 L0 플랫폼
    const exit = options.exit ?? ((code: number): never => process.exit(code));
    shutdownCoordinator = createProcessShutdown({
      timeoutMs: shutdownTimeoutMs(settings),
      clock,
      scheduler: os.time.scheduler,
      exit,
      logger: os.logger("shutdown"),
    });
    await register(
      "platform-process",
      processPlugin({
        ids: localIds,
        settings: { shutdownTimeoutMs: shutdownTimeoutMs(settings) },
        exit,
        shutdown: shutdownCoordinator,
      }),
    );

    const dbDir = options.dataDir ?? os.dirs.data;
    mkdirSync(dbDir, { recursive: true, mode: 0o700 });
    const fsKind = await os.fsKind(dbDir, lifetime.signal);
    const store = await openStore({
      dbPath: join(dbDir, DB_FILE_NAME),
      env: {
        platform: os.info.platform,
        wsl: os.info.isWsl,
        dbDirFsKind: fsKind.ok ? fsKind.value : "unknown",
        // macOS 동봉 SQLite의 파일 이름을 문서가 정하지 않았다. FTS5가 없는 시스템 SQLite면 fts5_missing이 난다 [미결]
        bundledSqlitePath: null,
        machineId: os.machineId,
        processStartedAt: (pid) => {
          const fingerprint = os.processStartFingerprint(pid);
          return fingerprint.ok ? fingerprint.value : null;
        },
      },
      clock,
      scheduler: os.time.scheduler,
      ids,
      settings: storeSettingsOf(settings, reportSetting),
      engineVersion: ENGINE_VERSION,
    });
    if (!store.ok) {
      throw new AssembleError([storeIssueOf(store.error)], { cause: store.error });
    }
    opened.store = store.value;
    await register("platform-store", storePlugin(store.value));
    opened.registered = true;
    for (const warning of store.value.warnings) logStoreWarning(logger, warning);

    const secrets = (options.secretsRuntime ?? createSecretsRuntime)({
      os,
      ids: localIds,
      config: secretsSource(settings),
      env: process.env,
      // 같은 사용자의 CLI와 데스크톱 사이드카가 한 SOPS 파일에 동시에 쓰지 않게 하는 프로세스 사이 잠금(L0.secrets.spec §4.6 8번)
      fileLock: osHandle.fileLock,
      settingKeysFor: (handle) => Promise.resolve(settingKeysReferencing(settings, handle)),
      // 첫 키를 파일로 만들었으면 설정을 file로 저장해 다음부터 OS 키 저장소를 다시 묻지 않게 한다(L0.secrets.spec §4.7 9번). 던지지 않고 이유만 남긴다
      onFileKeyCreated: async () => {
        logger.info("secrets.age.file_key_created");
        const settingsPort = portsHandle?.ports.settings;
        if (settingsPort === undefined) {
          logger.warn("secrets.age.source_unsaved", { kind: "not_ready" });
          return;
        }
        const written = await attemptAsync(() =>
          settingsPort.write("user", "l0.secrets.ageKey.source", "file", undefined),
        );
        if (!written.ok) {
          logger.warn("secrets.age.source_unsaved", { kind: written.error.kind });
        } else if (!written.value.ok) {
          logger.warn("secrets.age.source_unsaved", { kind: written.value.error.kind });
        }
      },
    });
    await register("platform-secrets", secretsPlatform(secrets.service));
    redact.current = (line) => secrets.service.redactor.mask(line).text;

    // stdio MCP 서버를 띄우는 포트(결정 D6, 사용자 권한). 레지스트리와 트리 종료는 platform-process가, 시크릿 env는 secrets가 준다
    const mcpProcess = createHostMcpProcessPort({
      ext,
      secrets: secrets.service,
      tempDir: os.dirs.tmp,
      scheduler: os.time.scheduler,
      parentEnv: process.env,
      logger: os.logger("mcp-process"),
    });

    const platform = detectExecPlatform(os.logger("platform-exec"));
    if (!platform.ok) {
      throw new AssembleError([
        { code: "plugin", plugin: "platform-exec", message: platform.error.kind },
      ]);
    }
    await register(
      "platform-exec",
      createExecPlatformModule({
        options: execOptionsOf(settings, process.cwd(), os.dirs.state),
        platform: platform.value,
        parentEnv: process.env,
        logger: os.logger("platform-exec"),
      }),
    );
    await register("platform-sandbox", sandboxPlatform(sandboxSource(settings), lifetime.signal));

    // 3. 플러그인: 기본 확장(의존 순서), 이어서 extraPlugins
    const fingerprint = os.processStartFingerprint(process.pid);
    const holder: LeaseHolder = {
      holderId: ids.next("evt"),
      kind: ownerKindOf(options.mode),
      pid: process.pid,
      startedAt: fingerprint.ok && fingerprint.value !== null ? fingerprint.value : clock.now(),
      host: os.machineId,
    };
    // 그룹 서비스가 보는 설치된 그룹(L3 매니페스트). 단위 목록이 만들어진 뒤에 채워진다
    const unitList: { units: readonly ExtensionUnit[] } = { units: [] };
    /** 서비스가 올라온 뒤에 올리는 단위(예약). 확장 읽기 목록이 내장 단위와 함께 읽는다 */
    const lateUnits: ExtensionUnit[] = [];
    /** 로더가 찾아낸 외부 확장(싣지 못한 것 포함). 확장 읽기 목록이 읽는다 */
    /** 그룹 서비스(`host-groups` 단위가 올라올 때마다 채운다). 확장 읽기의 `group.*`가 읽는다 */
    const groupServiceSlot: { current: GroupServiceWithUsage | undefined } = { current: undefined };
    // `mcp.client` 공급자(cap-mcp가 올라올 때 채운다). 확장 읽기 `mcp.servers`가 읽는다
    const mcpClientSlot: { current: CapabilityApi<typeof McpClient> | undefined } = {
      current: undefined,
    };
    // 외부 로더가 올린 그룹(Helm). 적재가 끝나면 채워진다
    const externalGroups: { manifest: ExtensionManifest; loadIndex: number }[] = [];
    const workspaceOf = threadWorkspaceOf(ext, logger);
    const commands: CommandRegistryHolder = {
      current: undefined,
      api: undefined,
      status: undefined,
      attachments: undefined,
      notify: undefined,
      notifyListeners: new Set(),
    };
    // 대화 영역 wire(`goal.status`, `work.tasks.list`)가 읽는 목표·작업 기능 API 자리. 조립 확장이 채운다
    const dialogArea = createDialogAreaHolder();
    // 웹 런타임 자리(`web.providers`). cap-web 확장이 올라올 때 채운다
    const web: WebStatusHolder = { current: undefined };
    // 학습 그룹의 읽기 면(세션 DB의 x_learning_* 투영)과 명령 실행기, 그룹·L2 대기열을 잇는 자리. 읽기 면은 세션 서비스가 올라온 뒤(아래 4단계)에 채운다
    const learning = createLearningWiring({
      resources: () => ext.resources,
      ids,
      heldThreads: () => portsHandle?.heldThreads() ?? [],
      activeThread: () => portsHandle?.activeThread() ?? null,
    });
    // 기본 플러그인(Helm)을 사용자 확장 위치에 설치한다. 설치본이 낸 서브에이전트 정의는 엔진 조립에 필요해 단위 목록보다 먼저 읽는다
    const defaultsEnabled = options.defaultGroups !== false;
    const userExtensionsDir = join(os.dirs.config, "extensions");
    // 확장 목록(내장 단위 + 로더가 찾은 외부 확장). 예약 키 등록과 `ext.list`가 같은 원천을 읽는다
    const listExtensions = createExtensionRecords({
      units: () => [...unitList.units, ...lateUnits],
      loader: () => external.loader,
      tierOf: (name) => operations.tiers.get(name),
      userExtensionsDir,
    });
    // 목록을 읽을 때마다 예약 키도 맞춘다: 새로 설치한 확장이 목록에 보이면 그 스위치도 바로 쓸 수 있다
    const extensionRecords: typeof listExtensions = () => {
      const records = listExtensions();
      registerExtensionKeys(built.catalog, records);
      return records;
    };
    extensionKeys.sync = () => {
      extensionRecords();
    };
    // 기본 플러그인 번들 뿌리. 설치 원본이자 버전 목록의 "앱에 든 버전"이 읽는 곳이다
    const bundleRoot = options.defaultPluginsDir ?? defaultPluginsDir();
    // 개발 모드에서만 계정 회전을 더 설치한다(결정 2026-11-04 A1). 키가 카탈로그에 없으면 꺼진 것이다
    const defaultPluginNames = defaultPluginNamesFor(
      built.catalog.has("l3.authoring.devMode") && settings.value("l3.authoring.devMode") === true,
    );
    // 확장 버전 기록과 화면 목록의 원천(T-XV, HS-108). 기본 플러그인 교체가 같은 보관을 쓴다. 로더는 아래에서 채워지므로 지연으로 읽는다
    const extUi = createExtUiVersionSource({
      host: ext,
      extensionsDir: userExtensionsDir,
      clock,
      loader: () => external.loader,
      heldThreads: () => portsHandle?.heldThreads() ?? [],
      installGate: {
        safeMode: () => safeMode,
        managedLocked: (name) => {
          const def = built.catalog.get(`ext.${name}.enabled`);
          return (
            def !== undefined && resolveSetting(def, settings.layers(undefined)).setting.locked
          );
        },
      },
      // 기본 플러그인 이름만 번들 판이 있다(개발 모드 이름은 개발 모드에서만 그 목록에 든다)
      bundle: (name) =>
        defaultPluginNames.includes(name)
          ? bundledPluginVersionOf(bundleRoot, name, os.logger("default-plugins"))
          : Promise.resolve(null),
      // 제거 미리 보기와 저장 테이블 지우기(`ext.removePreview`, `ext.remove`의 `dropData`)가 쓴다
      storage: operations.storage,
    });
    if (defaultsEnabled) {
      await installDefaultPlugins(
        {
          bundleDir: bundleRoot,
          extensionsDir: userExtensionsDir,
          stateDir: os.dirs.state,
          stagingRoot: join(os.dirs.config, ".staging"),
          logger: os.logger("default-plugins"),
          history: extUi.history,
        },
        defaultPluginNames,
      );
    }
    const pluginAgents = defaultsEnabled
      ? await installedAgentDefinitions(
          userExtensionsDir,
          defaultPluginNames,
          os.logger("default-plugins"),
        )
      : [];
    // 학습 그룹의 검토 포크 정의는 내장 그룹 구성 요소라 호스트가 파일에서 읽지 않는다. 그룹을 싣을 때만 더한다 (L3.learning.spec §3.1)
    const learningAgents = learningAgentsLoaded({ defaultGroups: options.defaultGroups, safeMode });
    const agentDefinitions =
      options.agentDefinitions === undefined &&
      pluginAgents.length === 0 &&
      learningAgents.length === 0
        ? undefined
        : [...(options.agentDefinitions ?? []), ...learningAgents, ...pluginAgents];
    const units: ExtensionUnit[] = [
      ...builtinUnits({
        commands,
        dialogArea,
        web,
        mode: options.mode,
        clock,
        scheduler: runtime.scheduler,
        ids,
        chunkNumbering,
        localIds,
        logger,
        trust: projectTrust,
        signal: lifetime.signal,
        engineVersion: ENGINE_VERSION,
        ...(mcpProcess === undefined ? {} : { mcpProcess }),
        onMcpClient: (client) => {
          mcpClientSlot.current = client;
        },
        settings,
        workspaceOf,
        db: store.value.root,
        faults: store.value.faults,
        holder,
        ext,
        learning,
        // 제작 그룹의 devkit 포트: 엔진 포트가 만들어진 뒤에 읽는다
        // 개발 모드는 설정 값을 그때그때 읽는다(`l3.authoring.devMode`, 라이브). 키가 없으면 꺼짐이다
        authoring: {
          devkit: () => portsHandle?.ports.m4.devkit,
          devMode: () => settings.value("l3.authoring.devMode") === true,
          workspaceOf,
        },
        ...(options.defaultGroups === undefined ? {} : { defaultGroups: options.defaultGroups }),
        safeMode,
        groups: {
          catalog: built.catalog,
          store: () => portsHandle?.ports.settings,
          // `/group on`이 실패 장부를 비운다. 비우지 않으면 자동으로 꺼진 그룹이 재시작 전까지 다시 꺼지지 않는다(X-4)
          onEnabled: (id) => {
            operations.autoDisabler.clearLedger(`ext:${id}`);
          },
          onService: (service) => {
            groupServiceSlot.current = service;
          },
          currentThread: () => portsHandle?.activeThread() ?? null,
          heldThreads: () => portsHandle?.heldThreads() ?? [],
          entries: () => [
            ...unitList.units
              .filter((unit) => isGroupCatalogManifest(unit.manifest))
              .map((unit) => ({ manifest: unit.manifest, loadIndex: unit.loadIndex })),
            ...externalGroups.filter((entry) => isGroupCatalogManifest(entry.manifest)),
          ],
        },
        // 엔진 포트는 서비스가 모두 올라온 뒤에 만든다. 자식 thread는 그 뒤에 생기므로 그때는 채워져 있다
        parentToken: (threadId) => portsHandle?.tokenOf(threadId),
        onLeaseLost: (threadId) => {
          logger.error("persistence.lease_lost", { threadId });
        },
        reportSetting,
        ...(options.buildModels === undefined ? {} : { buildModels: options.buildModels }),
        offerBody: offerRequestBody,
        ...(options.webPorts === undefined ? {} : { webPorts: options.webPorts }),
        ...(agentDefinitions === undefined ? {} : { agentDefinitions }),
      }),
    ];
    const extras = options.extraPlugins ?? [];
    extras.forEach((module, index) => {
      units.push(unitOfModule(module, units.length + index));
    });
    // 내장 그룹은 로더를 거치지 않으므로 처음 켜짐도 설정 값에서 정한다. 값이 없으면 매니페스트 기본이다(rtC R-3)
    const enabledOfBuiltin = (name: string): boolean | undefined => {
      const key = `ext.${name}.enabled`;
      const value = built.catalog.has(key) ? settings.value(key) : undefined;
      return typeof value === "boolean" ? value : undefined;
    };
    const installable = units.map((unit): ExtensionUnit => {
      const initialEnabled =
        unit.builtin && BUILTIN_GROUP_NAMES.includes(unit.manifest.name)
          ? enabledOfBuiltin(unit.manifest.name)
          : undefined;
      return initialEnabled === undefined ? unit : { ...unit, initialEnabled };
    });
    unitList.units = installable;
    await sequentially(installable, async (unit) => {
      const result = await ext.install(unit);
      const failure = installFailureOf(result);
      if (failure !== undefined) {
        throw new AssembleError([
          { code: "plugin", plugin: failure.plugin, message: failure.message },
        ]);
      }
    });

    const unfollowThread = followThreadEnabled({
      onChange: (listener) => settings.onChange(listener),
      value: (key, threadId) => settings.value(key, threadId),
      toggles: registrationToggleSourceOf(ext),
    });
    const unfollowGlobal = followBuiltinEnabled({
      onChange: (listener) => settings.onChange(listener),
      value: (key) => settings.value(key),
      host: ext,
      names: () =>
        unitList.units
          .filter((unit) => unit.builtin && BUILTIN_GROUP_NAMES.includes(unit.manifest.name))
          .map((unit) => unit.manifest.name),
      onEnabled: (name) => {
        operations.autoDisabler.clearLedger(`ext:${name}`);
      },
    });
    external.unfollowBuiltin = () => {
      unfollowGlobal();
      unfollowThread();
    };

    // 3a. 외부 훅 단위. 안전 모드에서는 싣지 않는다(X.operations.spec §4.6.2)
    await externalHooks.install(ext, safeMode, operations.tiers);

    // 3b. 기본 플러그인으로 올린 외부 확장 적재(L4.host-service §4.1, X.loading-trust §4.4.7). 안전 모드는 외부 확장을 싣지 않는다
    if (defaultsEnabled) {
      const loaded = await loadExternalExtensions({
        ext,
        operations,
        fs: createLoaderFs(),
        userDir: os.dirs.config,
        homeDir: os.dirs.home,
        trustBackend: fileBackend(join(os.dirs.config, "trust.json"), osHandle.fileLock),
        clock,
        logger: os.logger("ext-loader"),
        enabled: (name) => {
          const key = `ext.${name}.enabled`;
          // 로더가 매니페스트를 읽는 중이라 키가 아직 없을 수 있다. 그때는 사용자 파일에 적힌 값을 그대로 읽는다(재시작 뒤에도 끈 채로 있게)
          const value = built.catalog.has(key)
            ? settings.value(key)
            : settings.raw("ext.")[`${name}.enabled`];
          return typeof value === "boolean" ? value : undefined;
        },
        cwd: process.cwd(),
        projects: options.mode === "service" ? "on_demand" : "cwd",
        signal: lifetime.signal,
        ...(safeModeSource === undefined
          ? {}
          : { startup: { safeMode: { active: true, source: safeModeSource }, disabled: [] } }),
      });
      external.loader = loaded.loader;
      // 일반 켜기 스위치도 "다시 켜기"와 같은 결과를 낸다(싣지 않은 확장을 싣고, 자동 꺼짐 표시를 지운다)
      external.unfollowEnabled = followExtEnabled({
        onChange: (listener) => settings.onChange(listener),
        value: (key) => settings.value(key),
        loader: () => external.loader,
        autoDisabler: operations.autoDisabler,
        logger: os.logger("ext-enabled"),
        signal: lifetime.signal,
      });
      externalGroups.push(...loaded.manifests);
      external.unbridge = bridgeExtensionCommands(ext, commands, os.logger("ext-commands"));
    }

    // 4. 서비스 확인: 포트가 요구하는 서비스가 모두 올라왔는지 본다
    const session = requirePort(ext, SESSION_KEY, "fresnel.session");
    late.session = session;
    const storeService = requirePort(ext, STORE_KEY, "fresnel.store");
    if (learningLoaded({ defaultGroups: options.defaultGroups, safeMode })) {
      const failed = registerLearningProjection({
        session,
        store: storeService,
        wiring: learning,
        onSkipped: (kind) => logger.warn("learning.projection_skipped", { kind }),
      });
      if (failed !== undefined) {
        throw new AssembleError([{ code: "plugin", plugin: "learning", message: failed }]);
      }
    }
    const loop = requirePort(ext, LOOP_KEY, "fresnel.loop");
    const tasks = requirePort(ext, TASKS_KEY, "fresnel.tasks");
    const approvals = requirePort(ext, APPROVALS_KEY, "fresnel.approvals");
    const tools = requirePort(ext, TOOLS_KEY, "fresnel.tools");
    const models = requirePort(ext, MODELS_KEY, "fresnel.models");
    const context = requirePort(ext, CONTEXT_KEY, "fresnel.context");
    // 예약 서비스(M3b, L4.host-service.spec §4.17). 실행이 쓰는 엔진 포트는 엔진 포트를 만든 뒤에 채운다(아래)
    const scheduleRunner: { ports: ScheduleRunnerPorts | undefined } = { ports: undefined };
    // 틱을 돌리는 프로세스: 서비스, 그리고 서비스를 쓰지 않는 앱(stdio). 쓰는 쪽은 Scheduler leader 임대로 하나만 돈다(HS-40).
    // in-process(CLI)는 명령 하나로 끝나는 일이 많아 틱을 맡지 않는다. 항목은 저장만 하고, 돌아가는 leader가 있어야 실행된다
    const ticksHere =
      options.mode === "service" ||
      (options.mode === "stdio" && settings.value("l0.process.service.enabled") !== true);
    const scheduleLeases = store.value.service.leases;
    const scheduleRuns = (): boolean => ticksHere || schedulerLeaderIsLive(scheduleLeases, clock);
    const schedule = createHostSchedule({
      ...(ticksHere
        ? {
            leader: createStoreScheduleLeader({
              leases: scheduleLeases,
              holder,
              logger: os.logger("schedule"),
              clock,
            }),
          }
        : {}),
      os,
      fileLock: osHandle.fileLock,
      clock,
      ids,
      tasks,
      loop,
      ownerKind: ownerKindOf(options.mode),
      runnerPorts: () => {
        if (scheduleRunner.ports === undefined) {
          // fresnel-disable-next-line fresnel/bug-for-expected -- 틱은 엔진 포트가 채워진 뒤에만 시작한다. 여기서 비면 조립 순서가 깨진 것이다 (eng.typescript.guide TY-24)
          throw new Bug("schedule runner used before the engine ports exist");
        }
        return scheduleRunner.ports;
      },
      logger: os.logger("schedule"),
      ...(options.schedule === undefined ? {} : { overrides: options.schedule }),
    });
    scheduleSlot.service = schedule;
    // 예약 플러그인은 서비스가 생긴 뒤에 올린다(`scheduleUnit`). 도구 등록은 core-tools가 이미 올라와 있어야 한다
    const scheduleExtension = scheduleUnit(
      schedule,
      units.length,
      layersSource(settings),
      () => !scheduleRuns(),
    );
    lateUnits.push(scheduleExtension);
    const scheduled = installFailureOf(await ext.install(scheduleExtension));
    if (scheduled !== undefined) {
      throw new AssembleError([
        { code: "plugin", plugin: scheduled.plugin, message: scheduled.message },
      ]);
    }

    // 5~6. 카탈로그는 위에서 만들었다. 세션 범위 설정을 연결한다
    settings.bindSession(session.sessionSettings);
    settings.bindWorkspaces(workspaceOf);

    // 보관 정리(L1.persistence.spec §6.1): 엔진 열기 때 한 번. 기본 설정은 아무것도 지우지 않는다
    pruneOnOpen(session, logger);
    // 측정 저장소(T-MEAS-STORE): 대화 DB와 분리한 파일. 켜고 끄는 값은 x.operations.trace.enabled다
    const measurement = startMeasurement({
      dir: dbDir,
      session,
      usage: models.usage,
      trace: traceReadOf(ext),
      enabled: () => operations.trace().enabled,
      logger,
      now: () => clock.now(),
      retentionDays: () => retentionDaysOf(built.catalog, settings),
      storeRequestBody: () =>
        built.catalog.has("x.operations.trace.storeRequestBody") &&
        settings.value("x.operations.trace.storeRequestBody") === true,
      mask: (text) => secrets.service.redactor.mask(text).text,
    });
    measureSlot.stop = measurement.stop;
    measureSlot.recordFailure = measurement.offerFailure;
    measureSlot.recordBody = measurement.offerBody;
    // spill 보관 정리(L0.exec.spec §3.8.2)와 블롭 GC(L0.store.spec §4.9)를 연다. 블롭 GC는 스케줄 실행권이 있는 서비스 모드만 돈다(HS-40)
    dataOpsSlot.ops = startDataOps({
      stateDir: os.dirs.state,
      clock,
      logger,
      setTimer,
      spillRetentionDays: () => spillRetentionDaysOf(settings),
      blobGcEnabled: () => settings.value("l0.store.blobGcEnabled") === true,
      runsBlobGc: options.mode === "service",
      store: store.value,
      query: session.query,
    });

    const storeId = parse(StoreIdSchema, storeService.storeId);
    // fresnel-disable-next-line fresnel/bug-for-expected -- 엔진 자신의 저장소가 만든 storeId라 형식 검증이 실패하면 코드 결함이다 (eng.typescript.guide TY-24)
    if (!storeId.ok) throw new Bug(`store.invalid_store_id: ${storeService.storeId}`);
    portsHandle = createEnginePorts({
      measure: {
        store: () => measurement.store,
        enabled: () => operations.trace().enabled,
      },
      mode: options.mode,
      os,
      clock,
      scheduler: os.time.scheduler,
      ids,
      logger,
      session,
      store: storeService,
      loop,
      context,
      models,
      tasks,
      approvals,
      tools,
      ext,
      holder,
      settings,
      secrets: createSecretsPort(
        secrets.admin,
        effectiveSecretsConfig(secretsSource(settings), os.dirs.config),
        createProviderLinker({
          admin: secrets.admin,
          settings,
          catalog: built.catalog,
          targetOf: (providerId) => models.providerTarget(providerId),
          logger: os.logger("secret-link"),
        }),
        secrets.service.redactor,
      ),
      commands,
      dialogArea,
      extRead: {
        operations,
        externalHooks: (threadId) =>
          safeMode
            ? []
            : externalHooks.hooksFor(threadId).hooks.map((hook) => ({
                id: hook.def.id,
                point: hook.def.point,
                source: hook.source,
                tierRank: TIERS.indexOf(hook.tier),
                unit: hookUnitName(hook.def.id),
              })),
        // `host.status.safeMode`와 같은 원인이다: 시작 옵션은 `flag`, 설정 `x.operations.safeMode.default`는 `user`
        safeMode: {
          active: safeMode,
          cause: safeModeSource === "flag" ? "flag" : safeModeSource === "setting" ? "user" : null,
        },
        extensions: extensionRecords,
        loader: () => external.loader,
        now: () => clock.now(),
        groupService: () => groupServiceSlot.current,
        mcpClient: () => mcpClientSlot.current,
      },
      web,
      proposals: createProposalPort({
        learning: () => learning.bridge.api(),
        // 그룹이 꺼져 있어도 세션 DB의 학습 기록은 남아 있어 목록은 저장소에서 읽는다(결정은 그룹이 돌 때만)
        learningStore: () => learning.reader.current,
        runner: learning.runner,
        knowledge: () => learning.knowledge.current,
        report: (message, fields) => {
          logger.warn(message, fields);
        },
      }),
      configDir: os.dirs.config,
      fileLock: osHandle.fileLock,
      trust: projectTrust,
      afterSettingsPrepare: (threadId) => externalHooks.sync(threadId),
      projectExtensions: createProjectExtensions({
        loader: () => external.loader,
        trust: projectTrust,
        logger: os.logger("project-ext"),
        signal: lifetime.signal,
      }),
      workspaceOf,
      schedule,
      extUi,
      ...(options.pendingSchedules === undefined
        ? {}
        : { pendingSchedules: options.pendingSchedules }),
      signal: lifetime.signal,
    });
    scheduleRunner.ports = portsHandle.ports;
    // 다른 프로세스가 사용자 설정 파일을 바꾸면 메모리 층을 다시 읽고 알린다(M3-REQ-49)
    const userSettingsPath = settings.userPath();
    const settingsPort = portsHandle.ports.settings;
    if (userSettingsPath !== undefined) {
      settingsWatchSlot.watch = await watchUserSettings({
        os,
        userPath: userSettingsPath,
        refresh: () => settingsPort.refreshUserFile(),
        logger: os.logger("settings-watch"),
      });
    }
    // 자동 제목(M3-REQ-83, HS-73): 턴이 끝나면 임시 제목을 모델로 바꾼다. 실패해도 턴은 그대로 둔다
    autoTitleSlot.title = startAutoTitle({
      feed: portsHandle.ports.feed,
      locks: portsHandle.ports.locks,
      session,
      modelFor: (threadId) => titleModelFor(models, clock, threadId),
      logger,
      signal: lifetime.signal,
    });
    // 틱은 서비스와 서비스를 쓰지 않는 앱(stdio)만 돌리고, Scheduler leader를 쥔 하나만 실제로 돈다(HS-40, HS-83)
    if (ticksHere) {
      const started = await schedule.start();
      if (!started.ok) {
        logger.error("schedule.start_failed", {
          kind: started.error.kind,
          message: started.error.message,
        });
      }
    }
    // 첫 입력을 받을 준비가 됐다: 연속 시작 실패 수를 0으로 되돌린다
    startupHealth.markStarted();
    const engine: Engine = {
      mode: options.mode,
      scheduleRuns,
      storeId: storeId.value,
      catalog: built.catalog,
      syncExtensionKeys: () => {
        extensionKeys.sync();
      },
      safeMode,
      startup: startupHealthOf(startupFailures, suggestAfterOf(built.catalog, settings), safeMode),
      startedAt,
      ports: portsHandle.ports,
      shutdown: shutdownCoordinator,
      diagnose: async (signal) => ({ binaries: await osHandle.checkBinaries(signal) }),
      close: shutdown,
    };
    return engine;
  } catch (caught) {
    // 조립 실패가 본 오류다. 정리 중 실패는 이슈로 덧붙여 가리지 않는다
    const cleaned = await attemptAsync(() => shutdown());
    if (caught instanceof AssembleError) {
      if (cleaned.ok) throw caught;
      throw new AssembleError([...caught.issues, pluginIssue("shutdown", cleaned.error.cause)], {
        cause: caught,
      });
    }
    const issues = [pluginIssue("assemble", caught)];
    if (!cleaned.ok) issues.push(pluginIssue("shutdown", cleaned.error.cause));
    throw new AssembleError(issues, { cause: caught });
  }
}
