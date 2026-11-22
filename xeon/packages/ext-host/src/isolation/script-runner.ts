// 매니페스트 `scripts`의 스크립트를 실행하는 실행기(설계 B, F.extensions.spec §3.1.4, drive-isolation §3.4). 엔진(X)이 구현한다.
// 검사 순서는 계약(plugin-script.ts의 `PluginScriptPort`)이 정한 대로다: 선언 → 위치(렉시컬과 실제 위치가 확장 폴더 안) →
// 일반 파일 → 승인 → 돌려 보기 플래그 → 띄우기. 띄우는 것은 주입된 `IsolationProcessPort.spawn`뿐이다. 정책은 호출이 고른다
// [결정: 2026-11-21, 사용자, AGE-63]: 승인된 플러그인과 설정을 끈 승인 전 드래프트는 열린 정책(셸 도구와 같이 읽고 쓰고, 막는 것은 보호 셋뿐)이다.
// 설정 `narrowDrafts`를 켠 승인 전 드래프트만 `narrow`(쓰기 없음, 자기 폴더 읽기)로 돈다. 기한이 지나면 프로세스 트리를 죽이고 `timedOut`으로 답한다.
// 기동 실패와 샌드박스 없음은 결과 값이다. 초안(승인되지 않은 버전)은 승인 문(`draftGate`)이 호출마다 카드를 열어 승인한 호출만 띄운다(테스트 런에서만, AGE-58). 승인 카드를 재사용하는 길은 없다.
import { attemptAsync, err, ok, type Logger, type Result } from "@fresnel/contracts";
import {
  isEntryInsideRoot,
  SCRIPT_CARD_PREVIEW_CHARS,
  SCRIPT_ENV_SANDBOXED_USES,
  SCRIPT_ENV_USES,
  SCRIPT_LIMITS,
  SCRIPT_NARROW_USES,
  SCRIPT_USES,
  type HookProcessPort,
  type IsolatedChild,
  type IsolationProcessPort,
  type IsolationSpawnError,
  type IsolationSpawnSpec,
  type LoaderFs,
  type ManifestScriptDecl,
  type PluginScriptPort,
  type ScriptEnvDecl,
  type ScriptEnvGrant,
  type ScriptCard,
  type ScriptDraftGate,
  type ScriptRunFailure,
  type ScriptRunner,
  type ScriptRunResult,
} from "@fresnel/contracts/extensions";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { BASE_ENV_PASS_NAMES, SENSITIVE_ENV_PATTERNS } from "@fresnel/contracts/services";
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
  /**
   * 환경 모드 선언(`ManifestScriptDecl.env`)을 받아들여도 되는가의 호스트 기록(AGE-58 [제안]). 매니페스트의 `env`는 선언일 뿐이고, 이 값이 `granted: true`일 때만
   * 환경 모드로 돈다. 없거나 거짓이면 `script_env_not_granted`다(좁은 모드로 바꿔 돌리지 않는다). 호스트가 승인한 검토본의 기록(출처가 마이그레이션)에서만 만든다
   */
  readonly envGrant?: ScriptEnvGrant;
}

/** 참조 파일 하나의 겉모습. 지문을 매번 다시 내지 않으려고 크기와 수정 시각으로 먼저 거른다 */
export interface ScriptRefStat {
  readonly size: number;
  readonly mtimeMs: number;
}

/** 환경 모드의 참조 파일을 보는 수단. 호스트가 파일 시스템으로 구현한다(L4). 읽지 못하면 `unreadable`이다 */
export interface ScriptRefReader {
  /** 없으면 ok(null) */
  stat(path: string): Promise<Result<ScriptRefStat | null, { readonly kind: "unreadable" }>>;
  /** 내용의 `sha256:<hex>` */
  sha256(path: string): Promise<Result<string, { readonly kind: "unreadable" }>>;
}

/** 환경 모드 자식에게 주는, 원래 하네스가 채워 주던 변수 이름(프로젝트 폴더) */
const SCRIPT_ENV_PROJECT_DIR = "CLAUDE_PROJECT_DIR";

