import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { posix } from "node:path";
import { attemptAsync, type Clock, type Logger, type RandomSource } from "@xeon/contracts";
import {
  SENSITIVE_ENV_PATTERNS,
  type CancelScope,
  type OsDirs,
  type SandboxPolicy,
  type SelfTestItem,
  type SelfTestItemId,
  type SelfTestReport,
  type Shell,
} from "@xeon/contracts/services";
import { newCommandId } from "./wrap-shell.ts";

// L0.sandbox.spec §4.4 자가 시험. 샌드박스 안에서 정해진 시도를 실행해 거부·허용이 기대대로인지 확인한다.
// 보고에는 항목 id와 통과 여부, 종료 코드만 싣는다. 출력 원문은 싣지 않는다.

export interface SelfTestDeps {
  readonly dirs: Pick<OsDirs, "data" | "tmp">;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly logger: Logger;
  /** allowEscape가 거짓인 정책으로 Shell을 감싼다. 자가 시험 중에는 이전 자가 시험 실패로 막지 않는 감싸기여야 한다 */
  readonly wrap: (shell: Shell, policy: SandboxPolicy) => Shell;
  readonly defaultPolicy: (input: {
    workspaceRoots: readonly string[];
    tempDir: string;
  }) => SandboxPolicy;
}

/** 자가 시험 항목 6개의 id. 보고의 순서다 */
export const SELF_TEST_ITEM_IDS: readonly SelfTestItemId[] = [
  "protected_read_denied",
  "xeon_data_write_denied",
  "network_denied",
  "workspace_write_allowed",
  "env_allowlist",
  "git_hooks_write_denied",
];

const OUTPUT_CAP = 64 * 1024;
const COMMAND_TIMEOUT_SECONDS = 20;

interface RunOutcome {
  /** 실행이 끝나 종료 코드를 얻었으면 그 값. 실행 자체가 실패했으면 undefined */
  readonly exitCode: number | undefined;
  readonly output: string;
  /** 실행 자체가 실패한 이유 코드 */
  readonly failure: string | undefined;
}

async function exists(path: string): Promise<boolean> {
  const found = await attemptAsync(() => stat(path));
  return found.ok;
}

/**
 * srt가 샌드박스 안 프록시 클라이언트용으로 직접 내보내는 env 이름 가운데 `SENSITIVE_ENV_PATTERNS`에 걸리는 것.
 * 값은 srt가 프로세스마다 새로 만드는 자체 프록시의 인증 토큰이고 사용자 비밀이 아니다(srt 0.0.79 `CLOUDSDK_PROXY_PASSWORD`).
 * 실제 srt로 시험하면 이 이름 하나 때문에 `env_allowlist`가 항상 실패하므로 이 이름만 센 대상에서 뺀다 (마감 G4-01).
 * srt를 올릴 때 `sandbox.int.test.ts`가 새로 걸리는 이름을 잡는다.
 */
const SRT_PROXY_CREDENTIAL_ENV: ReadonlySet<string> = new Set(["CLOUDSDK_PROXY_PASSWORD"]);

/** SENSITIVE_ENV_PATTERNS의 패턴(앞 또는 끝의 *)이 env 이름과 맞는가 */
export function isSensitiveEnvName(name: string): boolean {
  return SENSITIVE_ENV_PATTERNS.some((pattern) => {
    if (pattern.startsWith("*")) return name.endsWith(pattern.slice(1));
    if (pattern.endsWith("*")) return name.startsWith(pattern.slice(0, -1));
    return pattern === name;
  });
}

/** `env` 출력에서 env 이름만 뽑는다. 값은 읽지도 싣지도 않는다 */
function envNames(output: string): string[] {
  const names: string[] = [];
  for (const line of output.split("\n")) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (match?.[1] !== undefined) names.push(match[1]);
  }
  return names;
}

function describeOutcome(outcome: RunOutcome): string {
  return outcome.exitCode === undefined
    ? `exec_error=${outcome.failure ?? "unknown"}`
    : `exit=${outcome.exitCode}`;
}

async function run(
  wrapped: Shell,
  argv: readonly string[],
  cwd: string,
  context: CancelScope,
): Promise<RunOutcome> {
  let output = "";
  const result = await wrapped.exec(
    argv,
    {
      cwd,
      timeout: COMMAND_TIMEOUT_SECONDS,
      onOutput: (text) => {
        if (output.length < OUTPUT_CAP) output += text.slice(0, OUTPUT_CAP - output.length);
      },
    },
    context,
  );
  if (!result.ok) return { exitCode: undefined, output, failure: result.error.code };
  return { exitCode: result.value.exitCode, output, failure: undefined };
}

