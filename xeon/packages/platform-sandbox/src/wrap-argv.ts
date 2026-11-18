import { attempt, err, ok, type Result } from "@fresnel/contracts";
import type {
  CancelScope,
  SandboxArgvRequest,
  SandboxPolicy,
  SandboxedArgv,
  SandboxWrapError,
} from "@fresnel/contracts/services";
import { mkdirSync, rmSync } from "node:fs";
import { posix } from "node:path";
import { tmpdir } from "node:os";
import {
  decideExecution,
  envAdditions,
  newCommandId,
  quoteArg,
  quoteArgv,
  srtWrap,
  type WrapShellDeps,
} from "./wrap-shell.ts";

// L0.sandbox.spec §4.9 wrapArgv. wrapShell과 같은 정책 변환·격리 불가 판정(§4.5)을 쓰고, 끝난 결과 대신 argv를 돌려준다.
// 오래 사는 프로세스(stdio MCP 서버)는 호출자가 argv를 스트림 그대로 spawn하고, 끝나면 cleanup을 부른다.

const NOOP = (): void => {};

/** 격리 없이 도는 명령줄. 요청 그대로다 */
function plainArgv(
  request: SandboxArgvRequest,
  by: NonNullable<SandboxedArgv["unsandboxedBy"]>,
): SandboxedArgv {
  return {
    argv: [request.command, ...request.args],
    env: {},
    sandboxed: false,
    unsandboxedBy: by,
    cleanup: NOOP,
  };
}

export async function wrapArgvWith(
  deps: WrapShellDeps,
  policy: SandboxPolicy,
  request: SandboxArgvRequest,
  context: CancelScope,
): Promise<Result<SandboxedArgv, SandboxWrapError>> {
  if (context.abortSignal?.aborted === true) return err({ kind: "aborted" });
  await deps.ensureCurrent(context);
  const status = deps.status();
  const decision = decideExecution(status, policy, deps.escapeRetry());
  if (decision.action === "reject") return err({ kind: "unavailable", reason: status.reason });
  if (decision.action === "plain") return ok(plainArgv(request, decision.by));
  const commandId = newCommandId(deps.random);
  // "no-write" 프로필이 쓸 수 있는 곳은 이 프로세스 전용의 빈 임시 폴더 하나뿐이다. 다른 프로세스와 나누지 않고 cleanup이 지운다
  let processTemp: string | undefined;
  if (policy.profile === "no-write") {
    const dir = posix.join(deps.readOnlyTempBase?.() ?? tmpdir(), `nw-${commandId}`);
    const made = attempt(() => mkdirSync(dir, { recursive: true, mode: 0o700 }));
    if (!made.ok) {
      return err({ kind: "failed", message: "no-write sandbox could not prepare its temp folder" });
    }
    processTemp = dir;
  }
  const removeTemp = (): void => {
    if (processTemp === undefined) return;
    const removed = attempt(() => rmSync(processTemp, { recursive: true, force: true }));
    if (!removed.ok) deps.logger.warn("sandbox.no_write_temp_cleanup_failed", {});
  };
  const wrapped = await srtWrap(deps, policy, {
    // 임시 폴더는 srt가 정한 `TMPDIR=/tmp/claude`를 덮어야 하므로 셸 안에서 정한다
    command:
      processTemp === undefined
        ? quoteArgv([request.command, ...request.args])
        : `export TMPDIR=${quoteArg(processTemp)}; exec ${quoteArgv([request.command, ...request.args])}`,
    baseDir: request.cwd !== undefined && request.cwd.startsWith("/") ? request.cwd : "/",
    cwd: request.cwd,
    abortSignal: context.abortSignal,
    commandId,
    ...(processTemp === undefined ? {} : { readOnlyTemp: processTemp }),
  });
  if (!wrapped.ok) {
    removeTemp();
    return err(
      wrapped.error.code === "aborted"
        ? { kind: "aborted" }
        : { kind: "failed", message: wrapped.error.message },
    );
  }
  let cleaned = false;
  return ok({
    argv: wrapped.value.argv,
    env: envAdditions(deps.parentEnv(), wrapped.value.env),
    sandboxed: true,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      removeTemp();
      try {
        deps.srt.cleanupAfterCommand();
      } catch (caught) {
        deps.logger.warn("sandbox.cleanup_failed", {
          error: caught instanceof Error ? caught.name : typeof caught,
        });
      }
    },
  });
}
