import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertNever, attemptAsync, Bug, parse, type Logger } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { PortKey } from "@xeon/contracts/extensions";
import {
  SessionServiceName,
  StoreServiceName,
  type LeaseHolder,
  type SessionService,
  type StoreService,
} from "@xeon/contracts/records";
import {
  ApprovalServiceName,
  LoopServiceName,
  ModelServiceName,
  OsPortKey,
  TaskServiceName,
  ToolServiceName,
  type ApprovalService,
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
  type ExtensionUnit,
  type ScopeControl,
} from "@xeon/ext-host";
import { createExecPlatformModule, detectExecPlatform } from "@xeon/platform-exec";
import {
  createIdFactory,
  createLocalIdFactory,
  platformOsPlugin,
  readOsRuntime,
  type OsRuntime,
} from "@xeon/platform-os";
import { createProcessShutdown, processPlugin, type ProcessShutdown } from "@xeon/platform-process";
import { createSecretsRuntime } from "@xeon/platform-secrets";
import {
  openStore,
  storePlugin,
  type OpenedStore,
  type StoreOpenError,
} from "@xeon/platform-store";
import { buildEngineCatalog } from "./assembly/catalog.ts";
import { builtinUnits, installFailureOf, unitOfModule } from "./assembly/extensions.ts";
import { createLateLogSink } from "./assembly/log-sink.ts";
import { pruneOnOpen } from "./assembly/retention.ts";
import { sandboxPlatform, secretsPlatform } from "./assembly/platform.ts";
import { createEnginePorts, type PortsHandle } from "./assembly/ports.ts";
import { createSecretsPort, settingKeysReferencing } from "./assembly/secrets.ts";
import { createProjectTrust } from "./assembly/trust.ts";
import { createSettingsEngine } from "./assembly/settings-engine.ts";
import {
  execOptionsOf,
  operationsSource,
  primitivesSource,
  sandboxSource,
  secretsSource,
  shutdownTimeoutMs,
  storeSettingsOf,
} from "./assembly/settings-sources.ts";
import { ownerKindOf } from "./handlers/owner.ts";
import { hostResourceDir } from "./state-paths.ts";
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

function describeIssue(issue: AssembleIssue): string {
  switch (issue.code) {
    case "catalog":
      return `catalog: ${issue.issues.map((entry) => `${entry.code} ${"key" in entry ? entry.key : ""}`).join(", ")}`;
    case "store":
      return `store: ${issue.message}`;
    case "missingService":
      return `missing service ${issue.service}`;
    case "plugin":
      return `plugin ${issue.plugin}: ${issue.message}`;
    default:
      return assertNever(issue, "AssembleIssue");
  }
}

