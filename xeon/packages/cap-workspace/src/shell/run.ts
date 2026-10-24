import { assertNever } from "@xeon/contracts";
import {
  WorkspaceShell,
  type CallContext,
  type CapabilityApi,
  type SecretRef,
} from "@xeon/contracts/capabilities";
import type { CancelScope, SecretEnvRequest } from "@xeon/contracts/services";
import type { WorkspaceDeps } from "../deps.ts";
import { WorkspaceFailure, guarded } from "../errors.ts";
import { resolveWorkspacePath } from "../roots.ts";
import { scopedDeps } from "../scope.ts";
import { runBashCommand, type BashOutcome } from "./upstream/bash.ts";

// L2.workspace.spec §3.3, §4.2. 샌드박스 래핑(xeon.sandbox)과 실행(xeon.exec)은 F 인터페이스로만 만난다.

type ShellApi = CapabilityApi<typeof WorkspaceShell>;
type RunInput = Parameters<ShellApi["run"]>[0];
type RunResult = Awaited<ReturnType<ShellApi["run"]>>;

const CAPABILITY = WorkspaceShell.id;

/** 시간 초과로 끝난 명령에는 종료 코드가 없다. RunOutput이 정수를 요구해 -1로 싣는다 */
const NO_EXIT_CODE = -1;

function isSecretRef(value: string): value is SecretRef {
  return value.startsWith("secret://");
}

/** 비밀 사용 목적 표지 `bash:<argv0>`. 경로와 특수 문자를 걷어 감사 기록에 안전한 이름만 남긴다 */
function purposeOf(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? "";
  const name = (first.split("/").at(-1) ?? "").replace(/[^A-Za-z0-9._+-]/g, "").slice(0, 48);
  return name === "" ? "bash" : `bash:${name}`;
}

function actorOf(context: CallContext | undefined): "agent" | "runtime" | "human" {
  const kind = context?.caller.kind;
  switch (kind) {
    case "model":
      return "agent";
    case "host":
      return "human";
    case "extension":
    case undefined:
      return "runtime";
    default:
      return assertNever(kind, "CallerInfo.kind");
  }
}

/**
 * `secretEnv` 요청. 값은 이 패키지를 지나지 않는다: 참조만 `xeon.exec`에 넘기고 값 주입은 spawn 직전에 한다.
 * 승인 증거(`approval`)는 이 호출 경로에 실려 오는 곳이 없어 null이다. 그래서 `xeon.secrets`가 `approval_missing`으로
 * 거부한다(fail-closed). 증거를 받는 경로는 L1.tools·L2.workspace 합의 전까지 [미결]이다(L1.tools.spec §10).
 */
function secretEnvOf(
  input: RunInput,
  context: CallContext | undefined,
): SecretEnvRequest | undefined {
  if (input.secretEnv === undefined) return undefined;
  const refs: Record<string, SecretRef> = {};
  for (const [name, ref] of Object.entries(input.secretEnv)) {
    if (!isSecretRef(ref)) {
      throw new WorkspaceFailure("invalid_input", `secretEnv.${name} is not a secret:// reference`);
    }
    refs[name] = ref;
  }
  if (Object.keys(refs).length === 0) return undefined;
  return {
    refs,
    ctx: {
      purpose: purposeOf(input.command),
      actor: actorOf(context),
      threadId: context?.threadId ?? null,
      toolCallId: context?.toolCallId ?? null,
      projectId: null,
      approval: null,
    },
  };
}

function toRunOutput(outcome: BashOutcome, durationMs: number): RunResult {
  return {
    exitCode: outcome.exitCode,
    output: outcome.output,
    truncated: outcome.truncated,
    ...(outcome.fullOutputPath === undefined ? {} : { fullOutputPath: outcome.fullOutputPath }),
    durationMs,
    sandboxed: outcome.sandbox?.sandboxed ?? false,
  };
}

// 호출마다 호출한 대화의 작업 폴더로 의존을 맞춘다(scopedDeps, open-issues M-06). 기본 cwd, 샌드박스 쓰기 root가 그 폴더가 된다.
export function createShellApi(base: WorkspaceDeps): ShellApi {
  return {
    run(input, options) {
      return guarded(CAPABILITY, "run", async () => {
        const deps = scopedDeps(base, options?.context?.threadId);
        const context: CancelScope = { abortSignal: options?.signal };
        if (options?.signal?.aborted === true) {
          throw new WorkspaceFailure("aborted", "The command was aborted before it started.");
        }
        const callContext = options?.context;
        const settings = deps.settings(callContext?.threadId);

        // 1. cwd: 읽기 root 안인지만 본다(쓰기 root 검사는 하지 않는다)
        let cwd = deps.env.cwd;
        if (input.cwd !== undefined) {
          const resolved = await resolveWorkspacePath(deps.roots, input.cwd, "read", context);
          if (!resolved.exists) {
            throw new WorkspaceFailure("not_found", `Working directory not found: ${input.cwd}`);
          }
          const info = await deps.env.fileInfo(resolved.canonical, context);
          if (!info.ok) throw info.error;
          if (info.value.kind !== "directory") {
            throw new WorkspaceFailure("invalid_input", `Not a directory: ${input.cwd}`);
          }
          cwd = resolved.canonical;
        }

        // 2. 샌드박스 래핑. 서비스가 없으면 격리 없이 조용히 실행하지 않고 거부한다
        const { sandbox } = deps;
        if (sandbox === undefined) {
          throw new WorkspaceFailure("unavailable", "The sandbox service is not available.", {
            detail: { by: "sandbox", reason: "sandbox_service_missing" },
          });
        }
        const roots = await deps.roots.roots(context);
        const policy = sandbox.defaultPolicy({
          workspaceRoots: roots.write,
          tempDir: deps.tempDir,
        });
        const shell = sandbox.wrapShell(deps.env, policy);

        // 3~4. 제한 시간: 입력 → 설정 기본값 순. 실행한다
        const timeoutSec =
          input.timeoutSec ??
          (settings.shell.defaultTimeoutSec > 0 ? settings.shell.defaultTimeoutSec : undefined);
        const secretEnv = secretEnvOf(input, callContext);
        const startedAt = deps.clock.now();
        const ran = await runBashCommand(
          shell,
          {
            command: input.command,
            cwd,
            ...(timeoutSec === undefined ? {} : { timeoutSec }),
            ...(secretEnv === undefined ? {} : { secretEnv }),
          },
          { maxLines: settings.shell.maxLines, maxBytes: settings.shell.maxBytes },
          context,
        );
        const durationMs = Math.max(0, deps.clock.now() - startedAt);

        if (!ran.ok) {
          const { error, partial, fullOutputPath } = ran.error;
          if (error.code === "timeout") {
            // 프로세스 그룹 종료는 xeon.exec가 한다. 그때까지의 출력은 detail에 싣는다
            throw new WorkspaceFailure(
              "timeout",
              `Command timed out after ${timeoutSec ?? 0} seconds`,
              {
                detail: toRunOutput(
                  {
                    exitCode: NO_EXIT_CODE,
                    output: partial.output,
                    truncated: partial.truncated,
                    ...(fullOutputPath === undefined ? {} : { fullOutputPath }),
                  },
                  durationMs,
                ),
              },
            );
          }
          throw error;
        }
        const output = toRunOutput(ran.value, durationMs);
        if (input.failOnNonZero === true && output.exitCode !== 0) {
          throw new WorkspaceFailure(
            "exit_nonzero",
            `exit code ${output.exitCode}\n${output.output}`,
            {
              detail: output,
            },
          );
        }
        return output;
      });
    },
  };
}
