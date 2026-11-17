import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { removeTree } from "../../fixtures/remove-tree.ts";
import { ok } from "@fresnel/contracts";
import type { FileLock } from "@fresnel/platform-os";

/** 시험마다 새 임시 폴더를 만든다. 지우는 것은 시험이 맡는다 */
export function tempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export { removeTree };

/** 상대 경로 → 내용 그림을 폴더에 쓴다. 실행 비트가 필요하면 `executable`을 준다 */
export function writeFiles(
  root: string,
  files: Readonly<Record<string, string>>,
  executable: readonly string[] = [],
): void {
  for (const [path, content] of Object.entries(files)) {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    if (executable.includes(path)) chmodSync(abs, 0o755);
  }
}

/** 한 프로세스 시험용 잠금: 잠금은 항상 얻는다(프로세스 사이 경쟁은 시험하지 않는다). 검토본 저장소 시험이 쓴다 */
export const passThroughFileLock: FileLock = {
  scope: "process",
  withLock: async (_path, fn) => ok(await fn()),
  updateText: () => Promise.reject(new Error("updateText is not part of this test")),
};
