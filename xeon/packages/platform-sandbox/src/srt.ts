import {
  SandboxManager,
  SandboxRuntimeConfigSchema,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { attempt } from "@fresnel/contracts";
import { createLogMonitorGuard } from "./log-monitor.ts";

// @anthropic-ai/sandbox-runtime(srt)를 import하는 유일한 파일이다(DR-07, L0.sandbox.plan §2).
// 나머지 파일은 아래 좁은 포트 SrtPort만 쓴다. 단위 시험은 이 포트의 가짜를 주입한다(eng.testing.guide TS-05).

export type SrtConfig = SandboxRuntimeConfig;
export type SrtCommandConfig = Partial<SandboxRuntimeConfig>;

export interface SrtDependencyReport {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface SrtWrapInput {
  readonly command: string;
  readonly binShell: string;
  readonly customConfig: SrtCommandConfig;
  readonly abortSignal: AbortSignal | undefined;
  readonly cwd: string | undefined;
  readonly commandId: string;
}

export interface SrtWrapOutput {
  readonly argv: readonly string[];
  /** srt가 돌려준 env. 0.0.79는 부모 process.env 전체다(차이 계산은 호출자가 한다) */
  readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * 중첩 사용자 네임스페이스 시험 결과. srt는 모든 명령에서 bwrap 안에 한 번 더 네임스페이스를 만든다(apply-seccomp).
 * `restricted`는 bwrap 자체는 뜨는데 그 안의 중첩 네임스페이스만 거부되는 경우다(Ubuntu AppArmor `bwrap-userns-restrict`).
 */
type NestedUsernsProbe = { readonly kind: "ok" } | { readonly kind: "restricted" };

export interface SrtPort {
  isSupportedPlatform(): boolean;
  /** Linux에서 srt가 쓰는 것과 같은 중첩 네임스페이스를 bwrap 안에서 만들어 본다. 시험 자체를 못 돌리면 ok다(자가 시험이 다시 거른다) */
  probeNestedUserns(bwrapPath: string, signal: AbortSignal): Promise<NestedUsernsProbe>;
  /** ripgrepCommand가 없으면 srt 기본값("rg")을 검사한다 */
  checkDependencies(ripgrepCommand: string | undefined): SrtDependencyReport;
  /**
   * allowUnlistedHosts가 참이면 허용 목록에 없는 호스트도 거부 목록에 걸리지 않는 한 허용한다(차단 목록 방식).
   * 거짓이면 허용 목록 밖을 모두 거부한다
   */
  initialize(
    config: SrtConfig,
    enableLogMonitor: boolean,
    allowUnlistedHosts: boolean,
  ): Promise<void>;
  wrapWithSandboxArgv(input: SrtWrapInput): Promise<SrtWrapOutput>;
  /** commandId에 귀속된 위반 기록의 원문 줄 */
  getViolationLines(commandId: string): readonly string[];
  cleanupAfterCommand(): void;
  reset(): Promise<void>;
  /** srt 설정 스키마 검증. 문제 설명을 돌려주고, 비어 있으면 통과다 */
  validateConfig(config: unknown): readonly string[];
  getLinuxGlobPatternWarnings(): readonly string[];
  /**
   * 읽기 허용 목록 아래에서도 srt가 샌드박스 안에서 부르는 도우미(Linux의 seccomp 필터 실행 파일)의 폴더. 읽기 허용 목록 방식은
   * 루트를 빈 tmpfs로 덮으므로 이 폴더를 허용 목록에 넣어야 한다. 도우미가 없으면 빈 목록이다
   */
  helperReadPaths(): readonly string[];
}

const PROBE_TIMEOUT_MS = 5000;

function runsOk(file: string, args: readonly string[], signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(file, [...args], { timeout: PROBE_TIMEOUT_MS, signal }, (error) => {
      resolve(error === null);
    });
  });
}

/** bwrap이 사용자 네임스페이스를 만들 수 있고(기준) 그 안에서 한 번 더 만들 수 없을 때만 restricted다 */
async function probeNestedUsernsWith(
  bwrapPath: string,
  signal: AbortSignal,
): Promise<NestedUsernsProbe> {
  const base = ["--unshare-user", "--unshare-pid", "--ro-bind", "/", "/", "--dev", "/dev"];
  const outer = await runsOk(
    bwrapPath,
    [...base, "--bind", "/proc", "/proc", "--", "true"],
    signal,
  );
  if (!outer) return { kind: "ok" };
  const nested = await runsOk(
    bwrapPath,
    [
      ...base,
      "--bind",
      "/proc",
      "/proc",
      "--",
      "unshare",
      "--user",
      "--map-root-user",
      "--mount",
      "true",
    ],
    signal,
  );
  return nested ? { kind: "ok" } : { kind: "restricted" };
}

/** srt 패키지의 `vendor/seccomp` 폴더(srt가 apply-seccomp를 찾는 자리, 구조별 하위 폴더를 모두 품는다). 없으면 빈 목록 */
function seccompHelperDirs(): readonly string[] {
  const entry = attempt(() =>
    createRequire(import.meta.url).resolve("@anthropic-ai/sandbox-runtime"),
  );
  if (!entry.ok) return [];
  // 진입 파일은 `<패키지>/dist/index.js`다
  const dir = join(dirname(dirname(entry.value)), "vendor", "seccomp");
  return existsSync(dir) ? [dir] : [];
}

/** 실제 srt 싱글턴을 감싼 포트. srt는 프로세스 전역 상태이므로 프로세스에 하나만 쓴다 */
export function createSrtPort(): SrtPort {
  const monitorGuard = createLogMonitorGuard();
  return {
    isSupportedPlatform: () => SandboxManager.isSupportedPlatform(),
    probeNestedUserns: probeNestedUsernsWith,
    checkDependencies: (ripgrepCommand) => {
      const report = SandboxManager.checkDependencies(
        ripgrepCommand === undefined ? undefined : { command: ripgrepCommand },
      );
      return { errors: [...report.errors], warnings: [...report.warnings] };
    },
    // 거부 목록은 질의 콜백보다 먼저 검사된다. 콜백이 true만 돌려주면 목록 밖은 허용이고 거부 목록만 막는다
    initialize: async (config, enableLogMonitor, allowUnlistedHosts) => {
      await SandboxManager.initialize(
        config,
        allowUnlistedHosts ? () => Promise.resolve(true) : undefined,
        enableLogMonitor,
      );
      // 위반 감시(log stream)가 호스트 종료 뒤에 남지 않게 한다(log-monitor.ts)
      if (enableLogMonitor) monitorGuard.arm();
    },
    wrapWithSandboxArgv: async (input) => {
      const wrapped = await SandboxManager.wrapWithSandboxArgv(
        input.command,
        input.binShell,
        input.customConfig,
        input.abortSignal,
        input.cwd,
        { commandId: input.commandId },
      );
      return { argv: wrapped.argv, env: wrapped.env };
    },
    getViolationLines: (commandId) =>
      SandboxManager.getSandboxViolationStore()
        .getViolationsForCommand(commandId)
        .map((violation) => violation.line),
    cleanupAfterCommand: () => {
      SandboxManager.cleanupAfterCommand();
    },
    reset: async () => {
      await SandboxManager.reset();
      // reset이 못 끈 감시가 있으면 여기서 끈다
      monitorGuard.sweep();
    },
    validateConfig: (config) => {
      const parsed = SandboxRuntimeConfigSchema.safeParse(config);
      if (parsed.success) return [];
      return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    },
    getLinuxGlobPatternWarnings: () => [...SandboxManager.getLinuxGlobPatternWarnings()],
    helperReadPaths: () => [
      ...seccompHelperDirs(),
      // 읽기 허용 목록 방식은 최상위 폴더(`/tmp` 등)를 빈 tmpfs로 덮어 프록시 소켓이 사라지므로 소켓 파일도 허용 목록에 넣는다
      ...[SandboxManager.getLinuxHttpSocketPath(), SandboxManager.getLinuxSocksSocketPath()].filter(
        (path): path is string => path !== undefined,
      ),
    ],
  };
}
