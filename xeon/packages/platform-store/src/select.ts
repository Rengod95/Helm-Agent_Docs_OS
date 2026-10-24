import { assertNever } from "@xeon/contracts";
import { createNoneLockProvider } from "./lock/none.ts";
import type { LockProvider } from "./lock/provider.ts";
import { createPosixLockProvider, type PosixLockConfig } from "./lock/posix.ts";

export type StorePlatform = "darwin" | "linux" | "win32";

/** 플랫폼마다 달라지는 동작의 판정. OS 분기는 이 파일에만 둔다(DR-13, L0.readme §3.1 선택 지점 한 곳) */
export interface PlatformPolicy {
  /** Database.setCustomSQLite로 FTS5가 든 SQLite를 지정한다(macOS) */
  readonly customSqlite: boolean;
  /** PRAGMA fullfsync / checkpoint_fullfsync를 건다(macOS) */
  readonly fullFsync: boolean;
  /** 0600/0700 모드와 소유자 검사가 의미 있다 */
  readonly posixPermissions: boolean;
  /** 블롭 목적 디렉터리를 fsync한다 */
  readonly directoryFsync: boolean;
  readonly lock: LockSelection;
}

export type LockSelection =
  | { readonly kind: "flock"; readonly libName: string; readonly errno: PosixErrno }
  | { readonly kind: "none" };

interface PosixErrno {
  readonly errnoSymbol: PosixLockConfig["errnoSymbol"];
  readonly wouldBlockErrno: number;
}

/** process.platform 문자열을 지원 플랫폼으로 좁힌다. 지원 밖이면 undefined(예상 가능한 실패, DR-13) */
export function toStorePlatform(raw: string): StorePlatform | undefined {
  switch (raw) {
    case "darwin":
    case "linux":
    case "win32":
      return raw;
    // xeon-disable-next-line xeon/switch-default-never -- 지원 목록 밖 OS는 값으로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return undefined;
  }
}

export function selectPlatformPolicy(platform: StorePlatform): PlatformPolicy {
  switch (platform) {
    case "darwin":
      return {
        customSqlite: true,
        fullFsync: true,
        posixPermissions: true,
        directoryFsync: true,
        lock: {
          kind: "flock",
          libName: "libSystem.B.dylib",
          errno: { errnoSymbol: "__error", wouldBlockErrno: 35 },
        },
      };
    case "linux":
      return {
        customSqlite: false,
        fullFsync: false,
        posixPermissions: true,
        directoryFsync: true,
        lock: {
          kind: "flock",
          libName: "libc.so.6",
          errno: { errnoSymbol: "__errno_location", wouldBlockErrno: 11 },
        },
      };
    case "win32":
      // Windows LockProvider는 M2 이후(ST-20, 미결 S-5). 그 전까지 DB 임대만 쓴다
      return {
        customSqlite: false,
        fullFsync: false,
        posixPermissions: false,
        directoryFsync: false,
        lock: { kind: "none" },
      };
    default:
      return assertNever(platform, "StorePlatform");
  }
}

/** 선택한 OS 잠금을 만든다. FFI 로드에 실패하면 none provider로 내려간다 */
export function createLockProvider(selection: LockSelection, lockDir: string): LockProvider {
  switch (selection.kind) {
    case "flock": {
      const created = createPosixLockProvider({
        dir: lockDir,
        libName: selection.libName,
        errnoSymbol: selection.errno.errnoSymbol,
        wouldBlockErrno: selection.errno.wouldBlockErrno,
      });
      return created.ok ? created.value : createNoneLockProvider();
    }
    case "none":
      return createNoneLockProvider();
    default:
      return assertNever(selection, "LockSelection");
  }
}