/** 환경 모드 자식에게서 빼는 Fresnel 자신의 내부 값의 이름 패턴(`FRESNEL_*`, 대소문자 무시). 사용자의 변수는 넘긴다 [결정: 2026-11-20, 사용자, AGE-58] */
const INTERNAL_ENV: readonly RegExp[] = [/^_*FRESNEL_/i];

/** 실패한 환경 모드 훅의 표준 오류 끝부분 글자 수(기록용, 가림 규칙을 지난다). 모은 표준 오류(처음 64 KiB)의 끝이다 */
const ENV_STDERR_TAIL_CHARS = 512;

const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ScriptRunnerDeps {
  /** 띄우기 포트. 샌드박스 프로필은 이 포트가 정한다 */
  readonly process: IsolationProcessPort;
  /**
   * 환경 모드(기본)가 쓰는 외부 훅 실행 포트(프로세스 트리 정리, 시간 제한, 표준 입출력 상한). 샌드박스 없이 사용자 권한으로 돈다.
   * 없으면 환경 모드는 `spawn_failed`(`hook_process_unavailable`)다
   */
  readonly hookProcess?: () => HookProcessPort | undefined;
  /** 참이면 환경 모드를 옛 길(`script-env` 샌드박스 프로필: 보호 경로 읽기 거부, 프로젝트 쓰기만)로 돌린다. 설정 `l0.sandbox.sandboxImportedHooks`, 기본 끔. 호출마다 부른다 */
  readonly envSandboxed?: () => boolean;
  /** 폴더와 실제 위치와 파일 종류를 보는 포트(확장 로더와 같다) */
  readonly fs: LoaderFs;
  readonly target: ScriptTarget;
  /** 실행기 이름을 절대 경로로 푼다. 없으면 `runner_unavailable`이다(조립 루트가 준다) */
  readonly resolveRunner: (name: ScriptRunner) => string | undefined;
  /** 실행기가 시작하는 데 읽어야 하는 경로(읽기 전용, `python3`의 설치 폴더 등). 없으면 실행 파일 말고는 더 열지 않는다 */
  readonly runnerReadRoots?: (name: ScriptRunner, command: string) => readonly string[];
  /**
   * 허용 목록에 든 환경 값. 선언된 `envNames` 가운데 여기 있는 것을 `spec.env`로 싣는다. 어느 정책이든 허용 목록 env가 자식 env의 전부다
   * [결정: 2026-11-22, 사용자, AGE-63]
   */
  readonly allowedEnv: Readonly<Record<string, string>>;
  /** 기한과 정리 시계. 취소 함수를 돌려준다(격리의 다른 시계와 같은 모양이다) */
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  /** 표준 입력 쓰기 오류(자식이 먼저 끝남)를 기록한다. 없으면 버린다 */
  readonly logger?: Logger;
  /**
   * 초안(`target.approved`가 거짓)의 스크립트 승인 문(AGE-58 [제안]). 없으면 초안 스크립트는 `script_not_approved`다.
   * 있으면 호출한 대화(`request.threadId`)가 있을 때만 카드를 열 수 있고, 승인한 호출만 띄운다
   */
  readonly draftGate?: ScriptDraftGate;
  /** 이 기기에서 격리할 수 있는가. 거짓이면 카드를 열지 않고 거절한다(카드를 승인해도 띄우지 못하는 것을 막는다) */
  readonly sandboxAvailable?: () => boolean;
  /**
   * 참이면 승인 전 드래프트(`target.approved`가 거짓)의 스크립트(환경 모드 아님)를 좁은 길(`narrow`: 쓰기 없음, 자기 폴더 읽기)로 돌린다.
   * 설정 `l0.sandbox.narrowDrafts`(기본 끔) [결정: 2026-11-21, 사용자, AGE-63]. 호출마다 부른다. 승인된 스크립트와 환경 모드 스크립트는 이 값을 보지 않는다
   */
  readonly narrowDrafts?: () => boolean;
  /** 표준 입력 미리보기를 카드에 싣기 전에 가린다(엔진의 시크릿 마스킹). 없으면 미리보기를 싣지 않는다 */
  readonly maskText?: (text: string) => string;
  /**
   * 환경 모드의 사용자 환경(PATH와 환경 변수). 호출마다 부른다(조립 루트가 한 번 얻어 캐시한다). 기본 길은 Fresnel 내부 값(`FRESNEL_*`)과 잘못된 이름만 뺀다(사용자의 `*_TOKEN` 등은 넘긴다). 샌드박스 설정을 켠 옛 길은 시크릿 거부 패턴(`SENSITIVE_ENV_PATTERNS`)에 걸리는 이름도 뺀다. 없으면 환경 모드는 `spawn_failed`(`user_env_unavailable`)다. 값은 기록하지 않는다
   */
  readonly userEnv?: () => Promise<Readonly<Record<string, string>>>;
  /** 환경 모드 참조 파일의 지문 확인 수단. 없으면 지문이 있는 참조가 하나라도 있는 환경 모드는 `script_ref_changed(unreadable)`다. 지문이 없는(null) 참조는 확인하지 않는다 */
  readonly refs?: ScriptRefReader;
  /** 참조 파일(절대 경로) 가운데 보호 경로 안에 있어 읽기 예외가 필요한 것의 예외 경로(파일 또는 폴더)를 정한다. 조립 루트가 샌드박스의 보호 경로 표로 만든다. 없으면 예외 없음 */
  readonly readCarveOutsFor?: (refPaths: readonly string[]) => readonly string[];
  /**
   * 호출한 대화의 프로젝트 폴더(절대 경로). 환경 모드의 작업 폴더, 쓰기 루트, `CLAUDE_PROJECT_DIR`이 된다. 대화 폴더가 없으면 undefined이고
   * 그때는 `envGrant.projectDir`을 쓴다. 둘 다 없으면 `script_env_not_granted`다
   */
  readonly projectDirOf?: (threadId: ThreadId | undefined) => string | undefined;
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

/**
 * 선언된 환경 변수 이름이 자식에게 실제로 넘어가는지 이름만으로 가른다(값은 보지 않는다). 시크릿 거부 패턴에 걸리지 않고 허용 목록(`BASE_ENV_PASS_NAMES`)에 든 이름만
 * `passed`이고, 나머지(예: `FETCH_API_KEY`)는 선언해도 받지 못하는 `ignored`다. 검토 카드가 이것으로 "선언했지만 받지 못한다"를 알린다 [결정: 2026-11-22, 사용자, AGE-63]
 */
export function scriptEnvNamesOf(declared: readonly string[]): {
  readonly passed: readonly string[];
  readonly ignored: readonly string[];
} {
  const passed: string[] = [];
  const ignored: string[] = [];
  for (const name of declared) {
    (!isSensitiveEnvName(name) && BASE_ENV_PASS_NAMES.includes(name) ? passed : ignored).push(name);
  }
  return { passed, ignored };
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
  request: { readonly stdin: string; readonly timeoutMs: number; readonly signal?: AbortSignal },
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
  // 호출이 중단되면(카드가 끝난 뒤 대화가 멈춤 등) 프로세스 트리를 죽인다
  const onAbort = (): void => {
    child.kill("SIGKILL");
  };
  if (request.signal?.aborted === true) onAbort();
  request.signal?.addEventListener("abort", onAbort, { once: true });
  child.stdin.end(request.stdin);
  const finished = await child.exited;
  request.signal?.removeEventListener("abort", onAbort);
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

/** 표준 입력 미리보기. 앞 `SCRIPT_CARD_PREVIEW_CHARS`자만 가림 규칙을 지난 값으로 싣는다. 가림 수단이 없으면 싣지 않는다 */
function previewOf(stdin: string, mask: ScriptRunnerDeps["maskText"]): string {
  if (mask === undefined) return "";
  const head = Array.from(stdin).slice(0, SCRIPT_CARD_PREVIEW_CHARS).join("");
  return mask(head);
}

/** 사용자 환경에서 Fresnel 내부 값(`FRESNEL_*`)과 잘못된 이름만 뺀다. 이름만 거른다(값은 보지 않는다). 사용자의 `*_TOKEN`, `AWS_*`, `SSH_AUTH_SOCK` 등은 넘긴다 */
function userEnvOfDefault(source: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (!ENV_VAR_NAME.test(name) || INTERNAL_ENV.some((pattern) => pattern.test(name))) continue;
    env[name] = value;
  }
  return env;
}

/** 샌드박스 안에서 돌릴 때(설정을 켠 옛 길): 사용자 환경에서 시크릿 거부 패턴과 잘못된 이름을 뺀다. 이름만 거른다(값은 보지 않는다) */
function userEnvOf(source: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (!ENV_VAR_NAME.test(name) || isSensitiveEnvName(name)) continue;
    env[name] = value;
  }
  return env;
}

