import { assertNever } from "@fresnel/contracts";
import {
  WorkspaceShell,
  type CallContext,
  type CapabilityApi,
  type SecretRef,
} from "@fresnel/contracts/capabilities";
import type { CancelScope, SecretEnvRequest } from "@fresnel/contracts/services";
import type { WorkspaceDeps } from "../deps.ts";
import { WorkspaceFailure, guarded } from "../errors.ts";
import { resolveWorkspacePath } from "../roots.ts";
import { scopedDeps } from "../scope.ts";
import { runBashCommand, type BashOutcome } from "./upstream/bash.ts";
import { unattendedTimeoutSec } from "./unattended.ts";
import {
  narrowHomeRoots,
  pathsFromDenialOutput,
  planWriteAccess,
  requestWriteAccess,
} from "../write-access.ts";

// L2.workspace.spec §3.3, §4.2. 샌드박스 래핑(fresnel.sandbox)과 실행(fresnel.exec)은 F 인터페이스로만 만난다.

type ShellApi = CapabilityApi<typeof WorkspaceShell>;
type RunInput = Parameters<ShellApi["run"]>[0];
type RunResult = Awaited<ReturnType<ShellApi["run"]>>;

const CAPABILITY = WorkspaceShell.id;

/** 시간 초과로 끝난 명령에는 종료 코드가 없다. RunOutput이 정수를 요구해 -1로 싣는다 */
const NO_EXIT_CODE = -1;

/** 한 호출에서 쓰기 허용을 묻고 다시 실행하는 최대 횟수. 명령이 막힌 경로를 차례로 드러내므로 한 번보다 많다 */
const MAX_WRITE_ACCESS_ROUNDS = 3;

function isSecretRef(value: string): value is SecretRef {
  return value.startsWith("secret://");
}

/** 시크릿 사용 목적 표지 `bash:<argv0>`. 경로와 특수 문자를 걷어 감사 기록에 안전한 이름만 남긴다 */
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
 * `secretEnv` 요청. 값은 이 패키지를 지나지 않는다: 참조만 `fresnel.exec`에 넘기고 값 주입은 spawn 직전에 한다.
 * 승인 증거(`approval`)는 `CallContext.approval`(L1.tools가 사람의 승인을 받았을 때 채운다, F 요청 13)을 그대로 옮긴다.
 * 증거가 없으면 null이라 `fresnel.secrets`가 `approval_missing`으로 거부한다(fail-closed).
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
      approval: context?.approval ?? null,
    },
  };
}

function toRunOutput(outcome: BashOutcome, durationMs: number): RunResult {
  const blocks = outcome.sandbox?.blocks;
  return {
    exitCode: outcome.exitCode,
    output: outcome.output,
    truncated: outcome.truncated,
    ...(outcome.fullOutputPath === undefined ? {} : { fullOutputPath: outcome.fullOutputPath }),
    durationMs,
    sandboxed: outcome.sandbox?.sandboxed ?? false,
    // 샌드박스 밖 실행의 이유. L1이 감사 이벤트 tool.sandbox_bypassed로 남긴다(L1.tools.spec §4.12.2)
    ...(outcome.sandbox?.sandboxed === false && outcome.sandbox.unsandboxedBy !== undefined
      ? { unsandboxedBy: outcome.sandbox.unsandboxedBy }
      : {}),
    // 샌드박스가 막은 것(L0.sandbox.spec §4.2 11번). L1이 화면과 모델 글의 이유로 바꾼다(L1.tools.spec §4.12.3)
    ...(blocks === undefined ? {} : { sandboxBlocks: blocks }),
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

        // 3~4. 제한 시간: 입력 → 설정 기본값 순. 무인 호출은 상한을 더 받는다(L0.exec.spec §3.8.1). 실행한다
        const requestedSec =
          input.timeoutSec ??
          (settings.shell.defaultTimeoutSec > 0 ? settings.shell.defaultTimeoutSec : undefined);
        const timeoutSec =
          callContext?.interactive === false
            ? unattendedTimeoutSec(requestedSec, deps.unattendedTimeoutMs?.())
            : requestedSec;
        const secretEnv = secretEnvOf(input, callContext);
        const startedAt = deps.clock.now();
        // 허용한 쓰기 루트(grants)를 정책에 더해 한 번 실행한다. 정책의 보호 경로 처리가 보호 경로 안의 루트를 다시 뺀다
        const execute = (grants: readonly string[]): ReturnType<typeof runBashCommand> => {
          const policy = sandbox.defaultPolicy({
            workspaceRoots: [...roots.write, ...grants],
            tempDir: deps.tempDir,
          });
          return runBashCommand(
            sandbox.wrapShell(deps.env, policy),
            {
              command: input.command,
              cwd,
              ...(timeoutSec === undefined ? {} : { timeoutSec }),
              ...(secretEnv === undefined ? {} : { secretEnv }),
            },
            { maxLines: settings.shell.maxLines, maxBytes: settings.shell.maxBytes },
            context,
          );
        };
        // 샌드박스의 쓰기 거부로 실패했으면 막힌 경로를 물어보고, 허용이면 같은 명령을 다시 실행한다(spec §4.3.1)
        const withWriteAccess = async (
          previous: Awaited<ReturnType<typeof execute>>,
          grants: readonly string[],
          round: number,
        ): Promise<Awaited<ReturnType<typeof execute>>> => {
          if (!previous.ok || round > MAX_WRITE_ACCESS_ROUNDS) return previous;
          const outcome = previous.value;
          if (outcome.exitCode === 0 || outcome.sandbox?.sandboxed !== true) return previous;
          const reported = (outcome.sandbox.blocks ?? []).flatMap((block) =>
            block.code === "sandbox.write_blocked" ? [block.path] : [],
          );
          // 위반 보고가 비면(macOS는 일부 거부를 보고하지 않는다) 거부 문구가 든 출력 줄의 경로를 후보로 쓴다
          const blocked = reported.length > 0 ? reported : pathsFromDenialOutput(outcome.output);
          const plan = await narrowHomeRoots(
            planWriteAccess(
              blocked,
              deps.roots.protectedPaths([...roots.read, ...roots.write]),
              [...roots.write, ...grants],
              deps.homeDir,
            ),
            deps.homeDir,
            async (path) => {
              const found = await deps.env.exists(path, context);
              return found.ok && found.value;
            },
          );
          if (plan.roots.length === 0) return previous;
          const allowed = await requestWriteAccess(deps, {
            via: "bash",
            plan,
            context: callContext,
            round,
            signal: options?.signal,
            command: input.command,
          });
          if (!allowed) return previous;
          const next = [...grants, ...plan.roots];
          return withWriteAccess(await execute(next), next, round + 1);
        };
        const ran = await withWriteAccess(await execute([]), [], 1);
        const durationMs = Math.max(0, deps.clock.now() - startedAt);

        if (!ran.ok) {
          const { error, partial, fullOutputPath } = ran.error;
          if (error.code === "timeout") {
            // 프로세스 그룹 종료는 fresnel.exec가 한다. 그때까지의 출력은 detail에 싣는다
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
