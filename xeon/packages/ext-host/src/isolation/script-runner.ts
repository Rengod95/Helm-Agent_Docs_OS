// 매니페스트 `scripts`의 스크립트를 실행하는 실행기(설계 B, F.extensions.spec §3.1.4, drive-isolation §3.4). 엔진(X)이 구현한다.
// 검사 순서는 계약(plugin-script.ts의 `PluginScriptPort`)이 정한 대로다: 선언 → 위치(렉시컬과 실제 위치가 확장 폴더 안) →
// 일반 파일 → 승인 → 돌려 보기 플래그 → 띄우기. 띄우는 것은 주입된 `IsolationProcessPort.spawn`뿐이다. 샌드박스 프로필을
// 넓히지 않는다(쓰기 없음, 읽기는 확장 폴더와 실행 파일뿐). 기한이 지나면 프로세스 트리를 죽이고 `timedOut`으로 답한다.
// 기동 실패와 샌드박스 없음은 결과 값이다. 초안(승인되지 않은 버전)은 띄우지 않는다. 승인 카드를 재사용하는 길은 없다(보고 대상).
import { attemptAsync, err, ok, type Logger, type Result } from "@fresnel/contracts";
import {
  isEntryInsideRoot,
  SCRIPT_LIMITS,
  type IsolatedChild,
  type IsolationProcessPort,
  type IsolationSpawnError,
  type IsolationSpawnSpec,
  type LoaderFs,
  type ManifestScriptDecl,
  type PluginScriptPort,
  type ScriptRunFailure,
  type ScriptRunner,
  type ScriptRunResult,
} from "@fresnel/contracts/extensions";
import { SENSITIVE_ENV_PATTERNS } from "@fresnel/contracts/services";
import { isAbsolute, join } from "node:path";
import { kindOf, within } from "../loading-trust/app-files.ts";

/** 한 확장의 스크립트 대상. 선언과 폴더와 승인 여부는 엔진이 확장을 싣을 때 정한다 */
export interface ScriptTarget {
  /** 확장 이름. 띄우기 라벨 `script:<확장>:<스크립트>`에 쓴다 */
  readonly extension: string;
  /** 매니페스트 `scripts` 선언(검사는 `validateManifest`가 했다) */
  readonly scripts: readonly ManifestScriptDecl[];
  /** 확장 루트 절대 경로. 검토본은 `tree/`, 초안은 초안 `tree/`다. 읽기 전용으로 열린다 */
  readonly tree: string;
  /** 검토된 버전인가. 초안이면 거짓이고 스크립트는 띄우지 않는다 */
  readonly approved: boolean;
}

export interface ScriptRunnerDeps {
  /** 띄우기 포트. 샌드박스 프로필은 이 포트가 정한다 */
  readonly process: IsolationProcessPort;
  /** 폴더와 실제 위치와 파일 종류를 보는 포트(확장 로더와 같다) */
  readonly fs: LoaderFs;
  readonly target: ScriptTarget;
  /** 실행기 이름을 절대 경로로 푼다. 없으면 `runner_unavailable`이다(조립 루트가 준다) */
  readonly resolveRunner: (name: ScriptRunner) => string | undefined;
  /** 허용 목록에 든 환경 값. 선언된 `envNames` 가운데 여기 있는 것만 자식에게 넘긴다 */
  readonly allowedEnv: Readonly<Record<string, string>>;
  /** 기한과 정리 시계. 취소 함수를 돌려준다(격리의 다른 시계와 같은 모양이다) */
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  /** 표준 입력 쓰기 오류(자식이 먼저 끝남)를 기록한다. 없으면 버린다 */
  readonly logger?: Logger;
}

