import { mkdir, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";
import { err, ok, type Result } from "@xeon/contracts";
import type { DirsError, OsDirs, OsInfo } from "@xeon/contracts/services";

export interface EnvReader {
  get(name: string): string | undefined;
}

export interface DirsInput {
  readonly info: OsInfo;
  readonly env: EnvReader;
  /** os.homedir() */
  readonly home: string;
  /** os.tmpdir() */
  readonly systemTmp: string;
  /** process.getuid?.(). Windows는 undefined */
  readonly uid: number | undefined;
  /** L4가 플러그인 설정으로 넘긴다 */
  readonly resourceDir: string;
  /** runtime 대체 후보 /tmp/xeon-<uid>의 /tmp. 기본 "/tmp". 길이 규칙의 마지막 후보를 시험하려고 둔다 */
  readonly sharedTmp?: string;
  /** 설정 키 l0.os.dirs.override(관리 범위) 값. XEON_HOME보다 낮고 OS 기본값보다 높다 */
  readonly managedOverride?: string;
}

/** 소켓 파일 이름 여유(L0.process.spec §4.4.1 SOCKET_RELATIVE_PATH_MAX_BYTES) */
const SOCKET_RELATIVE_PATH_MAX_BYTES = 24;
/** 여유를 더한 runtime 경로 바이트 수의 상한. macOS sun_path 104, Linux 108에서 4를 뺀다 */
const RUNTIME_LIMIT_DARWIN = 100;
const RUNTIME_LIMIT_LINUX = 104;

const textEncoder = new TextEncoder();

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

interface BaseDirs {
  readonly data: string;
  readonly config: string;
  readonly cache: string;
  readonly state: string;
  /** 앞에서부터 길이 규칙을 만족하는 첫 후보를 쓴다 */
  readonly runtimeCandidates: readonly string[];
  readonly tmp: string;
}

/** 순수 함수. 파일 시스템을 건드리지 않는다. 플랫폼별 값은 L0.os.spec §3.2 표다 */
export function resolveDirs(input: DirsInput): Result<OsDirs, DirsError> {
  const { info } = input;
  const api = info.platform === "win32" ? win32 : posix;

  if (input.home === "") {
    return err({ kind: "env_missing", name: info.platform === "win32" ? "USERPROFILE" : "HOME" });
  }
  if (!api.isAbsolute(input.home)) {
    return err({ kind: "not_absolute", dir: "home", path: input.home });
  }
  if (!api.isAbsolute(input.resourceDir)) {
    return err({ kind: "not_absolute", dir: "resource", path: input.resourceDir });
  }

  const base = info.platform === "win32" ? win32Base(input) : unixBase(input);
  if (!base.ok) return base;

  const overrideRoot = nonEmpty(input.env.get("XEON_HOME")) ?? nonEmpty(input.managedOverride);
  let { data, config, cache, state } = base.value;
  let candidates = base.value.runtimeCandidates;
  if (overrideRoot !== undefined) {
    if (!api.isAbsolute(overrideRoot)) {
      return err({ kind: "not_absolute", dir: "data", path: overrideRoot });
    }
    data = api.join(overrideRoot, "data");
    config = api.join(overrideRoot, "config");
    cache = api.join(overrideRoot, "cache");
    state = api.join(overrideRoot, "state");
    // runtime이 길이 규칙을 넘으면 그 OS의 기본 runtime으로 내려간다
    candidates = [api.join(overrideRoot, "run"), ...candidates];
  }

  const runtime = pickRuntime(info, candidates);
  if (!runtime.ok) return runtime;

  if (info.isWsl) {
    // 순서: data, state, cache, runtime. config는 허용하고 경고만 남긴다(dirsWarnings)
    const checked: readonly (readonly [keyof OsDirs, string])[] = [
      ["data", data],
      ["state", state],
      ["cache", cache],
      ["runtime", runtime.value],
    ];
    for (const [dir, path] of checked) {
      if (path.startsWith("/mnt/")) return err({ kind: "data_dir_on_drvfs", dir, path });
    }
  }

  return ok({
    home: input.home,
    data,
    config,
    cache,
    state,
    runtime: runtime.value,
    resource: input.resourceDir,
    tmp: base.value.tmp,
  });
}

function unixBase(input: DirsInput): Result<BaseDirs, DirsError> {
  const { info, env, home, systemTmp, uid } = input;
  // 소유자 번호가 없으면 /tmp/xeon-<uid>와 tmp 경로를 정할 수 없다. Unix에서는 생기지 않는 값이다
  if (uid === undefined) return err({ kind: "env_missing", name: "uid" });
  const fallbackRuntime = posix.join(input.sharedTmp ?? "/tmp", `xeon-${uid}`);
  const tmp = posix.join(systemTmp, `xeon-${uid}`);

  if (info.platform === "darwin") {
    const appSupport = posix.join(home, "Library", "Application Support", "xeon");
    const envTmp = nonEmpty(env.get("TMPDIR"));
    const tmpBase = envTmp !== undefined && posix.isAbsolute(envTmp) ? envTmp : systemTmp;
    return ok({
      data: appSupport,
      config: posix.join(appSupport, "config"),
      cache: posix.join(home, "Library", "Caches", "xeon"),
      state: posix.join(appSupport, "state"),
      runtimeCandidates: [posix.join(tmpBase, "xeon"), fallbackRuntime],
      tmp,
    });
  }

  // linux(WSL 포함). XDG 변수가 상대 경로이면 규격대로 무시하고 기본값을 쓴다
  const xdg = (name: string, fallback: readonly string[]): string => {
    const value = nonEmpty(env.get(name));
    return value !== undefined && posix.isAbsolute(value)
      ? posix.join(value, "xeon")
      : posix.join(home, ...fallback, "xeon");
  };
  const xdgRuntime = nonEmpty(env.get("XDG_RUNTIME_DIR"));
  const runtimeCandidates =
    xdgRuntime !== undefined && posix.isAbsolute(xdgRuntime)
      ? [posix.join(xdgRuntime, "xeon"), fallbackRuntime]
      : [fallbackRuntime];
  return ok({
    data: xdg("XDG_DATA_HOME", [".local", "share"]),
    config: xdg("XDG_CONFIG_HOME", [".config"]),
    cache: xdg("XDG_CACHE_HOME", [".cache"]),
    state: xdg("XDG_STATE_HOME", [".local", "state"]),
    runtimeCandidates,
    tmp,
  });
}

function win32Base(input: DirsInput): Result<BaseDirs, DirsError> {
  const { env, systemTmp } = input;
  const local = nonEmpty(env.get("LOCALAPPDATA"));
  if (local === undefined) return err({ kind: "env_missing", name: "LOCALAPPDATA" });
  const roaming = nonEmpty(env.get("APPDATA"));
  if (roaming === undefined) return err({ kind: "env_missing", name: "APPDATA" });
  if (!win32.isAbsolute(local)) return err({ kind: "not_absolute", dir: "data", path: local });
  if (!win32.isAbsolute(roaming))
    return err({ kind: "not_absolute", dir: "config", path: roaming });
  const temp = nonEmpty(env.get("TEMP")) ?? systemTmp;
  return ok({
    data: win32.join(local, "xeon", "data"),
    config: win32.join(roaming, "xeon"),
    cache: win32.join(local, "xeon", "cache"),
    state: win32.join(local, "xeon", "state"),
    // Windows는 소켓 대신 등록 파일만 두므로 길이 규칙이 없다(pickRuntime이 win32를 통과시킨다)
    runtimeCandidates: [win32.join(local, "xeon", "run")],
    tmp: win32.join(temp, "xeon"),
  });
}

function pickRuntime(info: OsInfo, candidates: readonly string[]): Result<string, DirsError> {
  const first = candidates[0];
  if (first === undefined) return err({ kind: "env_missing", name: "XDG_RUNTIME_DIR" });
  if (info.platform === "win32") return ok(first);
  const limit = info.platform === "darwin" ? RUNTIME_LIMIT_DARWIN : RUNTIME_LIMIT_LINUX;
  let last = { path: first, bytes: 0 };
  for (const path of candidates) {
    const bytes = textEncoder.encode(path).length + SOCKET_RELATIVE_PATH_MAX_BYTES;
    if (bytes <= limit) return ok(path);
    last = { path, bytes };
  }
  return err({ kind: "runtime_path_too_long", path: last.path, bytes: last.bytes, limit });
}

/** 해석 결과가 일으키는 경고. 순수 함수가 로그를 남기지 못하므로 값으로 돌려준다 */
export type DirsWarning = { readonly kind: "config_on_drvfs"; readonly path: string };

/** WSL에서 config가 /mnt/ 아래이면 허용하되 경고한다(L0.os.spec §3.2) */
export function dirsWarnings(info: OsInfo, dirs: OsDirs): readonly DirsWarning[] {
  return info.isWsl && dirs.config.startsWith("/mnt/")
    ? [{ kind: "config_on_drvfs", path: dirs.config }]
    : [];
}

interface DirStat {
  readonly isDirectory: boolean;
  /** 파일 종류 비트를 포함한 st_mode. 권한 검사는 하위 9비트만 본다 */
  readonly mode: number;
  readonly uid: number;
}

interface DirFsError {
  readonly code: string;
}

export interface DirFs {
  /** 현재 프로세스 uid. undefined(Windows)이면 소유자와 권한 비트를 검사하지 않는다 */
  readonly uid: number | undefined;
  /** 없으면 ok(undefined) */
  stat(path: string): Promise<Result<DirStat | undefined, DirFsError>>;
  /** 상위 디렉터리를 포함해 만든다. 이미 있으면 ok */
  mkdir(path: string, mode: number): Promise<Result<void, DirFsError>>;
}

function errorCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

/** node:fs 기반 DirFs. uid는 조립 루트가 process.getuid?.()로 넘긴다 */
export function createNodeDirFs(uid: number | undefined): DirFs {
  return {
    uid,
    async stat(path: string): Promise<Result<DirStat | undefined, DirFsError>> {
      try {
        const st = await stat(path);
        return ok({ isDirectory: st.isDirectory(), mode: st.mode, uid: st.uid });
      } catch (caught) {
        const code = errorCode(caught);
        return code === "ENOENT" ? ok(undefined) : err({ code });
      }
    },
    async mkdir(path: string, mode: number): Promise<Result<void, DirFsError>> {
      try {
        await mkdir(path, { recursive: true, mode });
        return ok(undefined);
      } catch (caught) {
        return err({ code: errorCode(caught) });
      }
    },
  };
}

const DIR_MODE = 0o700;
const GROUP_OTHER_BITS = 0o077;

/**
 * data, config, cache, state, runtime, tmp를 0o700으로 만들고(이미 있으면 소유자와 권한을 확인하고) 끝낸다.
 * home과 resource는 만들지도 검사하지도 않는다. 권한이 열려 있어도 고치지 않고 실패한다(L0.os.spec §5).
 * DirsError에 cancelled가 없어 중단은 io(code "ABORT_ERR")로 돌려준다.
 */
export function ensureDirs(
  dirs: OsDirs,
  fs: DirFs,
  signal: AbortSignal,
): Promise<Result<void, DirsError>> {
  const targets = [dirs.data, dirs.config, dirs.cache, dirs.state, dirs.runtime, dirs.tmp];
  // 상위 디렉터리를 먼저 만들어야 하므로 순서대로 하나씩 처리한다
  const run = async (index: number): Promise<Result<void, DirsError>> => {
    const path = targets[index];
    if (path === undefined) return ok(undefined);
    if (signal.aborted) return err({ kind: "io", path, code: "ABORT_ERR" });
    const checked = await ensureOne(path, fs);
    if (!checked.ok) return checked;
    return run(index + 1);
  };
  return run(0);
}

async function ensureOne(path: string, fs: DirFs): Promise<Result<void, DirsError>> {
  let found = await fs.stat(path);
  if (!found.ok) return err({ kind: "io", path, code: found.error.code });
  if (found.value === undefined) {
    const made = await fs.mkdir(path, DIR_MODE);
    if (!made.ok) return err({ kind: "io", path, code: made.error.code });
    found = await fs.stat(path);
    if (!found.ok) return err({ kind: "io", path, code: found.error.code });
    if (found.value === undefined) return err({ kind: "io", path, code: "ENOENT" });
  }
  const st = found.value;
  if (!st.isDirectory) return err({ kind: "io", path, code: "ENOTDIR" });
  if (fs.uid === undefined) return ok(undefined);
  if (st.uid !== fs.uid) return err({ kind: "not_owned", path });
  if ((st.mode & GROUP_OTHER_BITS) !== 0) {
    return err({ kind: "permission_too_open", path, mode: st.mode & 0o777 });
  }
  return ok(undefined);
}
