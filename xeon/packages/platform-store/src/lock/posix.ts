import { dlopen, FFIType, read } from "bun:ffi";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { attempt, err, ok, type Result } from "@xeon/contracts";
import { sha256Hex } from "../hash.ts";
import type { LockAcquireError, LockHandle, LockProvider } from "./provider.ts";

const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;

export interface PosixLockConfig {
  /** 잠금 키 파일을 두는 디렉터리. 호출자가 0700으로 만들어 두었다 */
  readonly dir: string;
  /** libc 공유 라이브러리 이름. select.ts가 플랫폼으로 고른다 */
  readonly libName: string;
  /** errno 위치를 돌려주는 libc 함수 이름 */
  readonly errnoSymbol: "__errno_location" | "__error";
  /** 이 플랫폼에서 EWOULDBLOCK(EAGAIN)의 errno 값 */
  readonly wouldBlockErrno: number;
}

interface PosixLockHandle extends LockHandle {
  /** 진단용(FD_CLOEXEC 확인 테스트). 판정에 쓰지 않는다 */
  readonly fd: number;
}

/** LockProvider의 구현이다. 진단용 fd를 노출하는 핸들을 돌려준다 */
export interface PosixLockProvider extends LockProvider {
  readonly kind: "flock";
  tryAcquire(key: string): Result<PosixLockHandle, LockAcquireError>;
}

type FlockFn = (fd: number, operation: number) => number;
type ErrnoFn = () => number | null;

interface Ffi {
  readonly flock: FlockFn;
  readonly errno: ErrnoFn;
}

function loadFfi(config: PosixLockConfig): Ffi | undefined {
  const loaded = attempt(() => {
    const lib = dlopen(config.libName, {
      flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    });
    const errnoLib = dlopen(config.libName, {
      [config.errnoSymbol]: { args: [], returns: FFIType.ptr },
    });
    return { lib, locate: errnoLib.symbols[config.errnoSymbol] };
  });
  // bun:ffi 로드 실패는 예상 가능한 환경 문제다. 호출자(select.ts)가 none provider로 내려간다
  if (!loaded.ok) return undefined;
  const { lib, locate } = loaded.value;
  if (locate === undefined) return undefined;
  return {
    flock: (fd, operation): number => lib.symbols.flock(fd, operation),
    errno: (): number | null => {
      const pointer = locate();
      return pointer === null ? null : read.i32(pointer);
    },
  };
}

/**
 * bun:ffi로 libc flock(LOCK_EX | LOCK_NB)을 부른다(L0.store.spec §4.7.2). FFI 호출은 이 파일에만 있다.
 * 키 파일은 지우지 않는다(unlink하면 옛 inode 보유자와 새 inode 생성자가 한 자원을 둘로 나눠 쥘 수 있다).
 */
export function createPosixLockProvider(
  config: PosixLockConfig,
): Result<PosixLockProvider, { readonly kind: "unsupported" }> {
  const ffi = loadFfi(config);
  if (ffi === undefined) return err({ kind: "unsupported" });
  // 프로세스 안 보유 표. 같은 프로세스의 독립 fd도 flock이 거부하지만 provider가 먼저 막는다
  const held = new Set<string>();

  return ok({
    kind: "flock",
    tryAcquire(key: string): Result<PosixLockHandle, LockAcquireError> {
      if (held.has(key)) return err({ kind: "held" });
      const path = join(config.dir, `${sha256Hex(key).slice(0, 32)}.lock`);
      let fd: number;
      try {
        fd = openSync(path, "a+", 0o600);
      } catch (caught) {
        return err({ kind: "io", code: errorCode(caught) });
      }
      if (ffi.flock(fd, LOCK_EX | LOCK_NB) !== 0) {
        const errno = ffi.errno();
        closeSync(fd);
        if (errno === null || errno === config.wouldBlockErrno) return err({ kind: "held" });
        return err({ kind: "io", code: `errno:${errno}` });
      }
      held.add(key);
      let released = false;
      return ok({
        key,
        fd,
        release(): void {
          if (released) return;
          released = true;
          held.delete(key);
          ffi.flock(fd, LOCK_UN);
          closeSync(fd);
        },
      });
    },
  });
}

function errorCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}
