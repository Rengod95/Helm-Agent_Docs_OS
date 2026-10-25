import { dlopen, FFIType, read } from "bun:ffi";
import { closeSync, openSync } from "node:fs";
import { attempt, err, ok, type Result } from "@xeon/contracts";
import type { FileLockSource } from "../select.ts";

// libc flock(2)을 bun:ffi로 부르는 유일한 파일이다. 이 패키지의 OS 분기는 select.ts가 고른 `FileLockSource` 값으로만 받는다.
// 잠금 파일은 지우지 않는다(지우면 옛 inode 보유자와 새 inode 생성자가 한 자원을 둘로 나눠 쥘 수 있다).

const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;

export type FlockSelection = Extract<FileLockSource, { readonly kind: "flock" }>;

type FlockError = { readonly kind: "held" } | { readonly kind: "io"; readonly code: string };

interface FlockHandle {
  /** 여러 번 불러도 된다. 두 번째부터는 아무 일도 하지 않는다 */
  release(): void;
}

/** 잠금 파일을 열어 기다리지 않고 배타 잠금을 시도한다 */
export interface FlockPrimitive {
  tryLock(lockPath: string): Result<FlockHandle, FlockError>;
}

type FlockFn = (fd: number, operation: number) => number;
type ErrnoFn = () => number | null;

interface Ffi {
  readonly flock: FlockFn;
  readonly errno: ErrnoFn;
}

function loadFfi(selection: FlockSelection): Ffi | undefined {
  const loaded = attempt(() => {
    const lib = dlopen(selection.libName, {
      flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    });
    const errnoLib = dlopen(selection.libName, {
      [selection.errnoSymbol]: { args: [], returns: FFIType.ptr },
    });
    return { lib, locate: errnoLib.symbols[selection.errnoSymbol] };
  });
  // bun:ffi 로드 실패는 예상 가능한 환경 문제다. 호출자가 프로세스 안 직렬화로 내려간다
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

function errnoOf(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

/** FFI를 읽지 못하면 undefined */
export function createFlockPrimitive(selection: FlockSelection): FlockPrimitive | undefined {
  const ffi = loadFfi(selection);
  if (ffi === undefined) return undefined;
  return {
    tryLock(lockPath) {
      let fd: number;
      try {
        fd = openSync(lockPath, "a+", 0o600);
      } catch (caught) {
        return err({ kind: "io", code: errnoOf(caught) });
      }
      if (ffi.flock(fd, LOCK_EX | LOCK_NB) !== 0) {
        const errno = ffi.errno();
        closeSync(fd);
        if (errno === null || errno === selection.wouldBlockErrno) return err({ kind: "held" });
        return err({ kind: "io", code: `errno:${errno}` });
      }
      let released = false;
      return ok({
        release(): void {
          if (released) return;
          released = true;
          ffi.flock(fd, LOCK_UN);
          closeSync(fd);
        },
      });
    },
  };
}
