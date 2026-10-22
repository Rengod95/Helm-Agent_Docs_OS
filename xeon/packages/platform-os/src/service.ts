import { assertNever, err, ok, type LogLevel, type Result } from "@xeon/contracts";
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
import { createBinaryResolver, type BundledSource } from "./binaries/resolve.ts";
import { dirsWarnings, ensureDirs, resolveDirs } from "./dirs.ts";
import {
  createMountProvider,
  createNoopFsKindProvider,
  createStatfsProvider,
  resolveFsKind,
  type FsKindProvider,
} from "./fs-kind.ts";
import { createFingerprintReader, readMachineId, readUserId } from "./identity.ts";
import { createJsonLinesLogger, type LogRedact, type LogSink } from "./logger.ts";
import { readOsRuntime, type OsRuntime } from "./runtime.ts";
import { detectPlatform, selectProviders, type FsKindSource } from "./select.ts";

export interface PlatformOsConfig {
  /** 앱과 함께 배포된 읽기 전용 자원 디렉터리. L4가 넘긴다 */
  readonly resourceDir: string;
  readonly logSink: LogSink;
  /** 조립 루트가 xeon.secrets의 마스킹 함수를 연결한다. 무동작이 필요하면 identity를 명시적으로 넘긴다 */
  readonly logRedact: LogRedact;
  /** 설정 l0.os.log.level. 기본 "info" */
  readonly logLevel?: LogLevel;
  /** 설정 l0.os.dirs.override(관리 범위). XEON_HOME보다 낮고 OS 기본보다 높다 */
  readonly dirsOverride?: string;
  /** 소스 실행에서 번들 바이너리 경로를 주는 수단(예: @vscode/ripgrep 연결). 없으면 목록 파일과 시스템만 본다 */
  readonly bundledSource?: BundledSource;
}

/** 서비스 시작 실패. 플랫폼 판별과 디렉터리 해석·생성·검사의 오류다 */
export type OsStartError = DirsError;

export interface OsServiceHandle {
  readonly service: OsService;
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
 * 바이너리 해석은 처음 쓸 때 한다. 알림(M3), 파일 감시와 텔레메트리(M2 이후)는 아직 없어 정해진 값을 돌려준다.
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
    ...(config.bundledSource === undefined ? {} : { bundledSource: config.bundledSource }),
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
    notify: () => Promise.resolve(err({ kind: "disabled" })),
    watch: () =>
      Promise.resolve(
        err({ kind: "backend_unavailable", reason: "file watching starts at M2 (OS-14)" }),
      ),
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
    setLogLevel: (level) => rootLogger.setLevel(level),
    dispose(): Promise<void> {
      if (disposed) return Promise.resolve();
      disposed = true;
      lifetime.abort();
      runtime.scheduler.dispose();
      logger.info("os.service.stopped");
      return Promise.resolve();
    },
  });
}
