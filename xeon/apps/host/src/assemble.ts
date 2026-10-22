import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertNever, attemptAsync, Bug, parse, type Logger } from "@xeon/contracts";
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
import { processPlugin } from "@xeon/platform-process";
import { createSecretService } from "@xeon/platform-secrets";
import {
  openStore,
  storePlugin,
  type OpenedStore,
  type StoreOpenError,
} from "@xeon/platform-store";
import { buildEngineCatalog } from "./assembly/catalog.ts";
import { builtinUnits, installFailureOf, unitOfModule } from "./assembly/extensions.ts";
import { createLateLogSink } from "./assembly/log-sink.ts";
import { sandboxPlatform, secretsPlatform } from "./assembly/platform.ts";
import { createEnginePorts, type PortsHandle } from "./assembly/ports.ts";
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
    try {
      await ext.registerPlatform(module);
    } catch (caught) {
      throw new AssembleError([pluginIssue(name, caught)], { cause: caught });
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

    // 2. 나머지 L0 플랫폼
    await register(
      "platform-process",
      processPlugin({
        ids: localIds,
        settings: { shutdownTimeoutMs: shutdownTimeoutMs(settings) },
        exit: (code) => process.exit(code),
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

    const secrets = createSecretService({
      os,
      ids: localIds,
      config: secretsSource(settings),
      env: process.env,
    });
    await register("platform-secrets", secretsPlatform(secrets));
    redact.current = (line) => secrets.redactor.mask(line).text;

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
    const units: ExtensionUnit[] = [
      ...builtinUnits({
        mode: options.mode,
        clock,
        ids,
        logger,
        settings,
        db: store.value.root,
        faults: store.value.faults,
        holder,
        onLeaseLost: (threadId) => {
          logger.error("persistence.lease_lost", { threadId });
        },
        reportSetting,
        ...(options.buildModels === undefined ? {} : { buildModels: options.buildModels }),
      }),
    ];
    const extras = options.extraPlugins ?? [];
    extras.forEach((module, index) => {
      units.push(unitOfModule(module, units.length + index));
    });
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

    const storeId = parse(StoreIdSchema, storeService.storeId);
    if (!storeId.ok) throw new Bug(`store.invalid_store_id: ${storeService.storeId}`);
    portsHandle = createEnginePorts({
      mode: options.mode,
      os,
      clock,
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
      signal: lifetime.signal,
    });
    const engine: Engine = {
      mode: options.mode,
      storeId: storeId.value,
      catalog: built.catalog,
      startedAt,
      ports: portsHandle.ports,
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
