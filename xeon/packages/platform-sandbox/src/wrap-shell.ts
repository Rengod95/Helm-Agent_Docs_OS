import {
  Bug,
  assertNever,
  err,
  ok,
  type Logger,
  type RandomSource,
  type Result,
} from "@xeon/contracts";
import {
  ExecutionError,
  type CancelScope,
  type SandboxPolicy,
  type SandboxRunReport,
  type SandboxStatus,
  type Shell,
  type ShellExecOptions,
  type ShellExecResult,
} from "@xeon/contracts/services";
import type { EffectivePolicy, SrtTools } from "./policy.ts";
import { toSrtFileConfig, validationCandidate } from "./policy.ts";
import type { SandboxProvider } from "./provider.ts";
import type { SrtPort } from "./srt.ts";
import { toViolations } from "./violations.ts";

// L0.sandbox.spec §4.2 wrapShell과 §4.5 격리 불가 시 동작.

export interface WrapShellDeps {
  readonly srt: SrtPort;
  readonly provider: Pick<SandboxProvider, "kind">;
  readonly random: RandomSource;
  readonly logger: Logger;
  /** 부모 프로세스 env. srt가 돌려준 env와 비교해 추가·변경분만 아래 Shell에 넘긴다 */
  readonly parentEnv: () => Readonly<Record<string, string | undefined>>;
  /** 호출마다 읽는다. onUnavailable과 disabled 판정이 설정 변경(nextTurn)을 따라가게 한다 */
  readonly status: () => SandboxStatus;
  /** l0.sandbox.escapeRetry */
  readonly escapeRetry: () => boolean;
  /** 호출자 정책에 보호 경로와 설정 추가분을 합쳐 유효 정책을 만든다 */
  readonly resolvePolicy: (policy: SandboxPolicy, baseDir: string) => EffectivePolicy;
  /** srt에 넘길 헬퍼 경로. 검증 후보를 만들 때 쓴다 */
  readonly tools: () => SrtTools;
  /** exec 때마다 맨 먼저 부른다. 설정 변경(enabled)으로 낡은 탐지 결과를 새로 고치는 자리다 */
  readonly ensureCurrent: (context: CancelScope) => Promise<void>;
}

const SAFE_ARG = /^[A-Za-z0-9_@%+:,./-]+$/;

