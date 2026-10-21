import { realpathSync } from "node:fs";
import { posix } from "node:path";

// 경로 도우미. 이 패키지의 경로 문자열은 모두 POSIX 형식이다(Windows는 1차 범위 밖, L0.sandbox.spec §1).

/** 끝의 "/"를 지운다. 루트는 그대로 둔다 */
function trimTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * 절대 경로를 정규 경로로 만든다. 존재하는 경로는 realpath로, 없는 경로는 가장 가까운 존재하는 상위의
 * realpath에 나머지를 붙인다(L0.sandbox.spec §3.2 변환 규칙 1).
 */
export function canonicalizePath(absolutePath: string): string {
  const normalized = trimTrailingSlash(posix.normalize(absolutePath));
  let current = normalized;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return rest.length === 0 ? real : posix.join(real, ...rest.toReversed());
    } catch {
      const parent = posix.dirname(current);
      if (parent === current) return normalized;
      rest.push(posix.basename(current));
      current = parent;
    }
  }
}

/**
 * 정책에 적힌 경로를 절대 경로로 만든다. `~`와 `~/…`는 home, 상대 경로는 base 기준이다.
 * realpath는 적용하지 않는다(canonicalizePath가 한다).
 */
export function toAbsolutePath(input: string, home: string, base: string): string {
  if (input === "~") return trimTrailingSlash(posix.normalize(home));
  if (input.startsWith("~/")) return trimTrailingSlash(posix.join(home, input.slice(2)));
  if (posix.isAbsolute(input)) return trimTrailingSlash(posix.normalize(input));
  return trimTrailingSlash(posix.resolve(base, input));
}

/** 경로 마디 비교. child가 parent와 같거나 그 아래인가 */
export function isInside(parent: string, child: string): boolean {
  const base = trimTrailingSlash(parent);
  const target = trimTrailingSlash(child);
  if (base === "/") return target.startsWith("/");
  return target === base || target.startsWith(`${base}/`);
}

/** 정렬하고 중복을 지운다 */
export function sortedUnique(paths: readonly string[]): string[] {
  return [...new Set(paths)].toSorted();
}
