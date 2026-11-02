// 버전 기록 시험용 메모리 파일 시스템. 파일과 디렉터리를 절대 경로 문자열로 두고, 실패는 `setFault`로 주입한다.
// 포트 계약대로 없는 원본의 복사와 옮기기, 이미 있는 대상은 거부한다.
import { basename, dirname } from "node:path";
import type { VersionHistoryFs } from "../../../src/loading-trust/index.ts";

/** 실패를 주입할 수 있는 변경 연산 */
type FsOp = "writeText" | "copyDir" | "removeDir" | "renameDir";

/** 주입한 실패. 돌려준 오류 값으로 그 호출을 거부한다. `undefined`면 정상이다 */
export type FsFault = (op: FsOp, path: string) => Error | undefined;

export interface MemoryVersionFs extends VersionHistoryFs {
  /** `root` 아래 파일 본문을 `root` 기준 상대 경로로 돌려준다 */
  filesUnder(root: string): Readonly<Record<string, string>>;
  setFault(fault: FsFault | null): void;
}

function isWithin(path: string, dir: string): boolean {
  return path.startsWith(`${dir}/`);
}

/** `dir` 자신과 그 아래 경로인지. 순회 중에 지우거나 더하지 않도록 목록을 따로 만들어 쓴다 */
function isOrWithin(path: string, dir: string): boolean {
  return path === dir || isWithin(path, dir);
}

export function memoryVersionFs(initial: Readonly<Record<string, string>> = {}): MemoryVersionFs {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  let fault: FsFault | null = null;

  function addDirs(path: string): void {
    let current = dirname(path);
    while (current !== dirname(current)) {
      dirs.add(current);
      current = dirname(current);
    }
  }

  function checkFault(op: FsOp, path: string): Promise<void> {
    const failure = fault?.(op, path);
    return failure === undefined ? Promise.resolve() : Promise.reject(failure);
  }

  function listing(path: string): { name: string; kind: "file" | "dir" }[] | null {
    if (!dirs.has(path)) return null;
    const entries: { name: string; kind: "file" | "dir" }[] = [];
    for (const file of files.keys()) {
      if (dirname(file) === path) entries.push({ name: basename(file), kind: "file" });
    }
    for (const dir of dirs) {
      if (dirname(dir) === path) entries.push({ name: basename(dir), kind: "dir" });
    }
    return entries;
  }

  for (const [path, text] of Object.entries(initial)) {
    addDirs(path);
    files.set(path, text);
  }

  return {
    filesUnder(root) {
      const out: Record<string, string> = {};
      for (const [file, text] of files) {
        if (isWithin(file, root)) out[file.slice(root.length + 1)] = text;
      }
      return out;
    },
    setFault(next) {
      fault = next;
    },
    readText: (path) => Promise.resolve(files.get(path) ?? null),
    exists: (path) => Promise.resolve(files.has(path) || dirs.has(path)),
    listDir: (path) => Promise.resolve(listing(path)),
    async writeText(path, text) {
      await checkFault("writeText", path);
      addDirs(path);
      files.set(path, text);
    },
    async copyDir(from, to) {
      await checkFault("copyDir", from);
      if (!dirs.has(from)) throw new Error(`no directory ${from}`);
      if (files.has(to) || dirs.has(to)) throw new Error(`${to} already exists`);
      for (const [file, text] of [...files].filter(([name]) => isWithin(name, from))) {
        files.set(`${to}${file.slice(from.length)}`, text);
      }
      for (const dir of [...dirs].filter((name) => isOrWithin(name, from))) {
        dirs.add(`${to}${dir.slice(from.length)}`);
      }
      dirs.add(to);
      addDirs(to);
    },
    async removeDir(path) {
      await checkFault("removeDir", path);
      for (const file of [...files.keys()].filter((name) => isOrWithin(name, path))) {
        files.delete(file);
      }
      for (const dir of [...dirs].filter((name) => isOrWithin(name, path))) {
        dirs.delete(dir);
      }
    },
    async renameDir(from, to) {
      await checkFault("renameDir", from);
      if (!dirs.has(from)) throw new Error(`no directory ${from}`);
      if (files.has(to) || dirs.has(to)) throw new Error(`${to} already exists`);
      for (const [file, text] of [...files].filter(([name]) => isWithin(name, from))) {
        files.delete(file);
        files.set(`${to}${file.slice(from.length)}`, text);
      }
      for (const dir of [...dirs].filter((name) => isOrWithin(name, from))) {
        dirs.delete(dir);
        dirs.add(`${to}${dir.slice(from.length)}`);
      }
      addDirs(to);
    },
  };
}