function quoteArg(arg: string): string {
  if (arg !== "" && SAFE_ARG.test(arg)) return arg;
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** argv를 POSIX 작은따옴표 규칙으로 이어 셸 문자열 하나로 만든다(srt 입력은 문자열이다) */
export function quoteArgv(argv: readonly string[]): string {
  return argv.map(quoteArg).join(" ");
}

/** 128비트 무작위 commandId(32자 16진수). 위반 귀속 키라서 명령 문자열 앞 100자 비교의 교차 귀속을 피한다 */
export function newCommandId(random: RandomSource): string {
  let id = "";
  for (let i = 0; i < 4; i += 1) {
    id += Math.floor(random() * 2 ** 32)
      .toString(16)
      .padStart(8, "0");
  }
  return id;
}

/** srt가 돌려준 env에서 부모 env와 값이 같은 항목을 뺀 추가·변경분 */
export function envAdditions(
  parent: Readonly<Record<string, string | undefined>>,
  srtEnv: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const additions: Record<string, string> = {};
  for (const [name, value] of Object.entries(srtEnv)) {
    if (value !== undefined && parent[name] !== value) additions[name] = value;
  }
  return additions;
}

/** 오류 이름과 code만 뽑는다. 메시지에는 경로나 값이 들 수 있어 싣지 않는다 */
function describeFailure(caught: unknown): string {
  if (!(caught instanceof Error)) return "unknown error";
  if ("code" in caught && (typeof caught.code === "string" || typeof caught.code === "number")) {
    return `${caught.name} (${String(caught.code)})`;
  }
  return caught.name;
}

function unavailableError(status: SandboxStatus): ExecutionError {
  return new ExecutionError(
    "sandbox_unavailable",
    `sandbox unavailable (reason=${status.reason ?? "none"}, onUnavailable=${status.onUnavailable})`,
  );
}

/** 샌드박스 밖 실행이 허락되지 않은 호출에 돌려주는 오류 */
function escapeDeniedError(status: SandboxStatus): ExecutionError {
  return new ExecutionError(
    "sandbox_unavailable",
    `execution outside the sandbox is not permitted (available=${String(status.available)}, onUnavailable=${status.onUnavailable})`,
  );
}

/** reject 판정을 호출자에게 돌려줄 오류로 바꾼다 */
export function rejectionError(
  decision: Extract<ExecutionDecision, { action: "reject" }>,
  status: SandboxStatus,
): ExecutionError {
  return decision.cause === "escape" ? escapeDeniedError(status) : unavailableError(status);
}

export type Unsandboxed = NonNullable<SandboxRunReport["unsandboxedBy"]>;

export function unsandboxedReport(by: Unsandboxed): SandboxRunReport {
  return {
    sandboxed: false,
    level: "none",
    unsandboxedBy: by,
    violations: [],
    violationsTruncated: false,
  };
}

export function withReport(
  result: Result<ShellExecResult, ExecutionError>,
  report: SandboxRunReport,
): Result<ShellExecResult, ExecutionError> {
  return result.ok ? ok({ ...result.value, sandbox: report }) : result;
}

export type ExecutionDecision =
  | { readonly action: "reject"; readonly cause: "escape" | "unavailable" }
  | { readonly action: "plain"; readonly by: Unsandboxed }
  | { readonly action: "sandboxed" };

/**
 * 상태와 정책으로 이번 호출을 어떻게 실행할지 정한다(L0.sandbox.spec §4.2 2~3단계, §4.5 표). 순수 함수.
 * 사용자가 명시적으로 끈 상태(disabled)는 allowEscape와 관계없이 감싸지 않고 실행한다(§4.5).
 */
export function decideExecution(
  status: SandboxStatus,
  policy: Pick<SandboxPolicy, "allowEscape">,
  escapeRetry: boolean,
): ExecutionDecision {
  if (status.reason === "disabled") return { action: "plain", by: "disabled" };
  if (policy.allowEscape) {
    const permitted = escapeRetry || (!status.available && status.onUnavailable === "ask");
    return permitted ? { action: "plain", by: "escape" } : { action: "reject", cause: "escape" };
  }
  if (status.available) return { action: "sandboxed" };
  switch (status.onUnavailable) {
    case "disable_execute":
    case "ask":
      return { action: "reject", cause: "unavailable" };
    case "run_unsandboxed":
      return { action: "plain", by: "run_unsandboxed" };
    default:
      return assertNever(status.onUnavailable, "OnUnavailable");
  }
}

function isAborted(context: CancelScope): boolean {
  return context.abortSignal?.aborted === true;
}

function baseDirOf(options: ShellExecOptions | undefined): string {
  const cwd = options?.cwd;
  return cwd !== undefined && cwd.startsWith("/") ? cwd : "/";
}

/** F Shell을 받아 F Shell을 돌려주는 데코레이터. exec 패키지를 import하지 않는다(DR-02) */
export function wrapShellWith(deps: WrapShellDeps, shell: Shell, policy: SandboxPolicy): Shell {
  const runPlain = async (
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: CancelScope,
    by: Unsandboxed,
  ): Promise<Result<ShellExecResult, ExecutionError>> => {
    const result = await shell.exec(command, options, context);
    return withReport(result, unsandboxedReport(by));
  };

  const runSandboxed = async (
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: CancelScope,
  ): Promise<Result<ShellExecResult, ExecutionError>> => {
    // M1은 네트워크를 전부 차단한다. 허용 도메인 정책은 M2 이후다
    if (policy.network.allowedDomains.length > 0) {
      return err(
        new ExecutionError("sandbox_failed", "network allow-list policy is not supported yet"),
      );
    }
    const shellCommand = typeof command === "string" ? command : quoteArgv(command);
    if (shellCommand === "") return err(new ExecutionError("spawn_error", "empty command"));
    if (isAborted(context)) return err(new ExecutionError("aborted", "aborted"));

    const effective = deps.resolvePolicy(policy, baseDirOf(options));
    const customConfig = toSrtFileConfig(effective);
    const issues = deps.srt.validateConfig(validationCandidate(deps.tools(), customConfig));
    if (issues.length > 0) {
      throw new Bug(
        `sandbox policy conversion produced an invalid srt config: ${issues.join("; ")}`,
      );
    }

    const commandId = newCommandId(deps.random);
    let wrapped;
    try {
      wrapped = await deps.srt.wrapWithSandboxArgv({
        command: shellCommand,
        binShell: "bash",
        customConfig,
        abortSignal: context.abortSignal,
        cwd: options?.cwd,
        commandId,
      });
    } catch (caught) {
      // 래핑이 실패하면 cleanupAfterCommand를 부르지 않는다. 실행 중인 다른 샌드박스의 마운트 지점을 지운다
      if (isAborted(context)) return err(new ExecutionError("aborted", "aborted"));
      return err(
        new ExecutionError("sandbox_failed", `sandbox wrap failed: ${describeFailure(caught)}`),
      );
    }
    if (deps.provider.kind === "bwrap") {
      const warnings = deps.srt.getLinuxGlobPatternWarnings();
      if (warnings.length > 0) {
        throw new Bug(`sandbox policy produced glob patterns on Linux (${warnings.length})`);
      }
    }

    const additions = envAdditions(deps.parentEnv(), wrapped.env);
    const execOptions: ShellExecOptions = {
      ...options,
      ...(Object.keys(additions).length > 0 ? { env: { ...options?.env, ...additions } } : {}),
    };

    let result: Result<ShellExecResult, ExecutionError>;
    let lines: readonly string[] = [];
    try {
      result = await shell.exec(wrapped.argv, execOptions, context);
    } finally {
      lines = deps.srt.getViolationLines(commandId);
      try {
        deps.srt.cleanupAfterCommand();
      } catch (caught) {
        deps.logger.warn("sandbox.cleanup_failed", { error: describeFailure(caught) });
      }
    }
    const { violations, truncated } = toViolations(lines, deps.provider);
    return withReport(result, {
      sandboxed: true,
      level: "srt",
      violations,
      violationsTruncated: truncated,
    });
  };

  return {
    async exec(command, options, context) {
      await deps.ensureCurrent(context);
      const status = deps.status();
      const decision = decideExecution(status, policy, deps.escapeRetry());
      switch (decision.action) {
        case "reject":
          return err(rejectionError(decision, status));
        case "plain":
          return runPlain(command, options, context, decision.by);
        case "sandboxed":
          return runSandboxed(command, options, context);
        default:
          return assertNever(decision, "ExecutionDecision");
      }
    },
    cleanup: (context) => shell.cleanup(context),
  };
}