/** 저장소를 열지 못한 이유를 CLI가 구별하는 이름으로 옮긴다(L4.host-service.spec §3.3.5 EngineStartError 대응) */
function storeMessageOf(error: StoreOpenError): string {
  switch (error.kind) {
    case "fts5_missing":
      return "fts5Missing";
    case "permission":
    case "unsupported_filesystem":
      return "dataDirPermission";
    case "db_path_invalid":
    case "foreign_database":
    case "corrupt":
    case "busy":
    case "disk_full":
    case "io":
    case "migration_checksum_mismatch":
    case "migration_failed":
    case "migration_future_version":
    case "migration_gap":
      return "storeUnavailable";
    default:
      return assertNever(error, "StoreOpenError");
  }
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

function requirePort<Api>(ext: ExtHost, key: PortKey<Api>, service: string): Api {
  const found = ext.ports.get(key);
  if (found === undefined) throw new AssembleError([{ code: "missingService", service }]);
  return found;
}

/**
 * thread의 작업 디렉터리. 세션 서비스가 올라오기 전이거나 모르는 thread, 작업 디렉터리가 없는 thread면 undefined다.
 * 설정 층(project·local 파일)과 `user_bash`의 cwd가 같은 값을 쓴다
 */
function threadWorkspaceOf(ext: ExtHost): (threadId: ThreadId) => string | undefined {
  return (threadId) => {
    const found = ext.ports.get(SESSION_KEY)?.query.thread(threadId);
    return found?.ok === true ? (found.value?.workspace ?? undefined) : undefined;
  };
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
  const closing: { promise: Promise<void> | undefined } = { promise: undefined };

  async function closeAll(): Promise<void> {
    try {
      await portsHandle?.releaseAll();
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
      platformOsPlugin(
        {
          resourceDir: hostResourceDir(),
          logSink: logSink.sink,
          logRedact: (line) => redact.current(line),
        },
        runtime,
      ),
    );
    const os: OsService = requirePort(ext, OsPortKey, "xeon.os");
    logSink.attach(join(os.dirs.state, "logs", `${options.mode}.log`));
    const logger = os.logger("host");
    late.logger = logger;
    await settings.loadUserFile(join(os.dirs.config, "settings.json"));
    for (const line of settings.diagnostics) logger.warn(line);
    const reportSetting = (message: string): void => {
      logger.warn("settings.invalid", { message });
    };
    // 프로젝트 신뢰: 프로젝트 설정 파일(settings-store), 프로젝트 스킬, MCP 서버 정의가 같은 판정을 쓴다(결정 D6, X.loading-trust §4.7)
    const projectTrust = createProjectTrust({
      configDir: os.dirs.config,
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
      throw new AssembleError([{ code: "store", message: storeMessageOf(store.error) }], {
        cause: store.error,
      });
    }
    opened.store = store.value;
    await register("platform-store", storePlugin(store.value));
    opened.registered = true;

    const secrets = createSecretsRuntime({
      os,
      ids: localIds,
      config: secretsSource(settings),
      env: process.env,
      settingKeysFor: (handle) => Promise.resolve(settingKeysReferencing(settings, handle)),
    });
    await register("platform-secrets", secretsPlatform(secrets.service));
    redact.current = (line) => secrets.service.redactor.mask(line).text;

    const platform = detectExecPlatform(os.logger("platform-exec"));
    if (!platform.ok) {
      throw new AssembleError([
        { code: "plugin", plugin: "platform-exec", message: platform.error.kind },
      ]);
    }
    await register(
      "platform-exec",
      createExecPlatformModule({
        options: execOptionsOf(settings, process.cwd()),
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
    const workspaceOf = threadWorkspaceOf(ext);
    const units: ExtensionUnit[] = [
      ...builtinUnits({
        mode: options.mode,
        clock,
        ids,
        localIds,
        logger,
        trust: projectTrust,
        signal: lifetime.signal,
        engineVersion: ENGINE_VERSION,
        settings,
        workspaceOf,
        db: store.value.root,
        faults: store.value.faults,
        holder,
        ext,
        groups: {
          catalog: built.catalog,
          store: () => portsHandle?.ports.settings,
          currentThread: () => portsHandle?.activeThread() ?? null,
          heldThreads: () => portsHandle?.heldThreads() ?? [],
          entries: () =>
            unitList.units
              .filter((unit) => unit.manifest.layer === "L3")
              .map((unit) => ({ manifest: unit.manifest, loadIndex: unit.loadIndex })),
        },
        // 엔진 포트는 서비스가 모두 올라온 뒤에 만든다. 자식 thread는 그 뒤에 생기므로 그때는 채워져 있다
        parentToken: (threadId) => portsHandle?.tokenOf(threadId),
        onLeaseLost: (threadId) => {
          logger.error("persistence.lease_lost", { threadId });
        },
        reportSetting,
        ...(options.buildModels === undefined ? {} : { buildModels: options.buildModels }),
        ...(options.webPorts === undefined ? {} : { webPorts: options.webPorts }),
        ...(options.agentDefinitions === undefined
          ? {}
          : { agentDefinitions: options.agentDefinitions }),
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

    // 4. 서비스 확인: 포트가 요구하는 서비스가 모두 올라왔는지 본다
    const session = requirePort(ext, SESSION_KEY, "xeon.session");
    const storeService = requirePort(ext, STORE_KEY, "xeon.store");
    const loop = requirePort(ext, LOOP_KEY, "xeon.loop");
    const tasks = requirePort(ext, TASKS_KEY, "xeon.tasks");
    const approvals = requirePort(ext, APPROVALS_KEY, "xeon.approvals");
    const tools = requirePort(ext, TOOLS_KEY, "xeon.tools");
    requirePort(ext, MODELS_KEY, "xeon.models");

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
      tasks,
      approvals,
      tools,
      ext,
      holder,
      settings,
      secrets: createSecretsPort(secrets.admin, secretsSource(settings)),
      configDir: os.dirs.config,
      trust: projectTrust,
      signal: lifetime.signal,
    });
    const engine: Engine = {
      mode: options.mode,
      storeId: storeId.value,
      catalog: built.catalog,
      startedAt,
      ports: portsHandle.ports,
      shutdown: shutdownCoordinator,
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
