import { assertNever, ok, type LogLevel, type Result } from "@xeon/contracts";
import type {
  BinaryName,
  DirsError,
  FsKind,
  FsKindError,
  OsDirs,
  OsService,
  OsTelemetry,
  ResolveBinaryOptions,
  ResolvedBinary,
  BinaryError,
} from "@xeon/contracts/services";
import { createRipgrepSource } from "./binaries/rg.ts";
import { checkExternalBinaries, type BinaryCheckReport } from "./binaries/requirements.ts";
import { createBinaryResolver, type BundledSource } from "./binaries/resolve.ts";
import { createFileLock, type FileLock } from "./file-lock/index.ts";
import {
  createNotify,
  createOsNotifierProvider,
  type NotifierProvider,
} from "./notify/provider.ts";
import { createFsWatchBackend } from "./watch/fs-watch.ts";
import { createFileWatcher, type WatchBackend } from "./watch/watcher.ts";
import { createWorktreeOps, type WorktreeOps } from "./worktree.ts";
import { dirsWarnings, ensureDirs, resolveDirs } from "./dirs.ts";
import {
  createMountProvider,
  createNoopFsKindProvider,
  createStatfsProvider,
  resolveFsKind,
  type FsKindProvider,
} from "./fs-kind.ts";
import { createFingerprintReader, readMachineId, readUserId } from "./identity.ts";
import {
  createJsonLinesLogger,
  type LogLevelSource,
  type LogRedact,
  type LogSink,
} from "./logger.ts";
import { readOsRuntime, type OsRuntime } from "./runtime.ts";
import { detectPlatform, selectProviders, type FsKindSource } from "./select.ts";

export interface PlatformOsConfig {
  /** 앱과 함께 배포된 읽기 전용 자원 디렉터리. L4가 넘긴다 */
  readonly resourceDir: string;
  readonly logSink: LogSink;
  /** 조립 루트가 xeon.secrets의 마스킹 함수를 연결한다. 무동작이 필요하면 identity를 명시적으로 넘긴다 */
  readonly logRedact: LogRedact;
  /**
   * 설정 l0.os.log.level. 기본 "info". 함수를 넘기면 로그를 낼 때마다 불러 live 변경이 다음 호출부터 반영된다
   * (조립 루트가 `() => settings.get("l0.os.log.level")`를 넘긴다).
   */
  readonly logLevel?: LogLevelSource;
  /** 설정 l0.os.dirs.override(관리 범위). XEON_HOME보다 낮고 OS 기본보다 높다 */
  readonly dirsOverride?: string;
  /** 소스 실행에서 번들 바이너리 경로를 주는 수단. 없으면 `@vscode/ripgrep`이 주는 rg를 쓴다(목록 파일이 있으면 그쪽이 먼저다) */
  readonly bundledSource?: BundledSource;
  /**
   * 알림 provider(L0.os.spec §3.7). 생략하면 OS 기본(macOS osascript, Linux·WSL notify-send)을 고르고,
   * null이면 provider none이라 notify가 disabled를 돌려준다. 데스크톱은 L4가 wire 알림 provider를 넘긴다.
   */
  readonly notifier?: NotifierProvider | null;
  /**
   * config·data·state 밖에서 감시를 허용하는 절대 경로(워크트리 루트 등) [결정: 오케스트레이터 기본값: 기본 없음].
   * M3-REQ-48의 감시 root 완화는 호출자가 이 목록으로 명시한 경로에만 적용된다.
   */
  readonly extraWatchRoots?: readonly string[];
  /** 감시 백엔드. 앞에서부터 시도한다. 기본 fs.watch 하나(`@parcel/watcher` 어댑터는 승인 뒤 여기에 앞세운다) */
  readonly watchBackends?: readonly WatchBackend[];
}

/** 서비스 시작 실패. 플랫폼 판별과 디렉터리 해석·생성·검사의 오류다 */
export type OsStartError = DirsError;

