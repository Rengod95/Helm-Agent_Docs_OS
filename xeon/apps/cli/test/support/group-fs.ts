import { err, ok, type Result } from "@xeon/contracts";
import type { GroupIoError, GroupTargetState, GroupTemplatesPort } from "../../src/io.ts";

// 시험 도구: `xeon group new`의 파일 작업을 메모리에서 흉내 낸다(L4.cli.plan §5). 템플릿 파일과 설치 목록을 넣고,
// 쓰인 파일과 만든 폴더를 Map·Set으로 본다. 실제 파일 시스템은 group-new-core-diff.test.ts가 쓴다.

export interface MemoryGroupOptions {
  /** templates/index.json 텍스트. 없으면 색인 읽기가 실패한다 */
  readonly index?: string;
  /** templates/ 기준 상대 경로 → 내용 */
  readonly templates?: Readonly<Record<string, string>>;
  /** 설치된 확장 이름 */
  readonly installed?: readonly string[];
  /** 이 문자열을 경로에 담은 쓰기를 실패시킨다 */
  readonly failWriteAt?: string;
}

export interface MemoryGroupFs {
  readonly port: GroupTemplatesPort;
  /** 절대 경로 → 내용(UTF-8). 쓰기 순서대로 들어간다 */
  readonly files: Map<string, string>;
  /** 만든 폴더 절대 경로 */
  readonly dirs: Set<string>;
  /** 읽은 템플릿 파일의 상대 경로 */
  readonly reads: string[];
}

function failure(path: string, message: string): GroupIoError {
  return { path, message, missing: false };
}

/** 경로 아래(하위 경로)에 든 파일과 폴더 */
function childrenOf(
  root: string,
  files: ReadonlyMap<string, string>,
  dirs: ReadonlySet<string>,
): boolean {
  const prefix = `${root}/`;
  return (
    [...files.keys()].some((path) => path.startsWith(prefix)) ||
    [...dirs].some((path) => path.startsWith(prefix))
  );
}

export function createMemoryGroupFs(options: MemoryGroupOptions = {}): MemoryGroupFs {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const reads: string[] = [];
  const port: GroupTemplatesPort = {
    readIndex(): Promise<Result<string, GroupIoError>> {
      return Promise.resolve(
        options.index === undefined
          ? err(failure("templates/index.json", "no index in this fixture"))
          : ok(options.index),
      );
    },
    readTemplateFile(rel): Promise<Result<Uint8Array, GroupIoError>> {
      reads.push(rel);
      const text = options.templates?.[rel];
      return Promise.resolve(
        text === undefined
          ? err(failure(rel, "no such template file in this fixture"))
          : ok(new TextEncoder().encode(text)),
      );
    },
    installedExtensionNames(): Promise<Result<readonly string[], GroupIoError>> {
      return Promise.resolve(ok(options.installed ?? []));
    },
    targetState(path): Promise<Result<GroupTargetState, GroupIoError>> {
      if (childrenOf(path, files, dirs)) return Promise.resolve(ok<GroupTargetState>("occupied"));
      return Promise.resolve(ok<GroupTargetState>(dirs.has(path) ? "empty" : "absent"));
    },
    makeDir(path) {
      dirs.add(path);
      return Promise.resolve(ok(undefined));
    },
    writeFile(path, bytes) {
      if (options.failWriteAt !== undefined && path.includes(options.failWriteAt)) {
        return Promise.resolve(err(failure(path, "disk full (fixture)")));
      }
      files.set(path, new TextDecoder().decode(bytes));
      return Promise.resolve(ok(undefined));
    },
    removeDir(path, removeOptions) {
      const prefix = `${path}/`;
      for (const file of files.keys()) if (file.startsWith(prefix)) files.delete(file);
      for (const dir of dirs) if (dir.startsWith(prefix)) dirs.delete(dir);
      if (!removeOptions.keepRoot) dirs.delete(path);
      return Promise.resolve(ok(undefined));
    },
  };
  return { port, files, dirs, reads };
}

/** `root` 아래 파일의 상대 경로를 정렬해 돌려준다 */
export function filesUnder(fake: MemoryGroupFs, root: string): string[] {
  const prefix = `${root}/`;
  return [...fake.files.keys()]
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length))
    .toSorted();
}
