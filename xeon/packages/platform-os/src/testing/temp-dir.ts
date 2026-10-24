import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempDir {
  readonly path: string;
  /** path 아래 경로를 만든다 */
  join(...parts: readonly string[]): string;
  /** 지우기. afterEach에서 부른다. 두 번 불러도 된다 */
  remove(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

/** 임시 디렉터리(소유자만 접근, 0700)를 만든다. macOS의 심볼릭 링크 경로는 실제 경로로 푼다 */
export async function tempDir(prefix: string = "xeon-test-"): Promise<TempDir> {
  const base = await realpath(tmpdir());
  const path = await mkdtemp(join(base, prefix));
  const remove = async (): Promise<void> => {
    await rm(path, { recursive: true, force: true });
  };
  return {
    path,
    join: (...parts) => join(path, ...parts),
    remove,
    [Symbol.asyncDispose]: remove,
  };
}
