// Plugin UI 시험용 메모리 LoaderFs. 폴더, 파일, 심볼릭 링크를 절대 경로 문자열로 둔다.
// realpath는 경로의 가장 긴 링크 접두를 바꿔 실제 경로를 낸다(실제 파일 시스템과 같은 방식). 시험 대역이라 없는 경로도 던지지 않는다.
import { basename, dirname } from "node:path";
import type { LoaderFs } from "@fresnel/contracts/extensions";

export interface MemoryTree {
  /** 파일 경로 → 본문 */
  readonly files?: Readonly<Record<string, string>>;
  /** 폴더 경로. 빈 폴더도 여기 적는다 */
  readonly dirs?: readonly string[];
  /** 심볼릭 링크 경로 → 가리키는 절대 경로 */
  readonly links?: Readonly<Record<string, string>>;
}

export interface MemoryLoaderFs extends LoaderFs {
  /** `readText`가 받은 경로들(순서대로) */
  readonly read: string[];
  /** `exists`가 받은 경로들(순서대로). 앱 파일을 보지 않았는지 확인하는 데 쓴다 */
  readonly probed: string[];
}

/** 경로의 모든 상위 폴더. 파일과 링크가 있으려면 그 위 폴더도 있어야 하므로 시험 대역이 채운다 */
function ancestorsOf(path: string): string[] {
  const out: string[] = [];
  let current = dirname(path);
  while (current !== dirname(current)) {
    out.push(current);
    current = dirname(current);
  }
  return out;
}

export function memoryLoaderFs(tree: MemoryTree): MemoryLoaderFs {
  const files = new Map<string, string>(Object.entries(tree.files ?? {}));
  const links = new Map<string, string>(Object.entries(tree.links ?? {}));
  const explicit = tree.dirs ?? [];
  const dirs = new Set<string>([
    ...explicit,
    ...[...files.keys(), ...links.keys(), ...explicit].flatMap(ancestorsOf),
  ]);
  const read: string[] = [];
  const probed: string[] = [];

  function realOf(path: string): string {
    for (const [link, target] of links) {
      if (path === link) return realOf(target);
      if (path.startsWith(`${link}/`)) return realOf(`${target}${path.slice(link.length)}`);
    }
    return path;
  }

  return {
    read,
    probed,
    readText(path) {
      read.push(path);
      return Promise.resolve(files.get(realOf(path)) ?? null);
    },
    listDir(path) {
      const real = realOf(path);
      if (!dirs.has(real)) return Promise.resolve(null);
      const listed: { name: string; kind: "file" | "dir" | "symlink" }[] = [];
      for (const file of files.keys()) {
        if (dirname(file) === real) listed.push({ name: basename(file), kind: "file" });
      }
      for (const dir of dirs) {
        if (dir !== real && dirname(dir) === real)
          listed.push({ name: basename(dir), kind: "dir" });
      }
      for (const link of links.keys()) {
        if (dirname(link) === real) listed.push({ name: basename(link), kind: "symlink" });
      }
      return Promise.resolve(listed);
    },
    exists(path) {
      probed.push(path);
      const real = realOf(path);
      return Promise.resolve(files.has(real) || dirs.has(real));
    },
    realpath(path) {
      return Promise.resolve(realOf(path));
    },
  };
}
