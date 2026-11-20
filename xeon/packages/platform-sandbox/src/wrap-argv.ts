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
import { carveOutRules, type CarveOutRules } from "./carve-outs.ts";
import { canonicalizePath, seatbeltSafe } from "./paths.ts";
import type { EffectivePolicy } from "./policy.ts";
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

/** 프로필 끝에 덧붙이는 구간의 표지. 덧붙인 뒤 정확히 한 번 있는지 확인하는 데도 쓴다 */
const TAIL_MARK = "; script tools";

/** 덧붙이기가 실패했을 때의 메시지(경로와 이름을 싣지 않는다) */
const TAIL_UNSAFE = "sandbox profile tail rejected an unsafe path or service name";
const TAIL_PROTECTED =
  "sandbox profile tail rejected a read carve-out that contains a protected path";

/**
 * `systemInfoDeny`가 더하는 Seatbelt 규칙. 뒤에 오는 규칙이 앞의 규칙을 이긴다(srt 기본 프로필이 허용한 것을 다시 막는다).
 * - 다른 프로세스의 정보(`process-info*`)와 프로세스 표·인자·환경 변수를 주는 `sysctl`: 자기 프로세스와 같은 샌드박스 안 프로세스는 다시 허용한다
 * - IOKit 레지스트리 속성(시리얼 번호, 하드웨어 UUID 등)과 전원 관리 사용자 클라이언트
 * - 다른 앱이 듣는 배포 알림 보내기
 */
const SYSTEM_INFO_RULES: readonly string[] = [
  "(deny process-info*)",
  "(allow process-info* (target self))",
  "(allow process-info* (target same-sandbox))",
  '(deny sysctl-read (sysctl-name-prefix "kern.proc.all") (sysctl-name-prefix "kern.proc.pgrp.") (sysctl-name-prefix "kern.proc.pid.") (sysctl-name-prefix "kern.procargs"))',
  "(deny iokit-get-properties)",
  '(deny iokit-open (iokit-registry-entry-class "RootDomainUserClient"))',
  "(deny distributed-notification-post)",
];

const MACH_NAME = /^[A-Za-z0-9._@-]+$/;

/**
 * `policy.readAllowLiteral`, `policy.toolDeny`, `policy.machDeny`, `policy.systemInfoDeny`와 읽기 예외(`carve`)를 Seatbelt 프로필 맨 끝에 더한다.
 * 뒤에 오는 규칙이 앞의 규칙을 이기므로 보호 경로 거부를 예외 폴더에서 풀고(예외 규칙을 맨 앞에 둔다), 허용한 폴더 안의 개별 도구를 다시 막을 수 있다.
 * 더할 규칙이 없거나 Seatbelt가 아니면(bwrap, 격리 없음) 그대로 둔다(읽기 예외가 있는 bwrap은 호출 전에 거부한다).
 * Seatbelt인데 덧붙이지 못하면(안전하지 않은 경로, srt가 만든 프로필 문자열의 모양이 달라짐) 막기를 조용히 빼지 않고 실패를 돌려준다: 호출자는 스크립트를 띄우지 않는다
 */
