import {
  SandboxManager,
  SandboxRuntimeConfigSchema,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";

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

export interface SrtPort {
  isSupportedPlatform(): boolean;
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
}

/** 실제 srt 싱글턴을 감싼 포트. srt는 프로세스 전역 상태이므로 프로세스에 하나만 쓴다 */
export function createSrtPort(): SrtPort {
  return {
    isSupportedPlatform: () => SandboxManager.isSupportedPlatform(),
    checkDependencies: (ripgrepCommand) => {
      const report = SandboxManager.checkDependencies(
        ripgrepCommand === undefined ? undefined : { command: ripgrepCommand },
      );
      return { errors: [...report.errors], warnings: [...report.warnings] };
    },
    // 거부 목록은 질의 콜백보다 먼저 검사된다. 콜백이 true만 돌려주면 목록 밖은 허용이고 거부 목록만 막는다
    initialize: (config, enableLogMonitor, allowUnlistedHosts) =>
      SandboxManager.initialize(
        config,
        allowUnlistedHosts ? () => Promise.resolve(true) : undefined,
        enableLogMonitor,
      ),
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
    reset: () => SandboxManager.reset(),
    validateConfig: (config) => {
      const parsed = SandboxRuntimeConfigSchema.safeParse(config);
      if (parsed.success) return [];
      return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    },
    getLinuxGlobPatternWarnings: () => [...SandboxManager.getLinuxGlobPatternWarnings()],
  };
}
