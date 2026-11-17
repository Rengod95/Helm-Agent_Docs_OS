import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** 시험마다 새 임시 폴더를 만든다. 지우는 것은 시험이 맡는다 */
export function tempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeTree(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

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
