import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertNever, attemptAsync, Bug, parse, type Logger } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { ExtensionManifest, PortKey } from "@xeon/contracts/extensions";
import {
  SessionServiceName,
  StoreServiceName,
  storeFailureKindOf,
  type LeaseHolder,
  type SessionService,
  type StoreFailureKind,
  type StoreService,
} from "@xeon/contracts/records";
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
} from "@xeon/contracts/services";
import { StoreIdSchema } from "@xeon/contracts/wire";
import {
  createExtHost,
  createOperationsPolicy,
  createScopeControl,
  scopeToggleSourceOf,
  type ExtDiagnostic,
  type ExtHost,
  type ExtensionLoader,
  type ExtensionUnit,
  type ScopeControl,
} from "@xeon/ext-host";
import type { ScheduleService } from "@xeon/cap-schedule";
import { createExecPlatformModule, detectExecPlatform } from "@xeon/platform-exec";
import {
  createIdFactory,
  createLocalIdFactory,
  readOsRuntime,
  type OsRuntime,
  type OsServiceHandle,
} from "@xeon/platform-os";
import { createProcessShutdown, processPlugin, type ProcessShutdown } from "@xeon/platform-process";
import { createSecretsRuntime } from "@xeon/platform-secrets";
import {
  openStore,
  storePlugin,
  type OpenedStore,
  type StoreOpenError,
  type StoreWarning,
} from "@xeon/platform-store";
import { capabilityDefsOf } from "./assembly/capability-defs.ts";
import { buildEngineCatalog } from "./assembly/catalog.ts";
import { builtinUnits, installFailureOf, unitOfModule } from "./assembly/extensions.ts";
import {
  createLearningWiring,
  learningLoaded,
  registerLearningProjection,
} from "./assembly/learning.ts";
import { createHostSchedule, type ScheduleRunnerPorts } from "./assembly/schedule.ts";
import { createProposalPort } from "./assembly/proposals.ts";
import { createLateLogSink } from "./assembly/log-sink.ts";
import { createHostMcpProcessPort } from "./assembly/mcp-process.ts";
import type { CommandRegistryHolder } from "./assembly/l2-units.ts";
import { pruneOnOpen } from "./assembly/retention.ts";
import { osPlatform, sandboxPlatform, secretsPlatform } from "./assembly/platform.ts";
import { createEnginePorts, type PortsHandle } from "./assembly/ports.ts";
import {
  createSecretsPort,
  effectiveSecretsConfig,
  settingKeysReferencing,
} from "./assembly/secrets.ts";
import { createProjectTrust, createLoaderFs, fileBackend } from "./assembly/trust.ts";
import {
  DEFAULT_PLUGIN_NAMES,
  installDefaultPlugins,
  installedAgentDefinitions,
} from "./assembly/default-plugins.ts";
import { bridgeExtensionCommands } from "./assembly/extension-commands.ts";
import { loadExternalExtensions } from "./assembly/external.ts";
import { createProjectExtensions } from "./assembly/project-extensions.ts";
import { createProviderLinker } from "./secrets/provider-link.ts";
import { createSettingsEngine, type SettingsEngine } from "./assembly/settings-engine.ts";
import type { SettingCatalog } from "@xeon/contracts/settings";
import {
  execOptionsOf,
  logLevelOf,
  operationsSource,
  primitivesSource,
  sandboxSource,
  secretsSource,
  shutdownTimeoutMs,
  storeSettingsOf,
} from "./assembly/settings-sources.ts";
import { ownerKindOf } from "./handlers/owner.ts";
import { defaultPluginsDir, hostResourceDir } from "./state-paths.ts";
import type { AssembleIssue, AssembleOptions, Engine } from "./types.ts";
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

/** 엔진 빌드 버전. 등록 파일 version과 host.hello server.version이 같은 값을 쓴다. 릴리즈 빌드가 주입하는 수단은 아직 없다 [미결] */
export const ENGINE_VERSION = "0.0.0";

/** 세션 DB 파일 이름. 문서가 이름을 정하지 않아 호스트가 정했다 [미결] */
const DB_FILE_NAME = "xeon.db";

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
    default:
      assertNever(warning, "StoreWarning");
  }
}

