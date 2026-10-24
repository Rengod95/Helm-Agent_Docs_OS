import { statfs } from "node:fs/promises";
import { dirname } from "node:path";
import { assertNever, err, ok, type Result } from "@xeon/contracts";
import type { FsKind, FsKindError, OsInfo } from "@xeon/contracts/services";
import type { RunCommand } from "./proc.ts";

export interface FsProbe {
  /** Linux statfs f_type */
  readonly typeMagic: number | undefined;
  /** macOS f_fstypename (예: "apfs", "smbfs", "nfs") */
  readonly typeName: string | undefined;
  /** 판정을 요청받은 원래 경로. WSL의 /mnt/<문자>/ 판정에 쓴다 */
  readonly path?: string;
}

export interface FsKindProvider {
  /** 경로가 속한 파일 시스템의 원시 정보. 운영은 statfs와 mount 출력, 테스트는 표를 주입한다 */
  probe(path: string, signal: AbortSignal): Promise<Result<FsProbe, FsKindError>>;
}

// Linux statfs f_type 표(linux/magic.h)
const LOCAL_MAGICS: ReadonlySet<number> = new Set([
  0xef53, // ext2/3/4
  0x9123683e, // btrfs
  0x58465342, // xfs
  0x01021994, // tmpfs
  0x794c7630, // overlayfs
  0x2fc12fc1, // zfs
  0xf2f52010, // f2fs
  0x858458f6, // ramfs
]);
const NETWORK_MAGICS: ReadonlySet<number> = new Set([
  0x6969, // NFS
  0x517b, // SMB
  0xff534d42, // CIFS
  0xfe534d42, // SMB2
]);
const MAGIC_9P = 0x01021997;

const DARWIN_LOCAL: ReadonlySet<string> = new Set(["apfs", "hfs"]);
const DARWIN_NETWORK: ReadonlySet<string> = new Set(["nfs", "smbfs", "afpfs", "webdav"]);

const WSL_DRIVE_PATH = /^\/mnt\/[a-z](\/|$)/;

/** 순수 함수. 분류 표는 L0.os.spec §3.3 */
export function classifyFs(info: OsInfo, probe: FsProbe): FsKind {
  switch (info.platform) {
    case "linux": {
      if (info.isWsl) {
        if (probe.path !== undefined && WSL_DRIVE_PATH.test(probe.path)) return "drvfs";
        if (probe.typeMagic === MAGIC_9P) return "drvfs";
      }
      const magic = probe.typeMagic;
      if (magic === undefined) return "unknown";
      if (NETWORK_MAGICS.has(magic)) return "network";
      if (LOCAL_MAGICS.has(magic)) return "local";
      return "unknown";
    }
    case "darwin": {
      const name = probe.typeName?.toLowerCase();
      if (name === undefined) return "unknown";
      if (DARWIN_LOCAL.has(name)) return "local";
      if (DARWIN_NETWORK.has(name)) return "network";
      return "unknown";
    }
    case "win32":
      // Windows 판정 수단(드라이브 종류)은 2차다
      return "unknown";
    default:
      return assertNever(info.platform, "OsPlatform");
  }
}

function errorCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

/** Linux provider: node:fs statfs의 type(f_type). statfs가 지원되지 않으면 값 없이 돌려주어 unknown이 된다 */
export function createStatfsProvider(): FsKindProvider {
  return {
    async probe(path, signal) {
      if (signal.aborted) return err({ kind: "cancelled" });
      try {
        const result = await statfs(path);
        return ok({ typeMagic: result.type, typeName: undefined });
      } catch (caught) {
        const code = errorCode(caught);
        if (code === "ENOENT" || code === "ENOTDIR") return err({ kind: "not_found", path });
        if (code === "ERR_METHOD_NOT_IMPLEMENTED" || code === "ENOSYS") {
          return ok({ typeMagic: undefined, typeName: undefined });
        }
        return err({ kind: "io", path, code });
      }
    },
  };
}

export interface MountEntry {
  readonly mountPoint: string;
  readonly typeName: string;
}

