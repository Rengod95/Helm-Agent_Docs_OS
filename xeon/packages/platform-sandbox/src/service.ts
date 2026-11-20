import {
  attemptAsync,
  detach,
  err,
  ok,
  type Logger,
  type Result,
  type TimerHandle,
} from "@fresnel/contracts";
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
} from "@fresnel/contracts/services";
import { decideAutoAllow } from "./auto-allow.ts";
import { canonicalizePath, sortedUnique, toAbsolutePath } from "./paths.ts";
import {
  runtimeReadPaths,
  systemInfoDeny,
  systemToolDeny,
  systemToolMachDeny,
  systemToolLiterals,
  systemToolReadPaths,
} from "./runtime-read-paths.ts";
import {
  BLOCKED_NETWORK,
  blocklistNetwork,
  candidateWriteRoots,
  mergePolicy,
  socatPathOf,
  toSrtGlobalConfig,
  type EffectivePolicy,
  type PolicyInput,
  type SrtTools,
} from "./policy.ts";
import {
  BASENAME_SEARCH_DEPTH,
  buildProtectedPaths,
  dropProtectedWriteRoots,
  expandBasenameEntries,
  resolveExtraPaths,
  suggestedProtectedPaths,
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
import { wrapArgvWith } from "./wrap-argv.ts";
import { wrapShellWith, type WrapShellDeps } from "./wrap-shell.ts";

// L0.sandbox.spec §3.1 SandboxService 구현. exec·secrets·os 패키지를 import하지 않고 F 서비스 인터페이스만 받는다.

export interface SandboxServiceDeps {
  /** fresnel.os 서비스에서 쓰는 부분 */
  readonly os: Pick<OsService, "dirs" | "time" | "logger" | "resolveBinary">;
  /** fresnel.secrets 서비스에서 쓰는 부분. 없으면 시크릿 파일 경로 없이 기본 보호 경로만 쓴다 */
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

/** 반복 자가 시험의 한 번 실행이 보고서를 내지 못한 이유 */
export type SelfTestRunError =
  /** 실행이 끝나기 전에 `stop()`이나 서비스 `dispose()`가 불렸다 */
  | { readonly kind: "stopped" }
  /** `selfTest`가 던졌다. 원인은 로그에 남긴다(시험 항목 실패와 다르다) */
  | { readonly kind: "crashed" };

export interface SelfTestSchedule {
  /** 첫 실행의 결과. 호출자가 시작 직후 한 번은 기다려 볼 수 있다 */
  readonly first: Promise<Result<SelfTestReport, SelfTestRunError>>;
  /** 반복을 멈춘다. 진행 중인 실행에는 중단 신호를 보낸다. 여러 번 불러도 된다 */
  stop(): void;
}

/** SandboxService에 수명 메서드를 더한 구현 값. 조립 루트가 refresh·dispose를 부른다 */
export interface SandboxServiceHandle extends SandboxService {
  /** 설정 변경(l0.sandbox.enabled) 뒤 상태 탐지를 다시 하고 srt를 다시 초기화한다 */
  refresh(signal: AbortSignal): Promise<SandboxStatus>;
  /**
   * 자가 시험을 지금 한 번 돌리고, `l0.sandbox.selfTestIntervalMin`분마다 반복한다(0이면 이 한 번뿐이다).
   * 간격은 한 실행이 끝날 때마다 설정에서 다시 읽는다. 실행은 겹치지 않는다. 호출 지점은 조립 루트다(L0.sandbox.spec §4.7).
   * 서비스 `dispose()`가 모든 반복을 멈춘다.
   */
  startSelfTests(shell: Shell): SelfTestSchedule;
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
  /** 마지막으로 기록한 보고서 전체(항목별 사유 포함). `lastSelfTest`와 같은 시점에 바뀐다 */
  let lastReport: SelfTestReport | undefined;
  /** 자가 시험은 같은 `<fresnelData>/selftest/`를 쓴다. 실행을 한 줄로 세워 겹치지 않게 한다(예약 시험과 사람이 누른 시험) */
  let selfTestTail: Promise<unknown> = Promise.resolve();
  /** 마지막 갱신에서 srt가 거부해 차단 목록에서 뺀 도메인. 갱신할 때마다 새로 정한다 */
  let rejectedBlockedDomains: readonly string[] = [];
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
      rejectedBlockedDomains,
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

  /**
   * srt 스키마가 받지 않는 차단 항목은 빼고 `rejectedBlockedDomains`에 남긴다(status와 doctor가 보여 준다).
   * 개수는 로그에도 남긴다. 나머지 차단은 유지한다.
   */
  const splitBlockedDomains = (
    domains: readonly string[],
  ): { readonly accepted: string[]; readonly rejected: string[] } => {
    const accepted: string[] = [];
    const rejected: string[] = [];
    for (const domain of domains) {
      if (srt.validateConfig(toSrtGlobalConfig({}, blocklistNetwork([domain]), {})).length === 0) {
        accepted.push(domain);
      } else {
        rejected.push(domain);
      }
    }
    return { accepted, rejected };
  };

  const validBlockedDomains = (domains: readonly string[]): string[] => {
    const { accepted, rejected } = splitBlockedDomains(domains);
    rejectedBlockedDomains = rejected;
    if (rejected.length > 0) {
      logger.warn("sandbox.blocked_domain_rejected", { count: rejected.length });
    }
    return accepted;
  };

  const doRefresh = async (refreshSignal: AbortSignal): Promise<SandboxStatus> => {
    // 차단 목록 검사는 탐지가 끝난 뒤에만 돈다. 이번 갱신에서 돌지 않았으면 이전 결과를 남기지 않는다
    rejectedBlockedDomains = [];
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
        const settings = deps.settings();
        const blocked = validBlockedDomains(settings.blockedDomains);
        await srt.initialize(
          toSrtGlobalConfig(tools, blocklistNetwork(blocked), {
            allowUnlistedHosts: true,
            nestedNamespaces: settings.nestedNamespaces,
          }),
          provider.kind === "seatbelt",
          true,
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
    return {
      entries,
      kept,
      pathEntries: entries.filter((entry) => entry.match !== "basename"),
    };
  };

  /** srt가 정책과 상관없이 쓰기를 허용하는 곳(임시·로그 폴더). 읽기 전용 프로필은 이 곳도 쓰기를 막는다 */
  const srtImplicitWritePaths = (): string[] =>
    [
      "/tmp/claude",
      "/private/tmp/claude",
      `${dirs.home}/.npm/_logs`,
      `${dirs.home}/.claude/debug`,
    ].map((path) => canonicalizePath(path));

  const resolvePolicy = (policy: SandboxPolicy, baseDir: string): EffectivePolicy => {
    const readOnly = policy.profile === "read-only" || policy.profile === "no-write";
    // 스크립트 환경은 프로젝트 폴더 하나만 쓰므로 설정의 쓰기 루트 추가분을 더하지 않는다
    const scriptEnv = policy.profile === "script-env";
    const input: PolicyInput = {
      policy,
      protectedReadDeny: [],
      protectedWriteDeny: [],
      basenameReadFiles: [],
      basenameWriteFiles: [],
      extraWriteRoots: readOnly || scriptEnv ? [] : deps.settings().writeRootsExtra,
      home: dirs.home,
      base: baseDir,
    };
    const { entries, kept, pathEntries } = analyzeRoots(readOnly ? [] : candidateWriteRoots(input));
    const names = expandBasenameEntries(entries, kept, BASENAME_SEARCH_DEPTH);
    const merged = mergePolicy(
      {
        ...input,
        protectedReadDeny: pathEntries
          .filter((entry) => entry.access === "read_write")
          .map((entry) => entry.path),
        carvableReadDeny: pathEntries
          .filter((entry) => entry.access === "read_write" && entry.reason === "fresnel_data")
          .map((entry) => entry.path),
        protectedWriteDeny: pathEntries.map((entry) => entry.path),
        basenameReadFiles: names.readFiles,
        basenameWriteFiles: names.writeFiles,
      },
      kept,
    );
    // 읽기 전용·쓰기 없음·스크립트 환경은 srt가 정책과 상관없이 허용하는 임시·로그 폴더에도 쓰지 못하게 막는다
    if (readOnly || scriptEnv) {
      return {
        ...merged,
        writeDeny: sortedUnique([...merged.writeDeny, ...srtImplicitWritePaths()]),
      };
    }
    return merged;
  };

  const wrapDeps = (withSelfTest: boolean): WrapShellDeps => ({
    srt,
    provider,
    random: deps.os.time.random,
    logger,
    parentEnv,
    readOnlyTempBase: () => dirs.tmp,
    status: () => currentStatus(withSelfTest),
    escapeRetry: () => deps.settings().escapeRetry,
    resolvePolicy,
    protectedEntries: () => baseProtectedEntries(),
    tools: () => tools,
    ensureCurrent: async (context: CancelScope): Promise<void> => {
      if (detectedEnabled === deps.settings().enabled) return;
      await refresh(context.abortSignal ?? new AbortController().signal);
    },
  });

  const defaultPolicy: SandboxService["defaultPolicy"] = (input) => {
    if (input.profile === "script-env") {
      // 스크립트 환경(가져온 훅): 읽기는 보호 경로만 거부하고(읽기 허용 목록 없음), 쓰기는 프로젝트 폴더 하나다. 호출마다 만드는 임시 폴더는 wrapArgv가 더한다.
      // 스크립트 실행기의 막기(도구, Mach 서비스, 시스템 정보)를 그대로 얹고, 보호 경로 안의 읽기 예외는 readCarveOuts로 받는다
      const projectDir = input.projectDir;
      const projectRoots =
        projectDir !== undefined && projectDir.startsWith("/")
          ? [canonicalizePath(projectDir)]
          : [];
      const { kept, pathEntries } = analyzeRoots(projectRoots);
      return {
        writeRoots: kept,
        readDeny: sortedUnique(
          pathEntries.filter((entry) => entry.access === "read_write").map((entry) => entry.path),
        ),
        writeDeny: sortedUnique(pathEntries.map((entry) => entry.path)),
        network: {
          allowedDomains: [],
          deniedDomains: splitBlockedDomains(deps.settings().blockedDomains).accepted,
        },
        allowEscape: false,
        profile: "script-env",
        toolDeny: [...systemToolDeny(provider.kind)],
        machDeny: [...systemToolMachDeny(provider.kind)],
        ...(systemInfoDeny(provider.kind) ? { systemInfoDeny: true } : {}),
        ...(input.readCarveOuts === undefined ? {} : { readCarveOuts: [...input.readCarveOuts] }),
      };
    }
    if (input.profile === "no-write") {
      // 쓰기 루트 없음, 읽기 허용 목록 프로필(플러그인 호스트). 네트워크는 차단 목록 방식 그대로다. 호출마다 만드는 임시 폴더는 wrapArgv가 더한다
      const { pathEntries } = analyzeRoots([]);
      return {
        writeRoots: [],
        readDeny: sortedUnique(
          pathEntries.filter((entry) => entry.access === "read_write").map((entry) => entry.path),
        ),
        writeDeny: sortedUnique(pathEntries.map((entry) => entry.path)),
        network: {
          allowedDomains: [],
          deniedDomains: splitBlockedDomains(deps.settings().blockedDomains).accepted,
        },
        allowEscape: false,
        profile: "no-write",
        ...(input.systemTools === true
          ? {
              readAllowLiteral: [...systemToolLiterals(provider.kind)],
              toolDeny: [...systemToolDeny(provider.kind)],
              machDeny: [...systemToolMachDeny(provider.kind)],
              ...(systemInfoDeny(provider.kind) ? { systemInfoDeny: true } : {}),
            }
          : {}),
        readAllow: [
          ...(input.readRoots ?? []),
          ...runtimeReadPaths(provider.kind),
          ...(input.systemTools === true ? systemToolReadPaths(provider.kind) : []),
          ...srt.helperReadPaths(),
          ...(provider.kind === "bwrap" && tools.socatPath !== undefined
            ? [socatPathOf(tools.socatPath)]
            : []),
        ],
      };
    }
    if (input.profile === "read-only") {
      // 쓰기 루트 없음, 네트워크 차단 프로필. 보호 경로 읽기 금지는 그대로 더한다. 호출마다 만드는 임시 폴더는 wrapShell이 더한다
      const { pathEntries } = analyzeRoots([]);
      return {
        writeRoots: [],
        readDeny: sortedUnique(
          pathEntries.filter((entry) => entry.access === "read_write").map((entry) => entry.path),
        ),
        writeDeny: sortedUnique(pathEntries.map((entry) => entry.path)),
        network: { allowedDomains: [], deniedDomains: [] },
        allowEscape: false,
        profile: "read-only",
      };
    }
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
      // srt 스키마가 받지 않는 차단 항목은 정책에 싣지 않는다. 싣으면 호출마다 srt 설정 변환이 실패한다(초기화 때 같은 항목을 이미 뺐다)
      network: {
        allowedDomains: [],
        deniedDomains: splitBlockedDomains(deps.settings().blockedDomains).accepted,
      },
      allowEscape: false,
    };
  };

  const runOneSelfTest = async (shell: Shell, context: CancelScope): Promise<SelfTestReport> => {
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
    lastReport = report;
    if (report.passed)
      logger.info("sandbox.self_test", { passed: true, durationMs: report.durationMs });
    else logger.error("sandbox.self_test", { passed: false, failed: lastSelfTest.failed });
    return report;
  };

  const selfTest = (shell: Shell, context: CancelScope): Promise<SelfTestReport> => {
    const run = selfTestTail.then(() => runOneSelfTest(shell, context));
    // 앞의 실행이 실패해도 다음 실행은 돈다
    selfTestTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const schedules = new Set<SelfTestSchedule>();

  const startSelfTests = (shell: Shell): SelfTestSchedule => {
    const stopSignal = new AbortController();
    let timer: TimerHandle | undefined;

    const runOnce = async (): Promise<Result<SelfTestReport, SelfTestRunError>> => {
      if (stopSignal.signal.aborted) return err({ kind: "stopped" });
      const ran = await attemptAsync(() => selfTest(shell, { abortSignal: stopSignal.signal }));
      if (!ran.ok) {
        // 시험 항목 실패는 보고서 값이다. 여기는 시험 자체가 던진 경우이고, 반복은 계속한다
        logger.error("sandbox.self_test_crashed", {
          error: ran.error.cause instanceof Error ? ran.error.cause.name : typeof ran.error.cause,
        });
        return err({ kind: "crashed" });
      }
      return ok(ran.value);
    };

    const scheduleNext = (): void => {
      if (stopSignal.signal.aborted) return;
      const minutes = deps.settings().selfTestIntervalMin;
      if (minutes <= 0) return;
      timer = deps.os.time.scheduler.setTimeout(() => {
        timer = undefined;
        detach(runOnce().then(scheduleNext), (cause) => {
          logger.error("sandbox.self_test_schedule_failed", {
            error: cause instanceof Error ? cause.name : typeof cause,
          });
        });
      }, minutes * 60_000);
    };

    const first = runOnce().then((result) => {
      scheduleNext();
      return result;
    });
    const schedule: SelfTestSchedule = {
      first,
      stop: () => {
        stopSignal.abort();
        if (timer !== undefined) deps.os.time.scheduler.clearTimeout(timer);
        timer = undefined;
        schedules.delete(schedule);
      },
    };
    schedules.add(schedule);
    return schedule;
  };

  await refresh(signal);

  return {
    status: () => currentStatus(true),
    defaultPolicy,
    // 호출한 쪽이 넘긴 root도 git 항목을 받는다. knownRoots는 bash 정책을 만든 뒤에야 차므로 그것만 쓰면 첫 파일 쓰기가 열린다
    protectedPaths: (roots) =>
      withGitEntries(baseProtectedEntries(), [...knownRoots, ...(roots ?? [])]),
    protectedPathKey: (value) => resolveExtraPaths([value], dirs.home).resolved[0],
    suggestedProtectedPaths: () =>
      suggestedProtectedPaths(currentStatus(false).platform).flatMap((row) => {
        const key = resolveExtraPaths([row.path], dirs.home).resolved[0];
        return key === undefined ? [] : [{ path: row.path, label: row.label, key }];
      }),
    wrapShell: (shell, policy) => wrapShellWith(wrapDeps(true), shell, policy),
    wrapArgv: (policy, request, context) => wrapArgvWith(wrapDeps(true), policy, request, context),
    autoAllow: (policy, request) =>
      decideAutoAllow(policy, request, currentStatus(true), BLOCKED_NETWORK.allowedDomains),
    selfTest,
    lastSelfTestReport: () => lastReport,
    startSelfTests,
    refresh,
    dispose: async () => {
      for (const schedule of schedules) schedule.stop();
      if (!initialized) return;
      initialized = false;
      await srt.reset();
    },
  };
}
