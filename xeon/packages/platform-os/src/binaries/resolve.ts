import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import {
  delimiter as hostDelimiter,
  isAbsolute,
  join,
  relative,
  resolve as resolvePath,
  sep,
} from "node:path";
import {
  assertNever,
  attemptAsync,
  Bug,
  err,
  ok,
  parseJson,
  type Logger,
  type Result,
} from "@xeon/contracts";
import type {
  BinaryError,
  BinaryName,
  OsInfo,
  ResolveBinaryOptions,
  ResolvedBinary,
} from "@xeon/contracts/services";
import type { RunCommand } from "../proc.ts";
import { compareTriples, findVersion, parseTriple, requireTriple } from "./semver.ts";

// 외부 바이너리 해석(OS-11, L0.os.spec §3.6). 순서: 번들 후보 > 시스템 후보 > not_found.
// 번들 추출(cache/bin, OS-12)과 @vscode/ripgrep 연결(rg.ts)은 M2 이후 또는 의존 연결 뒤에 더한다.

const BINARIES_LOCK_FILE = "binaries.lock.json";

/** 버전 옵션이 없어 확인을 건너뛰는 이름. minVersion을 줄 수 없다 */
const NO_VERSION_NAMES: ReadonlySet<BinaryName> = new Set(["security", "secret-tool"]);

/** --version이 아닌 옵션을 쓰는 이름. socat은 -V만 안다 [가정: socat 매뉴얼] */
function versionArgs(name: BinaryName): readonly string[] {
  return name === "socat" ? ["-V"] : ["--version"];
}

export interface LockEntry {
  readonly name: string;
  readonly platform: string;
  readonly arch: string;
  /** resource 디렉터리 기준 상대 경로 */
  readonly path: string;
  readonly sha256: string;
  readonly version: string;
}

export type LockParseError = { readonly kind: "lock_invalid" };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lockEntry(value: unknown): LockEntry | undefined {
  if (!isRecord(value)) return undefined;
  const { name, platform, arch, path, sha256, version } = value;
  if (
    typeof name !== "string" ||
    typeof platform !== "string" ||
    typeof arch !== "string" ||
    typeof path !== "string" ||
    typeof sha256 !== "string" ||
    typeof version !== "string"
  ) {
    return undefined;
  }
  return { name, platform, arch, path, sha256, version };
}

/** binaries.lock.json 본문을 읽는다. 모양: { "binaries": [ { name, platform, arch, path, sha256, version } ] } */
export function parseBinariesLock(text: string): Result<readonly LockEntry[], LockParseError> {
  const decoded = parseJson(text);
  if (!decoded.ok) return err({ kind: "lock_invalid" });
  const json = decoded.value;
  if (!isRecord(json)) return err({ kind: "lock_invalid" });
  const list = json["binaries"];
  if (!Array.isArray(list)) return err({ kind: "lock_invalid" });
  const items: readonly unknown[] = list;
  const entries: LockEntry[] = [];
  for (const item of items) {
    const entry = lockEntry(item);
    if (entry === undefined) return err({ kind: "lock_invalid" });
    entries.push(entry);
  }
  return ok(entries);
}

export interface BinaryFs {
  readFile(path: string): Promise<Result<Uint8Array, { readonly code: string }>>;
  /** 실행 가능한 일반 파일이면 true */
  isExecutableFile(path: string): Promise<boolean>;
}

function errorCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

export function createNodeBinaryFs(): BinaryFs {
  return {
    async readFile(path) {
      try {
        return ok(await readFile(path));
      } catch (caught) {
        return err({ code: errorCode(caught) });
      }
    },
    async isExecutableFile(path) {
      const st = await attemptAsync(() => stat(path));
      // 없거나 읽을 수 없는 경로는 실행 파일이 아니다
      if (!st.ok) return false;
      // 소유자, 그룹, 기타 중 하나라도 실행 비트가 있는 일반 파일
      return st.value.isFile() && (st.value.mode & 0o111) !== 0;
    },
  };
}

/** 소스 실행(`bun run`)에서 번들 바이너리 경로를 주는 수단. @vscode/ripgrep 연결이 이 자리에 들어온다 */
export interface BundledPath {
  readonly path: string;
  readonly version: string;
}
export type BundledSource = (
  name: BinaryName,
  signal: AbortSignal,
) => Promise<Result<BundledPath | undefined, BinaryError>>;