export interface OsServiceHandle {
  readonly service: OsService;
  /**
   * 프로세스 사이 파일 잠금(L0.os.spec §3.11). F `OsService`에는 아직 없어 핸들로 낸다 [F 요청].
   * M2에서는 `trust.json` 쓰기가 쓴다.
   */
  readonly fileLock: FileLock;
  /**
   * 외부 바이너리 필수/선택 표(L0.os.spec §3.6.1)를 이 서비스의 `resolveBinary`로 점검한다.
   * 첫 실행 안내와 doctor가 쓴다. 이름별 해석 캐시를 그대로 쓴다.
   */
  /** git 워크트리 연산(L0.os.spec §3.13). F `OsService`에는 아직 없어 핸들로 낸다 [F 요청] */
  readonly worktrees: WorktreeOps;
  checkBinaries(signal: AbortSignal): Promise<Result<BinaryCheckReport, { kind: "cancelled" }>>;
  /** 설정 l0.os.log.level 변경(live)을 반영한다 */
  setLogLevel(level: LogLevel): void;
  /** 진행 중인 자식 프로세스 중단, 남은 타이머 취소, 로거 마지막 줄 */
  dispose(): Promise<void>;
}

const NOOP_SPAN: unknown = {};
const DISABLED_TELEMETRY: OsTelemetry = {
  enabled: false,
  tracer: () => ({ startSpan: () => NOOP_SPAN }),
};

function pickFsKindProvider(source: FsKindSource, runtime: OsRuntime): FsKindProvider {
  switch (source) {
    case "statfs":
      return createStatfsProvider();
    case "mount":
      return createMountProvider(runtime.run);
    case "none":
      return createNoopFsKindProvider();
    default:
      return assertNever(source, "FsKindSource");
  }
}

/**
 * 디렉터리 위치만 정한다. 파일 시스템을 건드리지 않고 서비스도 시작하지 않는다. `createOsService`가 쓰는 규칙과 같아서,
 * 서비스를 띄우지 않는 쪽(예: CLI 상태 파일 위치를 묻는 호스트 API)이 같은 경로를 얻는다(L0.os.spec §3.2).
 */
export function resolveOsDirs(
  config: Pick<PlatformOsConfig, "resourceDir" | "dirsOverride">,
  runtime: OsRuntime = readOsRuntime(),
): Result<OsDirs, OsStartError> {
  const detected = detectPlatform(runtime.probe);
  if (!detected.ok) return detected;
  return resolveDirs({
    info: detected.value,
    env: runtime.env,
    home: runtime.home,
    systemTmp: runtime.systemTmp,
    uid: runtime.getuid?.(),
    resourceDir: config.resourceDir,
    ...(config.dirsOverride === undefined ? {} : { managedOverride: config.dirsOverride }),
  });
}

/**
 * OsService를 조립한다. 순서: 플랫폼 판별, 디렉터리 해석, 디렉터리 생성·검사, 로거, 기계 식별자(L0.os.spec §4 1번).
 * 바이너리 해석은 처음 쓸 때 한다. 텔레메트리는 아직 없어 꺼진 값을 돌려준다.
 */
