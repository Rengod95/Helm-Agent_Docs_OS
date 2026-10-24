import type { Logger } from "@xeon/contracts";
import {
  describeSandboxStatus,
  type CancelScope,
  type OsService,
  type ProtectedPathEntry,
  type SandboxPolicy,
  type SandboxService,
  type SandboxStatus,
  type SecretService,
  type SelfTestReport,
  type Shell,
} from "@xeon/contracts/services";
import { decideAutoAllow } from "./auto-allow.ts";
import { canonicalizePath, sortedUnique, toAbsolutePath } from "./paths.ts";
import {
  BLOCKED_NETWORK,
  candidateWriteRoots,
  mergePolicy,
  toSrtGlobalConfig,
  type EffectivePolicy,
  type PolicyInput,
  type SrtTools,
} from "./policy.ts";
import {
  buildProtectedPaths,
  dropProtectedWriteRoots,
  expandBasenameEntries,
  resolveExtraPaths,
  withGitEntries,
} from "./protected-paths.ts";
import { runSelfTest, SELF_TEST_ITEM_IDS } from "./self-test.ts";
import { detectPlatformInput, selectSandboxProvider, type PlatformInput } from "./select.ts";
import type { SandboxSettings } from "./settings.ts";
import { createSrtPort, type SrtPort } from "./srt.ts";
import {
  buildStatus,
  classifyInitFailure,
  detectSandbox,
  formatStatusLine,
  type Detection,
} from "./status.ts";
import { wrapShellWith, type WrapShellDeps } from "./wrap-shell.ts";

// L0.sandbox.spec §3.1 SandboxService 구현. exec·secrets·os 패키지를 import하지 않고 F 서비스 인터페이스만 받는다.

/** srt 자동 보호 경로 탐색 깊이 기본값(srt `mandatoryDenySearchDepth` 기본 3) */
const BASENAME_SEARCH_DEPTH = 3;

export interface SandboxServiceDeps {
  /** xeon.os 서비스에서 쓰는 부분 */
  readonly os: Pick<OsService, "dirs" | "time" | "logger" | "resolveBinary">;
  /** xeon.secrets 서비스에서 쓰는 부분. 없으면 비밀 파일 경로 없이 기본 보호 경로만 쓴다 */
  readonly secrets?: Pick<SecretService, "protectedPaths">;
  /** 현재 유효 설정(l0.sandbox.*). 호출마다 읽으므로 nextTurn 변경이 다음 호출부터 반영된다 */
  readonly settings: () => SandboxSettings;
  /** 기본은 실제 srt. 시험은 가짜 포트를 넣는다 */
  readonly srt?: SrtPort;
  /** 기본은 현재 프로세스. 시험은 가짜 플랫폼을 넣는다 */
  readonly platform?: PlatformInput;
  /** 부모 프로세스 env. 기본은 process.env */
  readonly parentEnv?: () => Readonly<Record<string, string | undefined>>;
}

/** SandboxService에 수명 메서드를 더한 구현 값. 조립 루트가 refresh·dispose를 부른다 */
export interface SandboxServiceHandle extends SandboxService {
  /** 설정 변경(l0.sandbox.enabled) 뒤 상태 탐지를 다시 하고 srt를 다시 초기화한다 */
  refresh(signal: AbortSignal): Promise<SandboxStatus>;
  /** srt를 정리한다(reset). 서비스 dispose 때 한 번 부른다 */
  dispose(): Promise<void>;
}

function logStatus(logger: Logger, status: SandboxStatus): void {
  const summary = describeSandboxStatus(status);
  const fields = {
    line: formatStatusLine(status),
    level: status.level,
    platform: status.platform,
    available: status.available,
    onUnavailable: status.onUnavailable,
    severity: summary.severity,
    ...(status.reason === undefined ? {} : { reason: status.reason }),
    ...(status.missing === undefined ? {} : { missing: status.missing }),
  };
  if (summary.severity === "ok") logger.info("sandbox.status", fields);
  else if (summary.severity === "warn") logger.warn("sandbox.status", fields);
  else logger.error("sandbox.status", fields);
}