export interface BinaryResolverDeps {
  readonly info: OsInfo;
  /** 번들 목록 파일과 번들 바이너리가 있는 디렉터리 */
  readonly resourceDir: string;
  /** 환경 변수 PATH 값 */
  readonly pathEnv: string | undefined;
  readonly fs: BinaryFs;
  readonly run: RunCommand;
  readonly logger: Logger;
  /** 서비스 수명 신호. 끝나면 진행 중인 탐색의 자식 프로세스를 중단한다 */
  readonly lifetime: AbortSignal;
  readonly bundledSource?: BundledSource;
}

export type ResolveBinary = (
  name: BinaryName,
  opts: ResolveBinaryOptions,
  signal: AbortSignal,
) => Promise<Result<ResolvedBinary, BinaryError>>;

function installHint(name: BinaryName, info: OsInfo): string {
  const linux = info.platform === "linux";
  switch (name) {
    case "rg":
      return linux
        ? "ripgrep을 설치한다 (예: apt install ripgrep)"
        : "ripgrep을 설치한다 (예: brew install ripgrep)";
    case "sops":
      return "sops를 설치한다 (예: brew install sops, 또는 https://github.com/getsops/sops/releases)";
    case "age":
      return linux
        ? "age를 설치한다 (예: apt install age)"
        : "age를 설치한다 (예: brew install age)";
    case "git":
      return linux
        ? "git을 설치한다 (예: apt install git)"
        : "git을 설치한다 (예: brew install git)";
    case "bwrap":
      return linux
        ? "bubblewrap 패키지를 설치한다 (예: apt install bubblewrap)"
        : "bubblewrap은 Linux에서만 쓴다";
    case "socat":
      return linux
        ? "socat 패키지를 설치한다 (예: apt install socat)"
        : "socat을 설치한다 (예: brew install socat)";
    case "security":
      return "macOS 내장 /usr/bin/security를 찾지 못했다. 시스템 구성을 확인한다";
    case "secret-tool":
      return "libsecret-tools 패키지를 설치한다 (예: apt install libsecret-tools)";
    default:
      return assertNever(name, "BinaryName");
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function withCancel<T>(
  work: Promise<Result<T, BinaryError>>,
  signal: AbortSignal,
): Promise<Result<T, BinaryError>> {
  if (signal.aborted) return err({ kind: "cancelled" });
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<Result<never, BinaryError>>((resolve) => {
    onAbort = (): void => {
      resolve(err({ kind: "cancelled" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * resolveBinary를 만든다. 같은 이름·옵션의 동시 호출은 탐색 하나를 공유하고, 성공 결과는 서비스 수명 동안 캐시한다
 * (실패는 캐시하지 않는다: 사용자가 설치한 뒤 다시 물을 수 있게).
 */
export function createBinaryResolver(deps: BinaryResolverDeps): ResolveBinary {
  const cache = new Map<string, ResolvedBinary>();
  const inflight = new Map<string, Promise<Result<ResolvedBinary, BinaryError>>>();

  const resolveUncached = async (
    name: BinaryName,
    opts: ResolveBinaryOptions,
  ): Promise<Result<ResolvedBinary, BinaryError>> => {
    const bundled = await resolveBundled(deps, name, deps.lifetime);
    if (!bundled.ok) return bundled;
    if (bundled.value !== undefined) return ok(bundled.value);
    if (opts.allowSystem === false) {
      return err({
        kind: "not_found",
        name,
        searched: [join(deps.resourceDir, BINARIES_LOCK_FILE)],
        hint: installHint(name, deps.info),
      });
    }
    return resolveSystem(deps, name, opts, deps.lifetime);
  };

  return (name, opts, signal) => {
    if (NO_VERSION_NAMES.has(name) && opts.minVersion !== undefined) {
      throw new Bug(`${name} has no version option, so minVersion cannot be given`);
    }
    if (opts.minVersion !== undefined) requireTriple(opts.minVersion);
    if (signal.aborted) return Promise.resolve(err({ kind: "cancelled" }));
    const key = `${name}|${opts.minVersion ?? ""}|${String(opts.allowSystem ?? true)}`;
    const cached = cache.get(key);
    if (cached !== undefined) return Promise.resolve(ok(cached));
    let work = inflight.get(key);
    if (work === undefined) {
      const started = resolveUncached(name, opts).then((result) => {
        inflight.delete(key);
        if (result.ok) cache.set(key, result.value);
        return result;
      });
      inflight.set(key, started);
      work = started;
    }
    return withCancel(work, signal);
  };
}

async function resolveBundled(
  deps: BinaryResolverDeps,
  name: BinaryName,
  signal: AbortSignal,
): Promise<Result<ResolvedBinary | undefined, BinaryError>> {
  const lockPath = join(deps.resourceDir, BINARIES_LOCK_FILE);
  const lockBytes = await deps.fs.readFile(lockPath);
  if (lockBytes.ok) {
    const parsed = parseBinariesLock(new TextDecoder().decode(lockBytes.value));
    if (!parsed.ok) return err({ kind: "extract_failed", name, code: "LOCK_INVALID" });
    const entry = parsed.value.find(
      (e) => e.name === name && e.platform === deps.info.platform && e.arch === deps.info.arch,
    );
    if (entry !== undefined) return verifyLockEntry(deps, name, entry);
  } else if (lockBytes.error.code !== "ENOENT") {
    return err({ kind: "extract_failed", name, code: lockBytes.error.code });
  }
  if (deps.bundledSource === undefined) return ok(undefined);
  const sourced = await deps.bundledSource(name, signal);
  if (!sourced.ok) return sourced;
  if (sourced.value === undefined) return ok(undefined);
  // 소스 실행: 설치 때 npm 락파일 무결성 해시로 검증되므로 실행 시 해시 검사는 생략한다
  return ok({ name, path: sourced.value.path, version: sourced.value.version, source: "bundled" });
}

async function verifyLockEntry(
  deps: BinaryResolverDeps,
  name: BinaryName,
  entry: LockEntry,
): Promise<Result<ResolvedBinary, BinaryError>> {
  const root = resolvePath(deps.resourceDir);
  const full = resolvePath(root, entry.path);
  const rel = relative(root, full);
  if (isAbsolute(entry.path) || rel === "" || rel.startsWith(`..${sep}`) || rel === "..") {
    return err({ kind: "extract_failed", name, code: "LOCK_PATH_ESCAPES" });
  }
  const bytes = await deps.fs.readFile(full);
  if (!bytes.ok) return err({ kind: "extract_failed", name, code: bytes.error.code });
  const actual = sha256Hex(bytes.value);
  const expected = entry.sha256.toLowerCase();
  // 해시가 다르면 실행하지 않고 시스템 바이너리로 대체하지도 않는다(변조 신호를 숨기지 않는다)
  if (actual !== expected) return err({ kind: "integrity_mismatch", name, expected, actual });
  if (!(await deps.fs.isExecutableFile(full))) {
    return err({ kind: "extract_failed", name, code: "EACCES" });
  }
  return ok({ name, path: full, version: entry.version, source: "bundled" });
}

async function resolveSystem(
  deps: BinaryResolverDeps,
  name: BinaryName,
  opts: ResolveBinaryOptions,
  signal: AbortSignal,
): Promise<Result<ResolvedBinary, BinaryError>> {
  const windows = deps.info.platform === "win32";
  const delimiter = windows ? ";" : hostDelimiter;
  const fileName = windows ? `${name}.exe` : name;
  const dirs = (deps.pathEnv ?? "").split(delimiter).filter((dir) => dir !== "" && isAbsolute(dir));
  // PATH 순서를 지키되 확인은 한꺼번에 한다
  const hits = await Promise.all(dirs.map((dir) => deps.fs.isExecutableFile(join(dir, fileName))));
  const index = hits.findIndex((hit) => hit);
  const dir = dirs[index];
  if (index < 0 || dir === undefined) {
    return err({ kind: "not_found", name, searched: dirs, hint: installHint(name, deps.info) });
  }
  const path = join(dir, fileName);
  if (NO_VERSION_NAMES.has(name)) return ok({ name, path, version: "", source: "system" });

  const out = await deps.run([path, ...versionArgs(name)], { signal });
  if (!out.ok) {
    if (out.error.kind === "cancelled") return err({ kind: "cancelled" });
    return err({ kind: "version_unreadable", name, path });
  }
  const version = out.value.exitCode === 0 ? firstVersion(out.value.stdout) : undefined;
  if (version === undefined) return err({ kind: "version_unreadable", name, path });
  if (opts.minVersion !== undefined) {
    const found = parseTriple(version);
    const required = requireTriple(opts.minVersion);
    if (found !== undefined && compareTriples(found, required) < 0) {
      return err({ kind: "version_too_old", name, found: version, required: opts.minVersion });
    }
  }
  return ok({ name, path, version, source: "system" });
}

/** 출력 앞쪽 몇 줄에서 처음 나오는 버전을 읽는다(대부분 첫 줄. socat은 둘째 줄) */
function firstVersion(stdout: string): string | undefined {
  const lines = stdout.split("\n").slice(0, 5);
  for (const line of lines) {
    const found = findVersion(line);
    if (found !== undefined) return found;
  }
  return undefined;
}