export async function createOsService(
  config: PlatformOsConfig,
  runtime: OsRuntime,
): Promise<Result<OsServiceHandle, OsStartError>> {
  const detected = detectPlatform(runtime.probe);
  if (!detected.ok) return detected;
  const info = detected.value;

  const resolved = resolveOsDirs(config, runtime);
  if (!resolved.ok) return resolved;
  const dirs = resolved.value;

  const lifetime = new AbortController();
  const ensured = await ensureDirs(dirs, runtime.dirFs, lifetime.signal);
  if (!ensured.ok) return ensured;

  const rootLogger = createJsonLinesLogger({
    clock: runtime.clock,
    sink: config.logSink,
    level: config.logLevel ?? "info",
    redact: config.logRedact,
  });
  const logger = rootLogger.child({ component: "platform-os" });
  for (const warning of dirsWarnings(info, dirs))
    logger.warn(`os.dirs.${warning.kind}`, { path: warning.path });

  const providers = selectProviders(info);
  const machineId = await readMachineId(
    {
      source: providers.machineId,
      readFile: runtime.readFile,
      run: runtime.run,
      hostname: runtime.hostname,
      logger,
    },
    lifetime.signal,
  );
  const userId = readUserId(runtime.getuid);
  const fingerprint = createFingerprintReader({
    source: providers.fingerprint,
    platform: info.platform,
    readFileSync: runtime.readFileSync,
    runSync: runtime.runSync,
    clkTck: runtime.clkTck,
  });
  const fsProvider = pickFsKindProvider(providers.fsKind, runtime);
  const binaryResolver = createBinaryResolver({
    info,
    resourceDir: dirs.resource,
    pathEnv: runtime.env.get("PATH"),
    fs: runtime.binaryFs,
    run: runtime.run,
    logger,
    lifetime: lifetime.signal,
    // 소스 실행의 번들 rg는 @vscode/ripgrep이 준다. 조립 루트가 다른 수단을 넘기면 그것을 쓴다
    bundledSource: config.bundledSource ?? createRipgrepSource({ run: runtime.run, logger }),
  });

  const primitive =
    providers.fileLock.kind === "flock" ? runtime.createFlock(providers.fileLock) : undefined;
  if (providers.fileLock.kind === "flock" && primitive === undefined) {
    logger.warn("os.file_lock.process_only", { reason: "flock_unavailable" });
  }
  const fileLock = createFileLock({
    primitive,
    clock: runtime.clock,
    scheduler: runtime.scheduler,
    logger,
  });

  const notifier =
    config.notifier === undefined
      ? createOsNotifierProvider({ info, run: runtime.run, logger })
      : (config.notifier ?? undefined);
  const watcher = createFileWatcher({
    allowedRoots: [dirs.config, dirs.data, dirs.state, ...(config.extraWatchRoots ?? [])],
    scheduler: runtime.scheduler,
    logger,
    backends: config.watchBackends ?? [createFsWatchBackend({ logger })],
  });

  const service: OsService = {
    info,
    dirs,
    time: { clock: runtime.clock, scheduler: runtime.scheduler, random: runtime.random },
    machineId,
    userId,
    processStartFingerprint: fingerprint,
    logger: (component) => rootLogger.child({ component }),
    fsKind(path: string, signal: AbortSignal): Promise<Result<FsKind, FsKindError>> {
      return resolveFsKind(info, fsProvider, path, signal);
    },
    resolveBinary(
      name: BinaryName,
      opts: ResolveBinaryOptions,
      signal: AbortSignal,
    ): Promise<Result<ResolvedBinary, BinaryError>> {
      return binaryResolver(name, opts, signal);
    },
    notify: createNotify({ provider: notifier, clock: runtime.clock, redact: config.logRedact }),
    watch: (root, opts, onBatch) => watcher.watch(root, opts, onBatch),
    telemetry: DISABLED_TELEMETRY,
  };

  logger.info("os.service.started", {
    platform: info.platform,
    arch: info.arch,
    isWsl: info.isWsl,
  });
  let disposed = false;
  return ok({
    service,
    fileLock,
    worktrees: createWorktreeOps({ run: runtime.run }),
    checkBinaries: (signal) =>
      checkExternalBinaries(
        {
          platform: info.platform,
          resolveBinary: (name, opts, scope) => service.resolveBinary(name, opts, scope),
        },
        signal,
      ),
    setLogLevel: (level) => rootLogger.setLevel(level),
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      await watcher.closeAll();
      runtime.scheduler.dispose();
      logger.info("os.service.stopped");
    },
  });
}