function item(id: SelfTestItemId, passed: boolean, detail: string): SelfTestItem {
  return { id, passed, detail };
}

/** 거부를 기대하는 시도: 실행이 끝났고 종료 코드가 0이 아니어야 한다. 실행 자체의 실패는 거부로 세지 않는다 */
function denied(outcome: RunOutcome): boolean {
  return outcome.exitCode !== undefined && outcome.exitCode !== 0;
}

async function removeQuietly(logger: Logger, dir: string | undefined): Promise<void> {
  if (dir === undefined) return;
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (caught) {
    logger.warn("sandbox.self_test_cleanup_failed", {
      error: caught instanceof Error ? caught.name : typeof caught,
    });
  }
}

export async function runSelfTest(
  deps: SelfTestDeps,
  shell: Shell,
  context: CancelScope,
): Promise<SelfTestReport> {
  const startedAt = deps.clock.now();
  const probeDir = posix.join(deps.dirs.data, "selftest");
  let workspace: string | undefined;
  const items: SelfTestItem[] = [];
  try {
    await mkdir(deps.dirs.tmp, { recursive: true });
    workspace = await realpath(await mkdtemp(posix.join(deps.dirs.tmp, "xeon-sandbox-selftest-")));
    await mkdir(probeDir, { recursive: true });
    const canary = `canary-${newCommandId(deps.random)}`;
    await writeFile(posix.join(probeDir, "canary"), canary);
    await mkdir(posix.join(workspace, ".git", "hooks"), { recursive: true });

    const wrapped = deps.wrap(
      shell,
      deps.defaultPolicy({ workspaceRoots: [workspace], tempDir: workspace }),
    );

    // 1. 보호 경로 읽기 거부
    const read = await run(wrapped, ["cat", posix.join(probeDir, "canary")], workspace, context);
    items.push(
      item(
        "protected_read_denied",
        denied(read) && !read.output.includes(canary),
        describeOutcome(read),
      ),
    );

    // 2. Xeon 데이터 디렉터리 쓰기 거부
    const probeFile = posix.join(probeDir, "write-probe");
    const dataWrite = await run(wrapped, ["touch", probeFile], workspace, context);
    items.push(
      item(
        "xeon_data_write_denied",
        denied(dataWrite) && !(await exists(probeFile)),
        describeOutcome(dataWrite),
      ),
    );

    // 3. 네트워크 거부
    const network = await run(
      wrapped,
      ["bash", "-c", "exec 3<>/dev/tcp/example.com/80"],
      workspace,
      context,
    );
    items.push(item("network_denied", denied(network), describeOutcome(network)));

    // 4. 쓰기 루트 안 쓰기 허용
    const okFile = posix.join(workspace, "ok");
    const workspaceWrite = await run(wrapped, ["touch", okFile], workspace, context);
    items.push(
      item(
        "workspace_write_allowed",
        workspaceWrite.exitCode === 0 && (await exists(okFile)),
        describeOutcome(workspaceWrite),
      ),
    );

    // 5. 자식 env에 민감한 이름이 없음
    const env = await run(wrapped, ["env"], workspace, context);
    const sensitive = envNames(env.output)
      .filter(isSensitiveEnvName)
      .filter((name) => !SRT_PROXY_CREDENTIAL_ENV.has(name)).length;
    items.push(
      item(
        "env_allowlist",
        env.exitCode === 0 && sensitive === 0,
        `${describeOutcome(env)} sensitive=${sensitive}`,
      ),
    );

    // 6. .git/hooks 쓰기 거부
    const hookFile = posix.join(workspace, ".git", "hooks", "pre-commit");
    const hook = await run(wrapped, ["touch", hookFile], workspace, context);
    items.push(
      item(
        "git_hooks_write_denied",
        denied(hook) && !(await exists(hookFile)),
        describeOutcome(hook),
      ),
    );
  } catch (caught) {
    // 준비 단계의 파일 시스템 오류 등. 아직 시험하지 못한 항목은 실패로 채운다
    const name = caught instanceof Error ? caught.name : typeof caught;
    deps.logger.error("sandbox.self_test_setup_failed", { error: name });
    for (const id of SELF_TEST_ITEM_IDS) {
      if (!items.some((done) => done.id === id)) items.push(item(id, false, `setup_error=${name}`));
    }
  } finally {
    await Promise.all([
      removeQuietly(deps.logger, probeDir),
      removeQuietly(deps.logger, workspace),
    ]);
  }
  return {
    at: startedAt,
    durationMs: Math.max(0, deps.clock.now() - startedAt),
    passed: items.every((entry) => entry.passed),
    items,
  };
}
