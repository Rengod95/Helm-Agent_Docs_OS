import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Clock } from "@fresnel/contracts";
import {
  createVersionHistory,
  type VersionHistory,
  type VersionHistoryFs,
} from "@fresnel/ext-host";

// X.loading-trust.spec §3.11, §4.4.8. 버전 기록 보관의 node:fs 구현(조립 루트 코드, DR-14 예외 2).
// 없는 경로는 null이나 false로 돌려주고, 나머지 입출력 실패는 거부로 둔다. 보관 모듈이 그것을 `io` 오류 값으로 바꾼다.

/** 보관 디렉터리 이름. 점으로 시작하므로 확장 탐색이 건너뛴다(§4.2.1) */
const HISTORY_DIR_NAME = ".history";

function isMissing(caught: unknown): boolean {
  return (
    typeof caught === "object" &&
    caught !== null &&
    "code" in caught &&
    (caught.code === "ENOENT" || caught.code === "ENOTDIR")
  );
}

/** 실제 파일 시스템 위의 버전 기록 파일 접근 */
export const nodeVersionHistoryFs: VersionHistoryFs = {
  async readText(path) {
    try {
      return await readFile(path, "utf8");
    } catch (caught) {
      if (isMissing(caught)) return null;
      throw caught;
    }
  },
  async writeText(path, text) {
    // 임시 파일에 쓰고 옮긴다. 같은 디렉터리 안의 옮기기라 원자적이다
    const temp = `${path}.tmp`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, text);
    await rename(temp, path);
  },
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch (caught) {
      if (isMissing(caught)) return false;
      throw caught;
    }
  },
  async listDir(path) {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "dir" : "file",
      }));
    } catch (caught) {
      if (isMissing(caught)) return null;
      throw caught;
    }
  },
  async copyDir(from, to) {
    // 심볼릭 링크는 가리키는 내용을 복사한다. `to`가 있으면 덮어쓰지 않고 실패한다(계약)
    await mkdir(dirname(to), { recursive: true });
    await cp(from, to, { recursive: true, dereference: true, errorOnExist: true, force: false });
  },
  async removeDir(path) {
    await rm(path, { recursive: true, force: true });
  },
  async renameDir(from, to) {
    await rename(from, to);
  },
};

/** 매니페스트 텍스트의 해시(sha256 16진수). 버전 기록과 되돌리기의 번들 판 확인이 같은 함수를 쓴다 */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * 확장 버전 기록을 만든다. 보관 위치는 `<extensionsDir>/.history`(사용자 확장 위치 아래)다. 설치 시각은 주입한 시계를 쓰고,
 * 매니페스트 해시는 sha256 16진수다
 */
export function createExtUiVersionHistory(input: {
  readonly extensionsDir: string;
  readonly clock: Clock;
}): VersionHistory {
  return createVersionHistory({
    fs: nodeVersionHistoryFs,
    historyRoot: join(input.extensionsDir, HISTORY_DIR_NAME),
    now: () => input.clock.now(),
    hash: sha256Hex,
  });
}