/** 시크릿 거부 패턴의 정규식. 끝과 앞의 `*`만 와일드카드다(`SENSITIVE_ENV_PATTERNS`의 정본 규칙) */
const SENSITIVE_ENV: readonly RegExp[] = SENSITIVE_ENV_PATTERNS.map(
  (pattern) => new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`, "i"),
);

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function isSensitiveEnvName(name: string): boolean {
  return SENSITIVE_ENV.some((pattern) => pattern.test(name));
}

/** 선언된 이름 가운데 시크릿 거부 패턴에 걸리지 않고 허용 목록에 있는 것만 값으로 싣는다 */
function envOf(
  names: readonly string[],
  allowed: Readonly<Record<string, string>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of names) {
    if (isSensitiveEnvName(name)) continue;
    const value = allowed[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

/**
 * 파일 이름 모양과 실제 위치를 본다. 렉시컬 검사는 절대 경로, `..`, 백슬래시, NUL을 밖으로 친다.
 * 실제 위치(심볼릭 링크를 푼 것)가 확장 폴더 밖이면 밖이다. 찾지 못하거나 일반 파일이 아니면 없음이다.
 * 파일 시스템 오류는 찾지 못한 것으로 본다(`LoaderFs`가 던지면 실패 값으로 바꾼다).
 */
async function locate(
  fs: LoaderFs,
  tree: string,
  file: string,
): Promise<Result<string, ScriptRunFailure>> {
  // 절대 경로, 드라이브, NUL, 루트 밖으로 올라가는 `..`, 그리고 `..` 마디 자체와 백슬래시는 모두 밖이다
  if (!isEntryInsideRoot(file) || file.includes("\\") || file.split("/").includes("..")) {
    return err({ kind: "script_outside_tree" });
  }
  const treeReal = await attemptAsync(() => fs.realpath(tree));
  if (!treeReal.ok) return err({ kind: "script_missing" });
  const declared = join(tree, file);
  const present = await attemptAsync(() => fs.exists(declared));
  if (!present.ok || !present.value) return err({ kind: "script_missing" });
  const real = await attemptAsync(() => fs.realpath(declared));
  if (!real.ok) return err({ kind: "script_missing" });
  if (!within(real.value, treeReal.value)) return err({ kind: "script_outside_tree" });
  const kind = await kindOf(fs, real.value);
  if (kind !== "file") return err({ kind: "script_missing" });
  return ok(real.value);
}

function failureOfSpawn(error: IsolationSpawnError): ScriptRunFailure {
  return error.kind === "sandbox_unavailable"
    ? { kind: "sandbox_unavailable", reason: error.reason }
    : { kind: "spawn_failed", code: error.code, message: error.message };
}

/** 모은 출력. 상한을 넘었으면 `truncated`다 */
interface Captured {
  readonly text: string;
  readonly truncated: boolean;
}

/** 자식 출력을 바이트 상한까지 모은다. 넘는 부분은 버리고 읽기는 계속해서 자식이 막히지 않게 한다 */
function capture(stream: NodeJS.ReadableStream, limit: number): () => Captured {
  const parts: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  stream.on("data", (chunk: unknown) => {
    const bytes = bytesOf(chunk);
    if (bytes === undefined) return;
    const room = limit - size;
    if (bytes.byteLength > room) {
      if (room > 0) parts.push(bytes.subarray(0, room));
      size = limit;
      truncated = true;
      return;
    }
    parts.push(bytes);
    size += bytes.byteLength;
  });
  return () => ({ text: decodeAll(parts, size), truncated });
}

function bytesOf(chunk: unknown): Uint8Array | undefined {
  if (typeof chunk === "string") return new TextEncoder().encode(chunk);
  return chunk instanceof Uint8Array ? chunk : undefined;
}

/** 모은 조각을 한 번에 UTF-8로 푼다. 상한에서 글자가 잘리면 대체 문자가 된다 */
function decodeAll(parts: readonly Uint8Array[], size: number): string {
  const all = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** 띄운 자식에게 표준 입력을 쓰고 닫은 뒤 끝날 때까지 기다린다. 기한이 지나면 트리를 죽인다 */
async function runChild(
  child: IsolatedChild,
  request: { readonly stdin: string; readonly timeoutMs: number },
  deps: Pick<ScriptRunnerDeps, "setTimer" | "logger">,
): Promise<ScriptRunResult> {
  const stdout = capture(child.stdout, SCRIPT_LIMITS.outputBytes);
  const stderr = capture(child.stderr, SCRIPT_LIMITS.outputBytes);
  let timedOut = false;
  const cancel = deps.setTimer(request.timeoutMs, () => {
    timedOut = true;
    child.kill("SIGKILL");
  });
  // 자식이 표준 입력을 읽기 전에 끝나면 쓰기가 실패한다. 그 오류는 자식의 결과로 보고 기록만 한다
  child.stdin.on("error", (cause: unknown) => {
    deps.logger?.debug("script.stdin_closed", { reason: messageOf(cause) });
  });
  child.stdin.end(request.stdin);
  const finished = await child.exited;
  cancel();
  const out = stdout();
  const errOut = stderr();
  return {
    exitCode: finished.code,
    signal: finished.signal,
    stdout: out.text,
    stdoutTruncated: out.truncated,
    stderr: errOut.text,
    stderrTruncated: errOut.truncated,
    timedOut,
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** 확장 하나의 스크립트 실행기를 만든다. 호출마다 선언과 위치와 승인을 검사하고, 통과하면 띄운다 */
export function createScriptRunner(deps: ScriptRunnerDeps): PluginScriptPort {
  const { target } = deps;
  return {
    async run(request) {
      const decl = target.scripts.find((entry) => entry.name === request.name);
      if (decl === undefined) return err({ kind: "script_not_declared" });
      const located = await locate(deps.fs, target.tree, decl.file);
      if (!located.ok) return err(located.error);
      if (!target.approved) return err({ kind: "script_not_approved" });
      if (request.replay) return err({ kind: "replay_mode_denied" });
      const runner = deps.resolveRunner(decl.runner);
      if (runner === undefined || !isAbsolute(runner)) {
        return err({
          kind: "spawn_failed",
          code: "runner_unavailable",
          message: `no absolute path is set for the ${decl.runner} runner`,
        });
      }
      const spec: IsolationSpawnSpec = {
        command: runner,
        args: [located.value, ...(decl.args ?? [])],
        readRoot: target.tree,
        env: envOf(decl.envNames ?? [], deps.allowedEnv),
        label: `script:${target.extension}:${decl.name}`,
      };
      const spawned = await deps.process.spawn(spec);
      if (!spawned.ok) return err(failureOfSpawn(spawned.error));
      const result = await runChild(
        spawned.value,
        {
          stdin: request.stdin,
          timeoutMs: decl.timeoutMs ?? SCRIPT_LIMITS.timeoutDefaultMs,
        },
        deps,
      );
      return ok(result);
    },
  };
}