/**
 * macOS `mount` 출력을 읽는다. 줄 모양: `<장치> on <마운트 지점> (<종류>, <옵션>...)`.
 * 모르는 줄은 건너뛴다(버전마다 출력이 다르다).
 */
export function parseMountOutput(text: string): readonly MountEntry[] {
  const entries: MountEntry[] = [];
  for (const line of text.split("\n")) {
    const open = line.lastIndexOf(" (");
    if (open < 0 || !line.endsWith(")")) continue;
    const head = line.slice(0, open);
    const onIndex = head.indexOf(" on ");
    if (onIndex < 0) continue;
    const mountPoint = head.slice(onIndex + 4);
    const typeName = (line.slice(open + 2, -1).split(",")[0] ?? "").trim();
    if (mountPoint === "" || typeName === "") continue;
    entries.push({ mountPoint, typeName });
  }
  return entries;
}

function underMount(path: string, mountPoint: string): boolean {
  if (mountPoint === "/") return true;
  return path === mountPoint || path.startsWith(`${mountPoint}/`);
}

/** macOS provider: `mount` 출력을 서비스 수명 동안 한 번 읽어 캐시하고 가장 긴 접두사 마운트 지점으로 고른다 */
export function createMountProvider(run: RunCommand): FsKindProvider {
  let table: Promise<Result<readonly MountEntry[], FsKindError>> | undefined;
  const load = async (
    path: string,
    signal: AbortSignal,
  ): Promise<Result<readonly MountEntry[], FsKindError>> => {
    const out = await run(["mount"], { signal });
    if (!out.ok) {
      return out.error.kind === "cancelled"
        ? err({ kind: "cancelled" })
        : err({ kind: "io", path, code: out.error.kind });
    }
    if (out.value.exitCode !== 0) return err({ kind: "io", path, code: "MOUNT_FAILED" });
    return ok(parseMountOutput(out.value.stdout));
  };
  const getTable = async (
    path: string,
    signal: AbortSignal,
  ): Promise<Result<readonly MountEntry[], FsKindError>> => {
    if (signal.aborted) return err({ kind: "cancelled" });
    table ??= load(path, signal);
    const entries = await table;
    if (entries.ok) return entries;
    // 실패는 캐시하지 않는다. 다른 호출자의 취소가 이 호출에 번졌으면 다시 읽는다
    table = undefined;
    return entries.error.kind === "cancelled" ? getTable(path, signal) : entries;
  };
  return {
    async probe(path, signal) {
      const entries = await getTable(path, signal);
      if (!entries.ok) return entries;
      let best: MountEntry | undefined;
      for (const entry of entries.value) {
        if (!underMount(path, entry.mountPoint)) continue;
        if (best === undefined || entry.mountPoint.length > best.mountPoint.length) best = entry;
      }
      return ok({ typeMagic: undefined, typeName: best?.typeName });
    },
  };
}

/** 판정 수단이 없는 환경(Windows 1차)용. 항상 unknown이 되는 빈 정보를 돌려준다 */
export function createNoopFsKindProvider(): FsKindProvider {
  return {
    probe(_path, signal) {
      return Promise.resolve(
        signal.aborted
          ? err({ kind: "cancelled" })
          : ok({ typeMagic: undefined, typeName: undefined }),
      );
    },
  };
}

/**
 * OsService.fsKind의 구현. 경로가 아직 없으면 가장 가까운 상위 디렉터리로 판정하고, 루트까지 없으면 not_found다.
 */
export function resolveFsKind(
  info: OsInfo,
  provider: FsKindProvider,
  path: string,
  signal: AbortSignal,
): Promise<Result<FsKind, FsKindError>> {
  const climb = async (current: string): Promise<Result<FsKind, FsKindError>> => {
    if (signal.aborted) return err({ kind: "cancelled" });
    const probed = await provider.probe(current, signal);
    if (probed.ok) return ok(classifyFs(info, { ...probed.value, path }));
    if (probed.error.kind !== "not_found") return probed;
    const parent = dirname(current);
    if (parent === current) return err({ kind: "not_found", path });
    return climb(parent);
  };
  return climb(path);
}
