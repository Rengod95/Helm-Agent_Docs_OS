// 경로 도우미. ScanFs는 절대 경로를 받는다. `/` 구분만 쓴다(POSIX 경로. Windows는 호출자가 정규화한다).

export function joinPath(base: string, ...parts: readonly string[]): string {
  let result = base.endsWith("/") && base.length > 1 ? base.slice(0, -1) : base;
  for (const part of parts) {
    result = result === "" || result === "/" ? `/${part}` : `${result}/${part}`;
  }
  return result;
}

export function dirnameOf(path: string): string {
  const index = path.lastIndexOf("/");
  if (index <= 0) return index === 0 ? "/" : ".";
  return path.slice(0, index);
}

/** 홈 아래 경로를 `~/…`로 줄인다. 시험과 보고서가 사용자 이름을 담지 않게 한다 */
export function displayPath(path: string, homeDir: string): string {
  if (path === homeDir) return "~";
  const prefix = homeDir.endsWith("/") ? homeDir : `${homeDir}/`;
  return path.startsWith(prefix) ? `~/${path.slice(prefix.length)}` : path;
}

/** `..`와 `.`를 정리한다. 루트 위로 나가면 undefined */
export function normalizePath(path: string): string | undefined {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return undefined;
      out.pop();
    } else {
      out.push(part);
    }
  }
  return `/${out.join("/")}`;
}

/** `path`가 `root` 아래(또는 같음)인가 */
export function isInside(root: string, path: string): boolean {
  const base = root.endsWith("/") ? root : `${root}/`;
  return path === root || path.startsWith(base);
}
