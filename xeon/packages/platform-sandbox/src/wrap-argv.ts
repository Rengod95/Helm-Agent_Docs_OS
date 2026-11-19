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

/** Seatbelt 규칙 문자열에 그대로 넣어도 되는 경로인가(따옴표, 역슬래시, 줄바꿈이 없다) */
function seatbeltSafe(path: string): boolean {
  return path.startsWith("/") && !/["'\\\n\r]/.test(path);
}

/** 프로필 문자열이 끝나는 자리. 작은따옴표 안에서 `'"'"'`는 이스케이프라 건너뛰고, 처음 만나는 닫는 작은따옴표다 */
function profileEnd(text: string, from: number): number {
  let at = from;
  while (at < text.length) {
    if (text.startsWith("'\"'\"'", at)) {
      at += 5;
    } else if (text[at] === "'") {
      return at;
    } else {
      at += 1;
    }
  }
  return -1;
}

/**
 * `policy.readAllowLiteral`과 `policy.toolDeny`를 Seatbelt 프로필 맨 끝에 더한다. 뒤에 오는 규칙이 앞의 규칙을 이기므로 허용한 폴더 안의 개별 도구를 다시 막을 수 있다.
 * Seatbelt 프로필(`sandbox-exec -p '...'`)이 아니면(bwrap, 격리 없음) 그대로 둔다. 안전하지 않은 경로(따옴표 등)는 건너뛴다
 */
function withProfileTail(argv: readonly string[], policy: SandboxPolicy): string[] {
  const literals = (policy.readAllowLiteral ?? []).filter(seatbeltSafe);
  const denied = (policy.toolDeny ?? []).filter(seatbeltSafe);
  const mach = (policy.machDeny ?? []).filter((name) => /^[A-Za-z0-9._@-]+$/.test(name));
  if (literals.length === 0 && denied.length === 0 && mach.length === 0) return [...argv];
  const marker = "sandbox-exec -p '";
  return argv.map((arg) => {
    const start = arg.indexOf(marker);
    if (start < 0) return arg;
    const end = profileEnd(arg, start + marker.length);
    if (end < 0) return arg;
    const rules: string[] = [];
    if (literals.length > 0) {
      rules.push(`(allow file-read* ${literals.map((path) => `(literal "${path}")`).join(" ")})`);
    }
    if (denied.length > 0) {
      const targets = denied.map((path) => `(literal "${path}")`).join(" ");
      rules.push(`(deny file-read* ${targets})`, `(deny process-exec ${targets})`);
    }
    if (mach.length > 0) {
      rules.push(`(deny mach-lookup ${mach.map((name) => `(global-name "${name}")`).join(" ")})`);
    }
    return `${arg.slice(0, end)}\n; script tools\n${rules.join("\n")}\n${arg.slice(end)}`;
  });
}

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
    argv: withProfileTail(wrapped.value.argv, policy),

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