/** 참조 파일의 크기·수정 시각·지문 확인 결과의 기억. 같은 파일과 같은 겉모습이면 지문을 다시 내지 않는다 */
interface RefMemo {
  readonly size: number;
  readonly mtimeMs: number;
  readonly hash: string;
}

/** 확장 하나의 스크립트 실행기를 만든다. 호출마다 선언과 위치와 승인을 검사하고, 통과하면 띄운다 */
export function createScriptRunner(deps: ScriptRunnerDeps): PluginScriptPort {
  const { target } = deps;
  const refMemo = new Map<string, RefMemo>();

  /** 참조 하나가 가져올 때와 같은가. 다르면 실패 값이다 */
  async function checkRef(
    ref: ScriptEnvDecl["refs"][number],
  ): Promise<ScriptRunFailure | undefined> {
    const expected = ref.hash;
    // 가져올 때 지문을 못 낸(null) 참조는 확인하지 않고 돈다 [결정: 2026-11-20, 사용자, AGE-58 "허용 중심"]
    if (expected === null) return undefined;
    const reader = deps.refs;
    const failure = (reason: "changed" | "missing" | "unreadable"): ScriptRunFailure => ({
      kind: "script_ref_changed",
      path: ref.path,
      reason,
    });
    if (reader === undefined) return failure("unreadable");
    const stated = await attemptAsync(() => reader.stat(ref.path));
    if (!stated.ok || !stated.value.ok) return failure("unreadable");
    const seen = stated.value;
    if (seen.value === null) return failure("missing");
    const memo = refMemo.get(ref.path);
    if (
      memo !== undefined &&
      memo.size === seen.value.size &&
      memo.mtimeMs === seen.value.mtimeMs &&
      memo.hash === expected
    ) {
      return undefined;
    }
    const hashed = await attemptAsync(() => reader.sha256(ref.path));
    if (!hashed.ok || !hashed.value.ok) return failure("unreadable");
    const hash = hashed.value;
    if (hash.value !== expected) return failure("changed");
    refMemo.set(ref.path, { size: seen.value.size, mtimeMs: seen.value.mtimeMs, hash: hash.value });
    return undefined;
  }

  /** 지문이 있는 참조마다 지금 파일이 가져올 때와 같은지 본다. 목록 순서의 첫 실패를 돌려준다 */
  async function checkRefs(env: ScriptEnvDecl): Promise<ScriptRunFailure | undefined> {
    const results = await Promise.all(env.refs.map((ref) => checkRef(ref)));
    return results.find((result) => result !== undefined);
  }

  /** 환경 모드(가져온 훅): 원래 명령 문자열을 `shell -c`로, 프로젝트 폴더에서, 사용자 환경으로 돌린다. 자격은 호스트 기록(`envGrant`)이 정한다 */
  async function runEnv(
    decl: ManifestScriptDecl,
    env: ScriptEnvDecl,
    request: Parameters<PluginScriptPort["run"]>[0],
  ): Promise<Result<ScriptRunResult, ScriptRunFailure>> {
    const grant = target.envGrant;
    // 자격: 검토된 버전이고 호스트가 마이그레이션 출처로 승인한 기록이 있고 프로젝트 폴더가 있을 때만. 초안과 손으로 만든 선언은 좁은 모드로 바꾸지 않고 거절한다
    if (!target.approved || grant === undefined || !grant.granted) {
      return err({ kind: "script_env_not_granted" });
    }
    const projectDir = deps.projectDirOf?.(request.threadId) ?? grant.projectDir;
    if (projectDir === null || !isAbsolute(projectDir)) {
      return err({ kind: "script_env_not_granted" });
    }
    // 명령 원문을 담은 동반 파일이 플러그인 폴더 안에 있어야 한다(내용 해시에 든다)
    const companion = await locate(deps.fs, target.tree, decl.file);
    if (!companion.ok) return err(companion.error);
    if (request.replay) return err({ kind: "replay_mode_denied" });
    const sandboxed = deps.envSandboxed?.() === true;
    if (sandboxed && deps.sandboxAvailable?.() === false) {
      return err({ kind: "sandbox_unavailable", reason: "sandbox_off" });
    }
    const resolved = deps.resolveRunner(env.shell);
    const shell = resolved !== undefined && isAbsolute(resolved) ? resolved : `/bin/${env.shell}`;
    const userEnvSource = deps.userEnv;
    if (userEnvSource === undefined) {
      return err({
        kind: "spawn_failed",
        code: "user_env_unavailable",
        message: "the user environment is not available",
      });
    }
    const changed = await checkRefs(env);
    if (changed !== undefined) return err(changed);
    const loaded = await attemptAsync(() => userEnvSource());
    if (!loaded.ok) {
      return err({
        kind: "spawn_failed",
        code: "user_env_unavailable",
        message: "the user environment could not be read",
      });
    }
    const timeoutMs = decl.timeoutMs ?? SCRIPT_LIMITS.timeoutDefaultMs;
    let result: ScriptRunResult;
    if (sandboxed) {
      // 설정을 켠 옛 길: 샌드박스 안에서 돈다(보호 경로 읽기 거부, 프로젝트와 훅 임시 폴더에만 쓰기, 도구와 Mach 서비스 막기)
      const userEnv = userEnvOf(loaded.value);
      const refPaths = env.refs.map((ref) => ref.path);
      const carveOuts = deps.readCarveOutsFor?.(refPaths) ?? [];
      const spec: IsolationSpawnSpec = {
        command: shell,
        args: ["-c", env.command],
        readRoot: projectDir,
        systemTools: true,
        scriptEnv: { projectDir, readCarveOuts: carveOuts },
        env: { ...userEnv, [SCRIPT_ENV_PROJECT_DIR]: projectDir },
        label: `script:${target.extension}:${decl.name}`,
      };
      const spawned = await deps.process.spawn(spec);
      if (!spawned.ok) return err(failureOfSpawn(spawned.error));
      result = await runChild(spawned.value, { stdin: request.stdin, timeoutMs }, deps);
    } else {
      // 기본 길: 다른 하네스들처럼 사용자 권한 그대로, 샌드박스 없이 돈다. 프로세스 트리 정리, 시간 제한, 출력 상한은 외부 훅 실행 포트가 맡는다
      const hooks = deps.hookProcess?.();
      if (hooks === undefined) {
        return err({
          kind: "spawn_failed",
          code: "hook_process_unavailable",
          message: "the hook process port is not available",
        });
      }
      const raw = await hooks.run({
        argv: [shell, "-c", env.command],
        cwd: projectDir,
        env: { ...userEnvOfDefault(loaded.value), [SCRIPT_ENV_PROJECT_DIR]: projectDir },
        stdin: request.stdin,
        maxStdoutChars: SCRIPT_LIMITS.outputBytes,
        maxStderrChars: SCRIPT_LIMITS.outputBytes,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (raw.spawnError !== undefined) {
        return err({
          kind: "spawn_failed",
          code: raw.spawnError,
          message: "the hook command could not be started",
        });
      }
      result = {
        exitCode: raw.exitCode,
        signal: raw.signal,
        stdout: raw.stdout,
        stdoutTruncated: raw.stdoutTruncated,
        stderr: raw.stderr,
        stderrTruncated: raw.stderr.length >= SCRIPT_LIMITS.outputBytes,
        timedOut: raw.timedOut,
      };
    }
    // 막지 않는 오류(종료 코드 2가 아닌 비정상 종료, 기한, 신호)는 원래 하네스처럼 진행하되 표준 오류의 끝부분을 기록에 남긴다. 값은 가림 규칙을 지난다
    if (
      result.timedOut ||
      result.exitCode === null ||
      (result.exitCode !== 0 && result.exitCode !== 2)
    ) {
      const tail = result.stderr.slice(-ENV_STDERR_TAIL_CHARS);
      deps.logger?.warn("script.env_failed", {
        extension: target.extension,
        script: decl.name,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stderrTail: deps.maskText === undefined ? "" : deps.maskText(tail),
        uses: (sandboxed ? SCRIPT_ENV_SANDBOXED_USES : SCRIPT_ENV_USES).join(","),
      });
    }
    return ok(result);
  }

  return {
    async run(request) {
      const decl = target.scripts.find((entry) => entry.name === request.name);
      if (decl === undefined) return err({ kind: "script_not_declared" });
      if (decl.env !== undefined) return runEnv(decl, decl.env, request);
      const located = await locate(deps.fs, target.tree, decl.file);
      if (!located.ok) return err(located.error);
      // 초안은 승인 문이 있고 호출한 대화가 있을 때만 카드로 열 수 있다. 그 밖에는 띄우지 않는다
      const gate = target.approved ? undefined : deps.draftGate;
      if (!target.approved && (gate === undefined || request.threadId === undefined)) {
        return err({ kind: "script_not_approved" });
      }
      if (request.replay) return err({ kind: "replay_mode_denied" });
      const runner = deps.resolveRunner(decl.runner);
      if (runner === undefined || !isAbsolute(runner)) {
        return err({
          kind: "spawn_failed",
          code: "runner_unavailable",
          message: `no absolute path is set for the ${decl.runner} runner`,
        });
      }
      // 승인 전 드래프트만, 설정을 켰을 때 좁은 길이다. 승인된 스크립트는 열린 정책으로 돈다 [결정: 2026-11-21, 사용자, AGE-63]
      const narrow = !target.approved && deps.narrowDrafts?.() === true;
      const runtimeReadRoots = deps.runnerReadRoots?.(decl.runner, runner) ?? [];
      const spec: IsolationSpawnSpec = {
        command: runner,
        args: [located.value, ...(decl.args ?? [])],
        readRoot: target.tree,
        // 읽기 허용 목록과 시스템 도구 경로는 좁은 길에서만 쓰인다. 열린 정책은 읽기가 열려 있어 이 값을 무시한다
        ...(runtimeReadRoots.length === 0 ? {} : { runtimeReadRoots }),
        systemTools: true,
        ...(narrow ? { narrow: true } : {}),
        // `python3`는 설치 폴더가 읽기 전용이라 `__pycache__`를 쓰지 못한다. 쓰려다 실패하지 않게 막는다
        env: {
          ...envOf(decl.envNames ?? [], deps.allowedEnv),
          ...(decl.runner === "python3" ? { PYTHONDONTWRITEBYTECODE: "1" } : {}),
        },
        label: `script:${target.extension}:${decl.name}`,
      };
      const launch = async (
        signal?: AbortSignal,
      ): Promise<Result<ScriptRunResult, ScriptRunFailure>> => {
        const spawned = await deps.process.spawn(spec);
        if (!spawned.ok) return err(failureOfSpawn(spawned.error));
        const result = await runChild(
          spawned.value,
          {
            stdin: request.stdin,
            timeoutMs: decl.timeoutMs ?? SCRIPT_LIMITS.timeoutDefaultMs,
            ...(signal === undefined ? {} : { signal }),
          },
          deps,
        );
        return ok(result);
      };
      if (gate === undefined || request.threadId === undefined) return launch();
      // 초안: 격리할 수 없으면 카드를 열지 않고 거절한다
      if (deps.sandboxAvailable?.() === false) {
        return err({ kind: "sandbox_unavailable", reason: "sandbox_off" });
      }
      // 선언했지만 넘기지 않은 이름은 카드가 따로 알린다(AGE-33 enDep 11). 넘긴 이름은 `envNames`다
      const passedNames = new Set(Object.keys(spec.env));
      const envNotPassed = [...new Set(decl.envNames ?? [])].filter(
        (name) => !passedNames.has(name),
      );
      const card: ScriptCard = {
        command: spec.command,
        args: spec.args,
        envNames: Object.keys(spec.env),
        ...(envNotPassed.length === 0 ? {} : { envNotPassed }),
        stdinBytes: new TextEncoder().encode(request.stdin).byteLength,
        stdinPreview: previewOf(request.stdin, deps.maskText),
        uses: narrow ? SCRIPT_NARROW_USES : SCRIPT_USES,
      };
      return gate({
        extension: target.extension,
        registration: request.registration,
        threadId: request.threadId,
        name: decl.name,
        card,
        run: (signal) => launch(signal),
      });
    },
  };
}
