import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RepeatDisableBackend } from "@fresnel/ext-host";

// 반복 자동 끄기 원장의 파일 백엔드(결정 2026-11-04 B5, X.operations.spec §9 7번). 호스트 상태 디렉터리의 한 파일이다.
// 조립 루트는 상태 디렉터리를 `os` 포트가 올라온 뒤에야 알므로 경로는 늦게 정한다. 정하기 전의 읽기는 비어 있고 쓰기는 버린다.

/** 상태 디렉터리 아래 파일 이름 */
export const REPEAT_DISABLE_FILE = "ext-auto-disable.json";

export interface LateFileBackend extends RepeatDisableBackend {
  /** 저장 경로를 정한다. 이 뒤의 읽기와 쓰기가 파일로 간다 */
  bind(path: string): void;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

export function createLateFileBackend(): LateFileBackend {
  let path: string | undefined;
  return {
    bind(next) {
      path = next;
    },
    async read() {
      if (path === undefined) return null;
      try {
        return await readFile(path, "utf8");
      } catch (caught) {
        if (isMissing(caught)) return null;
        throw caught;
      }
    },
    async write(text) {
      if (path === undefined) return;
      const temp = `${path}.tmp`;
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temp, text);
      await rename(temp, path);
    },
  };
}
