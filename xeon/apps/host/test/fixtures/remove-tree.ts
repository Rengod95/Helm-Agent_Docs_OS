import { chmodSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

// 시험 폴더를 지운다. 검토본 저장소의 읽기 전용 트리(디렉터리 0555)는 디렉터리 권한을 먼저 되돌려야 지워진다.
// 저장소가 쓰는 권한과 같은 규칙이다(M5c §4.6.2). 없는 경로는 아무것도 하지 않는다.
export function removeTree(root: string): void {
  if (!existsSync(root)) return;
  if (statSync(root).isDirectory()) {
    chmodSync(root, 0o755);
    for (const entry of readdirSync(root)) removeTree(join(root, entry));
  }
  rmSync(root, { recursive: true, force: true });
}
