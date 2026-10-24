import { err, ok, type Result } from "@xeon/contracts";
// XEON-PATCH: P1
import type {
  CancelScope as Context,
  ExecutionError,
  SecretEnvRequest,
  Shell,
  ShellExecResult,
  ShellOutputWindow,
} from "@xeon/contracts/services";
import { WorkspaceFailure } from "../../errors.ts";
// XEON-PATCH: P2
import { OutputBuffer, PROGRESS_BYTES_PER_SECOND } from "../../upstream/output.ts";

const MAX_TIMEOUT_SECONDS = 2_147_483_647 / 1000;
// XEON-PATCH: P6
/** 원본은 `ToolExecutionApi.outputWindow`가 이 간격을 정했다(`HarnessOptions.progress.outputIntervalMs` 기본값) */
const OUTPUT_INTERVAL_MS = 100;

// XEON-PATCH: P6
/**
 * 원본 `createBashTool`/`runCommand`에서 도구 껍데기(`defineTool`, `ToolExecutionApi`, `commandPrefix`, `prepare`,
 * PowerShell)를 걷어 낸 본문이다. 출력은 `api.output()`/`retainedOutput()` 대신 같은 `OutputBuffer`(꼬리 보관)가 받고,
 * spill과 window 옵션은 `Shell.exec`에 직접 넘긴다. 샌드박스 래핑은 호출자가 `Shell`에 입힌다(`shell/run.ts`).
 */
export interface BashRun {
  readonly command: string;
  readonly cwd: string;
  /** 초. 생략하면 제한 없음 */
  readonly timeoutSec?: number;
  readonly secretEnv?: SecretEnvRequest;
}

export interface BashLimits {
  readonly maxLines: number;
  readonly maxBytes: number;
}

/** 끝난 명령. 출력은 꼬리만 남는다 */
export interface BashOutcome {
  readonly exitCode: number;
  readonly output: string;
  readonly truncated: boolean;
  readonly fullOutputPath?: string;
  readonly sandbox?: ShellExecResult["sandbox"];
}

/** 실패한 실행(시간 초과, 취소, 거부 등)과 그때까지 모은 출력 */
export interface BashFailure {
  readonly error: ExecutionError;
  readonly partial: { readonly output: string; readonly truncated: boolean };
  readonly fullOutputPath?: string;
}

// XEON-PATCH: P6
function validateTimeout(timeout: number | undefined): void {
  if (timeout === undefined) return;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new WorkspaceFailure(
      "invalid_input",
      "Invalid timeout: must be a finite number of seconds",
    );
  }
  if (timeout > MAX_TIMEOUT_SECONDS) {
    throw new WorkspaceFailure(
      "invalid_input",
      `Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`,
    );
  }
}

/**
 * Run the command, streaming output into a bounded tail buffer within the retained window. Output beyond the limits
 * is spilled to a file whose path is returned. A failed run keeps the output gathered so far.
 */
export async function runBashCommand(
  shell: Pick<Shell, "exec">,
  run: BashRun,
  limits: BashLimits,
  context: Context,
): Promise<Result<BashOutcome, BashFailure>> {
  validateTimeout(run.timeoutSec);
  const buffer = new OutputBuffer({ ...limits, retain: "tail" });
  const window: ShellOutputWindow = {
    maxBytes: limits.maxBytes,
    maxLines: limits.maxLines,
    minIntervalMs: OUTPUT_INTERVAL_MS,
    bytesPerSecond: PROGRESS_BYTES_PER_SECOND,
  };
  const result = await shell.exec(
    run.command,
    {
      cwd: run.cwd,
      env: {},
      inheritEnv: true,
      ...(run.timeoutSec === undefined ? {} : { timeout: run.timeoutSec }),
      ...(run.secretEnv === undefined ? {} : { secretEnv: run.secretEnv }),
      onOutput: (text, _context, info) => {
        buffer.push(text, info.skipped);
      },
      spill: { afterBytes: limits.maxBytes, afterLines: limits.maxLines },
      // An environment may then omit output outside the retained tail and report the omission.
      window,
    },
    context,
  );
  buffer.end();
  const retained = buffer.snapshot();
  const truncated = retained.droppedBytes > 0;
  if (!result.ok) {
    const spillPath = result.error.spillPath;
    return err({
      error: result.error,
      partial: { output: retained.text, truncated },
      ...(spillPath === undefined ? {} : { fullOutputPath: spillPath }),
    });
  }
  const { exitCode, spillPath, sandbox } = result.value;
  return ok({
    exitCode,
    output: retained.text,
    truncated,
    ...(spillPath === undefined ? {} : { fullOutputPath: spillPath }),
    ...(sandbox === undefined ? {} : { sandbox }),
  });
}