/** 서비스를 만들고 상태 탐지와 srt 초기화를 한 번 한다(L0.sandbox.spec §4.1) */
export async function createSandboxService(
  deps: SandboxServiceDeps,
  signal: AbortSignal,
): Promise<SandboxServiceHandle> {
  const srt = deps.srt ?? createSrtPort();
  const provider = selectSandboxProvider(deps.platform ?? detectPlatformInput());
  const parentEnv =
    deps.parentEnv ?? ((): Readonly<Record<string, string | undefined>> => process.env);
  const logger = deps.os.logger("sandbox");
  const { dirs } = deps.os;

  let detection: Detection = {
    kind: "unavailable",
    reason: "disabled",
    missing: [],
    installHints: [],
  };
  let detectedEnabled = false;
  let initialized = false;
  let tools: SrtTools = {};
  let lastSelfTest: SandboxStatus["lastSelfTest"];
  let refreshing: Promise<SandboxStatus> | undefined;
  /** 정책에서 본 작업 공간 root. protectedPaths()가 root별 git 항목을 더하는 데 쓴다 */
  const knownRoots = new Set<string>();

  const currentStatus = (withSelfTest: boolean): SandboxStatus => {
    const settings = deps.settings();
    return buildStatus({
      provider,
      enabled: settings.enabled,
      detection,
      onUnavailable: settings.onUnavailable,
      lastSelfTest: withSelfTest ? lastSelfTest : undefined,
    });
  };

  const baseProtectedEntries = (): readonly ProtectedPathEntry[] => {
    const extra = resolveExtraPaths(deps.settings().protectedPathsExtra, dirs.home);
    const ageKeyFile = parentEnv()["SOPS_AGE_KEY_FILE"];
    return buildProtectedPaths({
      dirs,
      providerEntries: provider.defaultProtectedPaths(dirs),
      secretPaths: deps.secrets?.protectedPaths() ?? [],
      ageKeyFileEnv: ageKeyFile,
      extraPaths: extra.resolved,
    });
  };

  const doRefresh = async (refreshSignal: AbortSignal): Promise<SandboxStatus> => {
    if (initialized) {
      initialized = false;
      try {
        await srt.reset();
      } catch (caught) {
        logger.warn("sandbox.reset_failed", {
          error: caught instanceof Error ? caught.name : typeof caught,
        });
      }
    }
    const enabled = deps.settings().enabled;
    detectedEnabled = enabled;
    try {
      detection = await detectSandbox(
        { provider, srt, resolveBinary: deps.os.resolveBinary },
        enabled,
        refreshSignal,
      );
    } catch (caught) {
      detection = classifyInitFailure(caught, provider);
    }
    if (detection.kind === "ready") {
      tools = detection.tools;
      try {
        // enableLogMonitor는 macOS 참, Linux 거짓이다. Linux 모니터 값은 샌드박스 프로세스가 조작할 수 있다
        await srt.initialize(
          toSrtGlobalConfig(tools, BLOCKED_NETWORK),
          provider.kind === "seatbelt",
        );
        initialized = true;
      } catch (caught) {
        detection = classifyInitFailure(caught, provider);
      }
    }
    const rejected = resolveExtraPaths(deps.settings().protectedPathsExtra, dirs.home).rejected;
    if (rejected.length > 0) {
      logger.warn("sandbox.protected_path_extra_rejected", { count: rejected.length });
    }
    const status = currentStatus(true);
    logStatus(logger, status);
    return status;
  };

  const refresh = (refreshSignal: AbortSignal): Promise<SandboxStatus> => {
    refreshing ??= doRefresh(refreshSignal).finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  };

  /** 쓰기 루트 후보에 git 항목을 더하고, 보호 경로 안의 루트를 지운다 */
  const analyzeRoots = (
    roots: readonly string[],
  ): {
    readonly entries: readonly ProtectedPathEntry[];
    readonly kept: string[];
    readonly pathEntries: readonly ProtectedPathEntry[];
  } => {
    const entries = withGitEntries(baseProtectedEntries(), roots);
    const { kept, removed } = dropProtectedWriteRoots(roots, entries);
    if (removed.length > 0) logger.warn("sandbox.write_root_removed", { roots: removed });
    for (const root of kept) knownRoots.add(root);
    return { entries, kept, pathEntries: entries.filter((entry) => entry.match !== "basename") };
  };

  const resolvePolicy = (policy: SandboxPolicy, baseDir: string): EffectivePolicy => {
    const input: PolicyInput = {
      policy,
      protectedReadDeny: [],
      protectedWriteDeny: [],
      basenameFiles: [],
      extraWriteRoots: deps.settings().writeRootsExtra,
      home: dirs.home,
      base: baseDir,
    };
    const { entries, kept, pathEntries } = analyzeRoots(candidateWriteRoots(input));
    return mergePolicy(
      {
        ...input,
        protectedReadDeny: pathEntries
          .filter((entry) => entry.access === "read_write")
          .map((entry) => entry.path),
        protectedWriteDeny: pathEntries.map((entry) => entry.path),
        basenameFiles: expandBasenameEntries(entries, kept, BASENAME_SEARCH_DEPTH),
      },
      kept,
    );
  };

  const wrapDeps = (withSelfTest: boolean): WrapShellDeps => ({
    srt,
    provider,
    random: deps.os.time.random,
    logger,
    parentEnv,
    status: () => currentStatus(withSelfTest),
    escapeRetry: () => deps.settings().escapeRetry,
    resolvePolicy,
    tools: () => tools,
    ensureCurrent: async (context: CancelScope): Promise<void> => {
      if (detectedEnabled === deps.settings().enabled) return;
      await refresh(context.abortSignal ?? new AbortController().signal);
    },
  });

  const defaultPolicy: SandboxService["defaultPolicy"] = (input) => {
    const roots = sortedUnique(
      [...input.workspaceRoots, input.tempDir, ...deps.settings().writeRootsExtra].map((root) =>
        canonicalizePath(toAbsolutePath(root, dirs.home, "/")),
      ),
    );
    const { kept, pathEntries } = analyzeRoots(roots);
    return {
      writeRoots: kept,
      readDeny: sortedUnique(
        pathEntries.filter((entry) => entry.access === "read_write").map((entry) => entry.path),
      ),
      writeDeny: sortedUnique(pathEntries.map((entry) => entry.path)),
      network: { allowedDomains: [], deniedDomains: [] },
      allowEscape: false,
    };
  };

  const selfTest = async (shell: Shell, context: CancelScope): Promise<SelfTestReport> => {
    const clock = deps.os.time.clock;
    if (!currentStatus(false).available) {
      // 격리를 쓸 수 없으면 시험할 수 없다. 원래 이유(missing_dependency 등)를 가리지 않도록 기록하지 않는다
      return {
        at: clock.now(),
        durationMs: 0,
        passed: false,
        items: SELF_TEST_ITEM_IDS.map((id) => ({
          id,
          passed: false,
          detail: "sandbox_unavailable",
        })),
      };
    }
    const report = await runSelfTest(
      {
        dirs,
        clock,
        random: deps.os.time.random,
        logger,
        wrap: (inner, policy) => wrapShellWith(wrapDeps(false), inner, policy),
        defaultPolicy,
      },
      shell,
      context,
    );
    lastSelfTest = {
      at: report.at,
      passed: report.passed,
      failed: report.items.filter((entry) => !entry.passed).map((entry) => entry.id),
    };
    if (report.passed)
      logger.info("sandbox.self_test", { passed: true, durationMs: report.durationMs });
    else logger.error("sandbox.self_test", { passed: false, failed: lastSelfTest.failed });
    return report;
  };

  await refresh(signal);

  return {
    status: () => currentStatus(true),
    defaultPolicy,
    protectedPaths: () => withGitEntries(baseProtectedEntries(), [...knownRoots]),
    wrapShell: (shell, policy) => wrapShellWith(wrapDeps(true), shell, policy),
    autoAllow: (policy, request) =>
      decideAutoAllow(policy, request, currentStatus(true), BLOCKED_NETWORK.allowedDomains),
    selfTest,
    refresh,
    dispose: async () => {
      if (!initialized) return;
      initialized = false;
      await srt.reset();
    },
  };
}
