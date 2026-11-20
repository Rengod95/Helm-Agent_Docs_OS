import { isAbsolute } from "node:path";
import type { Logger } from "@fresnel/contracts";
import type { HookProcessPort } from "@fresnel/contracts/extensions";

// 가져온 훅(환경 모드)이 돌 "사용자의 환경"을 얻는다(AGE-58 원칙 가, [제안]). 원래 하네스는 사용자가 터미널에서 띄운 환경(PATH, mise·Homebrew, 환경 변수)을 그대로 물려받았다.
// 데스크톱 앱을 Finder로 띄우면 엔진의 PATH는 짧아 그 도구들이 안 보인다(apps/desktop-shell의 `augmentPath`는 Homebrew 몇 곳만 더한다).
// 그래서 사용자의 로그인 셸을 한 번 띄워 환경을 읽는다: `$SHELL -l -i -c '<표지>; env -0; <표지>'`.
// - 이것은 사용자의 셸 시작 파일(`.zprofile`, `.zshrc`, `.bash_profile` 등)을 엔진 권한으로 실행한다. 터미널을 여는 것과 같은 코드이고 작업 폴더는 홈이다. 프로젝트 파일은 읽지 않는다.
// - 표준 입력은 닫고, 시간 제한(기본 5초)을 넘으면 죽이고, 실패하면 엔진 프로세스의 환경으로 물러난다(경고 한 줄, 이유만). 결과는 캐시한다(기본 10분).
// - 환경 변수의 값은 기록하지 않는다. 기록하는 것은 출처, 변수 개수, PATH 항목 개수뿐이다.
// 터미널에서 띄운 엔진이면 엔진 환경이 이미 사용자의 환경이므로, 로그인 셸 환경을 위에 덮되 엔진 쪽에만 있는 변수도 남긴다.

/** 로그인 셸 실행 결과. 표준 출력 전체이거나 실패 이유다 */
type LoginShellResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly reason: "spawn_failed" | "timeout" | "exit_nonzero" };

/** 로그인 셸을 띄우는 수단. 시험이 대신한다 */
export type LoginShellRunner = (input: {
  readonly shell: string;
  readonly script: string;
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly timeoutMs: number;
}) => Promise<LoginShellResult>;

export interface UserEnvDeps {
  /** 엔진 프로세스의 환경. 물러날 값이자 로그인 셸에 넘기는 환경이다 */
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  readonly run: LoginShellRunner;
  readonly now: () => number;
  readonly logger: Logger;
  /** 로그인 셸 시간 제한(ms). 기본 5000 */
  readonly timeoutMs?: number;
  /** 캐시 시간(ms). 기본 10분 */
  readonly ttlMs?: number;
}

const START = "__FRESNEL_ENV_START__";
const END = "__FRESNEL_ENV_END__";
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 로그인 셸에서 돌리는 한 줄. 표지 사이의 `env -0` 출력만 읽는다(시작 파일이 낸 글은 표지 밖이다) */
export const LOGIN_ENV_SCRIPT: string = `printf '%s' '${START}'; /usr/bin/env -0; printf '%s' '${END}'`;

/** 표지 사이의 `NAME=value\0…`를 읽는다. 표지가 없거나 이름이 잘못된 항목은 버린다 */
export function parseLoginEnv(stdout: string): Record<string, string> | undefined {
  const start = stdout.lastIndexOf(START);
  const end = stdout.lastIndexOf(END);
  if (start < 0 || end < start) return undefined;
  const body = stdout.slice(start + START.length, end);
  const env: Record<string, string> = {};
  for (const entry of body.split("\0")) {
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    const name = entry.slice(0, eq);
    if (VALID_NAME.test(name)) env[name] = entry.slice(eq + 1);
  }
  return Object.keys(env).length === 0 ? undefined : env;
}

function definedOnly(source: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && VALID_NAME.test(name)) env[name] = value;
  }
  return env;
}

function pathEntriesOf(env: Readonly<Record<string, string>>): number {
  const path = env["PATH"];
  return path === undefined ? 0 : path.split(":").filter((entry) => entry !== "").length;
}

/** 사용자 환경을 얻는 함수를 만든다. 같은 시간 안의 호출은 한 번의 로그인 셸을 나눠 쓴다 */
export function createUserEnvResolver(deps: UserEnvDeps): () => Promise<Record<string, string>> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  let cached: { readonly at: number; readonly env: Record<string, string> } | undefined;
  let inflight: Promise<Record<string, string>> | undefined;

  async function resolveOnce(): Promise<Record<string, string>> {
    const base = definedOnly(deps.parentEnv);
    const shell = base["SHELL"];
    if (shell === undefined || !isAbsolute(shell)) {
      deps.logger.info("script_env.resolved", {
        source: "engine",
        why: "no_shell",
        vars: Object.keys(base).length,
        pathEntries: pathEntriesOf(base),
      });
      return base;
    }
    const probed = await deps.run({
      shell,
      script: LOGIN_ENV_SCRIPT,
      env: base,
      cwd: deps.home,
      timeoutMs,
    });
    const parsed = probed.ok ? parseLoginEnv(probed.stdout) : undefined;
    if (parsed === undefined) {
      deps.logger.warn("script_env.login_shell_failed", {
        reason: probed.ok ? "unparsable" : probed.reason,
        vars: Object.keys(base).length,
        pathEntries: pathEntriesOf(base),
      });
      return base;
    }
    const merged = { ...base, ...parsed };
    deps.logger.info("script_env.resolved", {
      source: "login_shell",
      vars: Object.keys(merged).length,
      pathEntries: pathEntriesOf(merged),
    });
    return merged;
  }

  return async () => {
    if (cached !== undefined && deps.now() - cached.at < ttlMs) return { ...cached.env };
    inflight ??= resolveOnce().then((env) => {
      cached = { at: deps.now(), env };
      inflight = undefined;
      return env;
    });
    return { ...(await inflight) };
  };
}

/** 로그인 셸 출력 상한(글자). 환경 덤프는 수십 KB이므로 넉넉히 둔다 */
const LOGIN_STDOUT_MAX_CHARS = 1_000_000;

/**
 * 운영의 로그인 셸 실행. 프로세스 포트의 외부 훅 실행(`HookProcessPort.run`: 표준 입력 닫힘, 프로세스 트리 정리, 신호로 취소)을 쓴다.
 * 시간 제한은 `AbortSignal.timeout`이고 넘기면 `timeout`이다. 호스트 소스는 프로세스를 직접 띄우지 않는다(DR-07)
 */
export function createLoginShellRunner(port: () => HookProcessPort | undefined): LoginShellRunner {
  return async (input) => {
    const process = port();
    if (process === undefined) return { ok: false, reason: "spawn_failed" };
    const run = await process.run({
      argv: [input.shell, "-l", "-i", "-c", input.script],
      cwd: input.cwd,
      env: input.env,
      stdin: "",
      maxStdoutChars: LOGIN_STDOUT_MAX_CHARS,
      maxStderrChars: 1,
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    if (run.spawnError !== undefined) return { ok: false, reason: "spawn_failed" };
    if (run.timedOut || run.signal !== null) return { ok: false, reason: "timeout" };
    if (run.exitCode !== 0 || run.stdoutTruncated) return { ok: false, reason: "exit_nonzero" };
    return { ok: true, stdout: run.stdout };
  };
}
