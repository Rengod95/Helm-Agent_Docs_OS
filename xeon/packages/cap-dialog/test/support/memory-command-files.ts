import { err, ok } from "@xeon/contracts";
import { FileError, type FileInfo } from "@xeon/contracts/services";
import type { CommandFiles } from "../../src/ports/command-files.ts";
import {
  loadTemplatesFromDir,
  type LoadedTemplates,
} from "../../src/upstream/pi/prompt-templates.ts";

// 명령 파일 원천 대역. 경로 → 내용 표를 파일 시스템처럼 보여 준다. 디렉터리는 파일 경로의 부모로 만들어진다.

export interface MemoryCommandFiles extends CommandFiles {
  /** 파일을 더하거나 바꾼다. 수정 시각이 올라간다 */
  put(path: string, content: string): void;
  remove(path: string): void;
  /** 심볼릭 링크처럼 보이게 한다. 읽으면 대상이 없어 실패한다 */
  brokenLink(path: string): void;
  /** listDir 호출 횟수 */
  readonly listCalls: () => number;
  /** readTextFile 호출 횟수 */
  readonly readCalls: () => number;
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

export function memoryCommandFiles(
  initial: Readonly<Record<string, string>> = {},
): MemoryCommandFiles {
  const files = new Map<string, { content: string; mtimeMs: number }>(
    Object.entries(initial).map(([path, content]) => [path, { content, mtimeMs: 1 }]),
  );
  const links = new Set<string>();
  let clock = 1;
  let lists = 0;
  let reads = 0;

  function dirExists(dir: string): boolean {
    for (const path of [...files.keys(), ...links]) {
      if (path === dir || path.startsWith(`${dir}/`)) return true;
    }
    return false;
  }

  return {
    put(path, content) {
      clock += 1;
      files.set(path, { content, mtimeMs: clock });
    },
    remove(path) {
      files.delete(path);
      links.delete(path);
    },
    brokenLink(path) {
      links.add(path);
    },
    listCalls: () => lists,
    readCalls: () => reads,
    listDir(dir) {
      lists += 1;
      if (!dirExists(dir)) {
        return Promise.resolve(err(new FileError("not_found", `not found: ${dir}`, dir)));
      }
      const entries: FileInfo[] = [];
      for (const [path, file] of files) {
        if (parentOf(path) !== dir) continue;
        entries.push({
          name: path.slice(dir.length + 1),
          path,
          kind: "file",
          size: file.content.length,
          mtimeMs: file.mtimeMs,
        });
      }
      for (const path of links) {
        if (parentOf(path) !== dir) continue;
        entries.push({
          name: path.slice(dir.length + 1),
          path,
          kind: "symlink",
          size: 0,
          mtimeMs: 0,
        });
      }
      return Promise.resolve(ok(entries));
    },
    readTextFile(path) {
      reads += 1;
      const file = files.get(path);
      if (file === undefined) {
        return Promise.resolve(err(new FileError("not_found", `not found: ${path}`, path)));
      }
      return Promise.resolve(ok(file.content));
    },
  };
}

/** 한 디렉터리의 파일 표를 읽는다. 디렉터리는 첫 경로의 부모다 */
export async function loadFromMemory(
  initial: Readonly<Record<string, string>>,
): Promise<LoadedTemplates> {
  const [first] = Object.keys(initial);
  return loadTemplatesFromDir(memoryCommandFiles(initial), parentOf(first ?? "/"), {
    abortSignal: undefined,
  });
}