/** 엔진 하나를 만든다. 실패하면 AssembleError를 던지고, 그때까지 연 자원을 닫는다 */
export async function assemble(options: AssembleOptions): Promise<Engine> {
  // 설정 카탈로그는 순수 계산이라 자원을 열기 전에 만든다. 코어 키 문제는 시작 거부다(F wire §5, AH-13)
  const built = buildEngineCatalog(options.settingGroups);
  if (!built.ok) throw new AssembleError([{ code: "catalog", issues: built.issues }]);
  const settings = createSettingsEngine(built.catalog);

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
    scopes: ScopeControl | undefined;
    logger: Logger | undefined;
  } = { host: undefined, scopes: undefined, logger: undefined };
  const opened: { store: OpenedStore | undefined; registered: boolean } = {
    store: undefined,
    registered: false,
  };

  const scopeControl: ScopeControl = {
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
  const operations = createOperationsPolicy({
    now: () => clock.now(),
    setTimer,
    settings: operationsSource(settings),
    scopes: scopeControl,
    ports: {
      get: (key) => late.host?.ports.get(key),
    },
    log: (line) => {
      late.logger?.warn("ext.operations", { line });
    },
  });
  const diagnostics: ExtDiagnostic[] = [];
  const ext = createExtHost({
    ids,
    now: () => clock.now(),
    setTimer,
    policy: operations,
    setupBudgetMs: () => operations.setupBudgetMs(),
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
  late.scopes = createScopeControl(scopeToggleSourceOf(ext));

  let portsHandle: PortsHandle | undefined;
  let shutdownCoordinator: ProcessShutdown | undefined;
  const osSlot: { handle: OsServiceHandle | undefined } = { handle: undefined };
  /** 예약 서비스. 서비스 등록 뒤(4단계)에 채운다. 닫을 때 아직 없으면 건너뛴다 */
  const scheduleSlot: { service: ScheduleService | undefined } = { service: undefined };
  const closing: { promise: Promise<void> | undefined } = { promise: undefined };
  /** 외부 확장 로더(기본 플러그인 포함). 닫을 때 먼저 내린다 */
  const external: { loader: ExtensionLoader | undefined; unbridge: (() => void) | undefined } = {
    loader: undefined,
    unbridge: undefined,
  };

  async function closeAll(): Promise<void> {
    try {
      // 예약을 먼저 멈춘다: 틱과 감시를 끊고 진행 중인 저장을 기다린다. 저장소를 닫기 전이어야 한다
      await scheduleSlot.service?.close();
      await portsHandle?.releaseAll();
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
        [{ code: "plugin", plugin: name, message: `${name} failed to start (${reason})` }],
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
        },
        runtime,
        (handle) => {
          osSlot.handle = handle;
        },
      ),
    );
    const os: OsService = requirePort(ext, OsPortKey, "xeon.os");
    const osHandle = osSlot.handle;
    // xeon.os를 올린 setup이 핸들을 넘긴다. 없으면 조립 순서가 깨진 것이다
    // xeon-disable-next-line xeon/bug-for-expected -- osPlatform의 setup이 성공하면 핸들이 항상 채워진다 (eng.typescript.guide TY-24)
    if (osHandle === undefined) throw new Bug("platform-os did not hand over its handle");
    logSink.attach(join(os.dirs.state, "logs", `${options.mode}.log`));
    const logger = os.logger("host");
    late.logger = logger;
    await settings.loadUserFile(join(os.dirs.config, "settings.json"));
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
    });
    await register("platform-secrets", secretsPlatform(secrets.service));
    redact.current = (line) => secrets.service.redactor.mask(line).text;

    // stdio MCP 서버를 띄우는 포트(결정 D6, 사용자 권한). 레지스트리와 트리 종료는 platform-process가, 비밀 env는 secrets가 준다
    const mcpProcess = createHostMcpProcessPort({
      ext,
      secrets: secrets.service,
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
    // 외부 로더가 올린 그룹(Helm). 적재가 끝나면 채워진다
    const externalGroups: { manifest: ExtensionManifest; loadIndex: number }[] = [];
    const workspaceOf = threadWorkspaceOf(ext, logger);
    const commands: CommandRegistryHolder = { current: undefined, api: undefined };
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
    if (defaultsEnabled) {
      await installDefaultPlugins({
        bundleDir: options.defaultPluginsDir ?? defaultPluginsDir(),
        extensionsDir: userExtensionsDir,
        stateDir: os.dirs.state,
        stagingRoot: join(os.dirs.config, ".staging"),
        logger: os.logger("default-plugins"),
      });
    }
    const pluginAgents = defaultsEnabled
      ? await installedAgentDefinitions(
          userExtensionsDir,
          DEFAULT_PLUGIN_NAMES,
          os.logger("default-plugins"),
        )
      : [];
    const agentDefinitions =
      options.agentDefinitions === undefined && pluginAgents.length === 0
        ? undefined
        : [...(options.agentDefinitions ?? []), ...pluginAgents];
    const units: ExtensionUnit[] = [
      ...builtinUnits({
        commands,
        mode: options.mode,
        clock,
        ids,
        localIds,
        logger,
        trust: projectTrust,
        signal: lifetime.signal,
        engineVersion: ENGINE_VERSION,
        ...(mcpProcess === undefined ? {} : { mcpProcess }),
        settings,
        workspaceOf,
        db: store.value.root,
        faults: store.value.faults,
        holder,
        ext,
        learning,
        ...(options.defaultGroups === undefined ? {} : { defaultGroups: options.defaultGroups }),
        safeMode,
        groups: {
          catalog: built.catalog,
          store: () => portsHandle?.ports.settings,
          currentThread: () => portsHandle?.activeThread() ?? null,
          heldThreads: () => portsHandle?.heldThreads() ?? [],
          entries: () => [
            ...unitList.units
              .filter((unit) => unit.manifest.layer === "L3")
              .map((unit) => ({ manifest: unit.manifest, loadIndex: unit.loadIndex })),
            ...externalGroups.filter((entry) => entry.manifest.layer === "L3"),
          ],
        },
        // 엔진 포트는 서비스가 모두 올라온 뒤에 만든다. 자식 thread는 그 뒤에 생기므로 그때는 채워져 있다
        parentToken: (threadId) => portsHandle?.tokenOf(threadId),
        onLeaseLost: (threadId) => {
          logger.error("persistence.lease_lost", { threadId });
        },
        reportSetting,
        ...(options.buildModels === undefined ? {} : { buildModels: options.buildModels }),
        ...(options.webPorts === undefined ? {} : { webPorts: options.webPorts }),
        ...(agentDefinitions === undefined ? {} : { agentDefinitions }),
      }),
    ];
    const extras = options.extraPlugins ?? [];
    extras.forEach((module, index) => {
      units.push(unitOfModule(module, units.length + index));
    });
    unitList.units = units;
    await sequentially(units, async (unit) => {
      const result = await ext.install(unit);
      const failure = installFailureOf(result);
      if (failure !== undefined) {
        throw new AssembleError([
          { code: "plugin", plugin: failure.plugin, message: failure.message },
        ]);
      }
    });

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
          const value = built.catalog.has(key) ? settings.value(key) : undefined;
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
      externalGroups.push(...loaded.manifests);
      external.unbridge = bridgeExtensionCommands(ext, commands, os.logger("ext-commands"));
    }

    // 4. 서비스 확인: 포트가 요구하는 서비스가 모두 올라왔는지 본다
    const session = requirePort(ext, SESSION_KEY, "xeon.session");
    const storeService = requirePort(ext, STORE_KEY, "xeon.store");
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
    const loop = requirePort(ext, LOOP_KEY, "xeon.loop");
    const tasks = requirePort(ext, TASKS_KEY, "xeon.tasks");
    const approvals = requirePort(ext, APPROVALS_KEY, "xeon.approvals");
    const tools = requirePort(ext, TOOLS_KEY, "xeon.tools");
    const models = requirePort(ext, MODELS_KEY, "xeon.models");
    const context = requirePort(ext, CONTEXT_KEY, "xeon.context");
    // 예약 서비스(M3b, L4.host-service.spec §4.17). 실행이 쓰는 엔진 포트는 엔진 포트를 만든 뒤에 채운다(아래)
    const scheduleRunner: { ports: ScheduleRunnerPorts | undefined } = { ports: undefined };
    const schedule = createHostSchedule({
      os,
      clock,
      ids,
      tasks,
      loop,
      ownerKind: ownerKindOf(options.mode),
      runnerPorts: () => {
        if (scheduleRunner.ports === undefined) {
          // xeon-disable-next-line xeon/bug-for-expected -- 틱은 엔진 포트가 채워진 뒤에만 시작한다. 여기서 비면 조립 순서가 깨진 것이다 (eng.typescript.guide TY-24)
          throw new Bug("schedule runner used before the engine ports exist");
        }
        return scheduleRunner.ports;
      },
      logger: os.logger("schedule"),
      ...(options.schedule === undefined ? {} : { overrides: options.schedule }),
    });
    scheduleSlot.service = schedule;

    // 5~6. 카탈로그는 위에서 만들었다. 세션 범위 설정을 연결한다
    settings.bindSession(session.sessionSettings);
    settings.bindWorkspaces(workspaceOf);

    // 보관 정리(L1.persistence.spec §6.1): 엔진 열기 때 한 번. 기본 설정은 아무것도 지우지 않는다
    pruneOnOpen(session, logger);

    const storeId = parse(StoreIdSchema, storeService.storeId);
    // xeon-disable-next-line xeon/bug-for-expected -- 엔진 자신의 저장소가 만든 storeId라 형식 검증이 실패하면 코드 결함이다 (eng.typescript.guide TY-24)
    if (!storeId.ok) throw new Bug(`store.invalid_store_id: ${storeService.storeId}`);
    portsHandle = createEnginePorts({
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
      ),
      commands,
      proposals: createProposalPort({
        learning: () => learning.bridge.api(),
        runner: learning.runner,
        knowledge: () => learning.knowledge.current,
        report: (message, fields) => {
          logger.warn(message, fields);
        },
      }),
      configDir: os.dirs.config,
      trust: projectTrust,
      projectExtensions: createProjectExtensions({
        mode: options.mode,
        loader: () => external.loader,
        trust: projectTrust,
        logger: os.logger("project-ext"),
      }),
      workspaceOf,
      schedule,
      ...(options.pendingSchedules === undefined
        ? {}
        : { pendingSchedules: options.pendingSchedules }),
      signal: lifetime.signal,
    });
    scheduleRunner.ports = portsHandle.ports;
    // 틱은 서비스 모드에서만 돈다. in-process·stdio는 프로세스 사이 임대가 없어 틱의 실행권을 정할 수 없다(HS-40)
    if (options.mode === "service") {
      const started = await schedule.start();
      if (!started.ok) {
        logger.error("schedule.start_failed", {
          kind: started.error.kind,
          message: started.error.message,
        });
      }
    }
    const engine: Engine = {
      mode: options.mode,
      storeId: storeId.value,
      catalog: built.catalog,
      safeMode,
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
