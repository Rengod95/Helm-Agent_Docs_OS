// 시험 도우미: 메모리 위의 읽기 전용 ScanFs. 파일 트리를 값으로 주고, 쓰기 메서드는 없다.
import type { ScanFs, ScanRead, ScanStat } from "../src/types.ts";

export type MemoryEntry = string | Uint8Array | { readonly symlinkTo: string };

function parentsOf(path: string): string[] {
  const parts = path.split("/").filter((part) => part !== "");
  const dirs: string[] = ["/"];
  for (let index = 1; index < parts.length; index += 1) {
    dirs.push(`/${parts.slice(0, index).join("/")}`);
  }
  return dirs;
}

/** `files`의 키는 절대 경로다. 부모 폴더는 자동으로 있다고 본다 */
export function memoryFs(files: Readonly<Record<string, MemoryEntry>>): ScanFs {
  const dirs = new Set<string>(["/"]);
  for (const path of Object.keys(files)) for (const dir of parentsOf(path)) dirs.add(dir);
  return {
    async lstat(path: string): Promise<ScanStat | null> {
      if (dirs.has(path)) return { kind: "dir", size: 0 };
      const entry = files[path];
      if (entry === undefined) return null;
      if (typeof entry === "string")
        return { kind: "file", size: new TextEncoder().encode(entry).length };
      if (entry instanceof Uint8Array) return { kind: "file", size: entry.length };
      return { kind: "symlink", size: 0 };
    },
    async listDir(path: string): Promise<readonly string[]> {
      const prefix = path === "/" ? "/" : `${path}/`;
      const names = new Set<string>();
      for (const key of [...Object.keys(files), ...dirs]) {
        if (key !== path && key.startsWith(prefix)) {
          const name = key.slice(prefix.length).split("/")[0];
          if (name !== undefined && name !== "") names.add(name);
        }
      }
      return [...names];
    },
    async readBounded(path: string, maxBytes: number): Promise<ScanRead> {
      const entry = files[path];
      if (entry === undefined || (typeof entry === "object" && !(entry instanceof Uint8Array))) {
        return { kind: "unreadable" };
      }
      const bytes = typeof entry === "string" ? new TextEncoder().encode(entry) : entry;
      if (bytes.length > maxBytes) return { kind: "too_large" };
      if (typeof entry === "string") return { kind: "text", text: entry };
      return { kind: "binary", bytes };
    },
    async realpath(path: string): Promise<string> {
      const entry = files[path];
      if (entry !== undefined && typeof entry === "object" && !(entry instanceof Uint8Array)) {
        return entry.symlinkTo;
      }
      return path;
    },
  };
}