function withProfileTail(
  argv: readonly string[],
  policy: SandboxPolicy,
  kind: WrapShellDeps["provider"]["kind"],
  carve: CarveOutRules,
): Result<string[], string> {
  const wantLiterals = policy.readAllowLiteral ?? [];
  const wantDenied = policy.toolDeny ?? [];
  const wantMach = policy.machDeny ?? [];
  const wantInfo = policy.systemInfoDeny === true;
  const wantCarve = carve.literal.length + carve.subpath.length;
  if (wantCarve + wantLiterals.length + wantDenied.length + wantMach.length === 0 && !wantInfo) {
    return ok([...argv]);
  }
  if (kind !== "seatbelt") return ok([...argv]);
  if (
    !wantLiterals.every(seatbeltSafe) ||
    !wantDenied.every(seatbeltSafe) ||
    !wantMach.every((name) => MACH_NAME.test(name))
  ) {
    return err(TAIL_UNSAFE);
  }
  // 읽기 예외는 경로를 `carveOutRules`가 이미 확인했다(절대 경로, Seatbelt 안전, 정규 경로, 보호 경로 아님)
  const rules: string[] = [];
  for (const path of carve.literal) rules.push(`(allow file-read* (literal "${path}"))`);
  for (const path of carve.subpath) rules.push(`(allow file-read* (subpath "${path}"))`);
  if (wantLiterals.length > 0) {
    rules.push(`(allow file-read* ${wantLiterals.map((path) => `(literal "${path}")`).join(" ")})`);
  }
  if (wantDenied.length > 0) {
    const targets = wantDenied.map((path) => `(literal "${path}")`).join(" ");
    rules.push(`(deny file-read* ${targets})`, `(deny process-exec ${targets})`);
  }
  if (wantMach.length > 0) {
    rules.push(`(deny mach-lookup ${wantMach.map((name) => `(global-name "${name}")`).join(" ")})`);
  }
  if (wantInfo) rules.push(...SYSTEM_INFO_RULES);
  const marker = "sandbox-exec -p '";
  let applied = 0;
  const wrapped = argv.map((arg) => {
    const start = arg.indexOf(marker);
    if (start < 0) return arg;
    const end = profileEnd(arg, start + marker.length);
    if (end < 0) return arg;
    applied += 1;
    return `${arg.slice(0, end)}\n${TAIL_MARK}\n${rules.join("\n")}\n${arg.slice(end)}`;
  });
  if (applied !== 1 || wrapped.join("\u0000").split(TAIL_MARK).length !== 2) {
    return err("sandbox profile tail could not be applied to the srt profile");
  }
  return ok(wrapped);
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
  const baseDir = request.cwd !== undefined && request.cwd.startsWith("/") ? request.cwd : "/";
  const scriptEnv = policy.profile === "script-env";
  const carveOuts = policy.readCarveOuts ?? [];
  if (carveOuts.length > 0 && !scriptEnv) {
    return err({ kind: "failed", message: "read carve-outs need the script-env profile" });
  }
  // 읽기 예외는 임시 폴더를 만들기 전에 검사한다. 실패해도 남는 것이 없다
  let resolved: EffectivePolicy | undefined;
  let carve: CarveOutRules = { literal: [], subpath: [] };
  if (scriptEnv) {
    if (carveOuts.length > 0 && deps.provider.kind !== "seatbelt") {
      return err({
        kind: "failed",
        message: "read carve-outs are not supported on this sandbox provider",
      });
    }
    resolved = deps.resolvePolicy(policy, baseDir);
    const rules = carveOutRules({
      carveOuts,
      readDeny: resolved.readDeny,
      protectedEntries: deps.protectedEntries(),
    });
    if (!rules.ok) {
      return err({
        kind: "failed",
        message: rules.error === "protected" ? TAIL_PROTECTED : TAIL_UNSAFE,
      });
    }
    carve = rules.value;
  }
  // "no-write"와 "script-env" 프로필이 쓸 수 있는 곳은 이 프로세스 전용의 빈 임시 폴더 하나뿐이다. 다른 프로세스와 나누지 않고 cleanup이 지운다
  let processTemp: string | undefined;
  if (policy.profile === "no-write" || scriptEnv) {
    const label = scriptEnv ? "script-env" : "no-write";
    const dir = posix.join(
      deps.readOnlyTempBase?.() ?? tmpdir(),
      `${scriptEnv ? "se" : "nw"}-${commandId}`,
    );
    const made = attempt(() => mkdirSync(dir, { recursive: true, mode: 0o700 }));
    if (!made.ok) {
      return err({ kind: "failed", message: `${label} sandbox could not prepare its temp folder` });
    }
    // 임시 폴더 기반이 심볼릭 링크 아래(macOS의 `/var/folders`는 `/private/var/folders`)면 Seatbelt는 정규 경로로 비교하므로 허용이 닿지 않는다.
    // 정규 경로로 풀어 쓰기 허용과 `TMPDIR`에 쓴다
    processTemp = canonicalizePath(dir);
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
    baseDir,
    cwd: request.cwd,
    abortSignal: context.abortSignal,
    commandId,
    ...(processTemp === undefined ? {} : { readOnlyTemp: processTemp }),
    ...(resolved === undefined ? {} : { resolved }),
  });
  if (!wrapped.ok) {
    removeTemp();
    return err(
      wrapped.error.code === "aborted"
        ? { kind: "aborted" }
        : { kind: "failed", message: wrapped.error.message },
    );
  }
  const tailed = withProfileTail(wrapped.value.argv, policy, deps.provider.kind, carve);
  if (!tailed.ok) {
    // 막기를 덧붙이지 못한 채로는 띄우지 않는다. srt가 이 명령용으로 만든 것을 되돌린다
    removeTemp();
    const cleanedUp = attempt(() => deps.srt.cleanupAfterCommand());
    if (!cleanedUp.ok) deps.logger.warn("sandbox.cleanup_failed", {});
    deps.logger.warn("sandbox.profile_tail_failed", {});
    return err({ kind: "failed", message: tailed.error });
  }
  let cleaned = false;
  return ok({
    argv: tailed.value,
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
