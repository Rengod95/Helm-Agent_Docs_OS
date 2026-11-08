// 비밀을 담는 작은 파일을 안전하게 쓰고 읽는다: 폴더 0700, 파일 0600, 임시 파일에 쓰고 rename.
// 시크릿 값(토큰 원문, 개인 키)은 호출자가 이 함수로만 디스크에 둔다.
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { attempt, err, ok, type Result } from "@fresnel/contracts";

/** 읽기 상한(바이트). 넘는 파일은 손상으로 본다 */
const MAX_STATE_FILE_BYTES = 1_048_576;

export type FileError = {
  readonly kind: "io";
  readonly op: "read" | "write";
  readonly path: string;
  readonly cause: unknown;
};

/** 파일 내용. 없으면 `null`이다(오류가 아니다) */
export function readTextFile(file: string): Result<string | null, FileError> {
  const read = attempt(() => {
    const size = statSync(file, { throwIfNoEntry: false })?.size;
    if (size === undefined) return null;
    if (size > MAX_STATE_FILE_BYTES) {
      throw new RangeError(`state file is larger than ${MAX_STATE_FILE_BYTES} bytes`);
    }
    return readFileSync(file, "utf8");
  });
  if (!read.ok) return err({ kind: "io", op: "read", path: file, cause: read.error.cause });
  return ok(read.value);
}

/** 폴더를 0700으로 만들고 임시 파일(0600)에 쓴 뒤 rename한다. 도중에 끊겨도 옛 파일이나 새 파일 중 하나만 보인다 */
export function writeSecretFile(file: string, text: string): Result<null, FileError> {
  const tmp = `${file}.${process.pid}.tmp`;
  const written = attempt(() => {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    rmSync(tmp, { force: true });
    const fd = openSync(tmp, "wx", 0o600);
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, file);
    return null;
  });
  if (!written.ok) {
    rmSync(tmp, { force: true });
    return err({ kind: "io", op: "write", path: file, cause: written.error.cause });
  }
  return ok(null);
}
