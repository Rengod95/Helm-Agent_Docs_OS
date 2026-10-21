import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempDir extends Disposable {
  readonly path: string;
  join(...parts: readonly string[]): string;
}

/** 테스트마다 따로 쓰는 임시 디렉터리. `using`으로 지운다 */
export function tempDir(prefix: string = "xeon-store-test-"): TempDir {
  const path = mkdtempSync(join(tmpdir(), prefix));
  return {
    path,
    join: (...parts): string => join(path, ...parts),
    [Symbol.dispose](): void {
      rmSync(path, { recursive: true, force: true });
    },
  };
}
