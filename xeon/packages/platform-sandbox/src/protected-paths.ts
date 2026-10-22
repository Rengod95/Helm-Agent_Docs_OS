import { readdirSync } from "node:fs";
import { posix } from "node:path";
import { attempt } from "@xeon/contracts";
import {
  matchProtectedPath,
  type OsDirs,
  type ProtectedAccess,
  type ProtectedMatch,
  type ProtectedPathEntry,
} from "@xeon/contracts/services";
import { canonicalizePath, toAbsolutePath } from "./paths.ts";

// L0.sandbox.spec §3.3. 보호 경로는 줄일 수 없고 설정으로 더할 수만 있다.

type Reason = ProtectedPathEntry["reason"];
type ProtectedDirs = Pick<OsDirs, "home" | "data" | "config">;

function entry(
  path: string,
  match: ProtectedMatch,
  access: ProtectedAccess,
  reason: Reason,
  except?: readonly string[],
): ProtectedPathEntry {
  const base = { path, match, access, reason };
  return except === undefined ? base : { ...base, except: [...except] };
}

/** 절대 경로 항목을 만든다. 경로는 정규 경로로 바꾼다 */
function pathEntry(
  path: string,
  match: "exact" | "prefix",
  access: ProtectedAccess,
  reason: Reason,
): ProtectedPathEntry {
  return entry(canonicalizePath(path), match, access, reason);
}

function homeEntries(
  home: string,
  names: readonly string[],
  match: "exact" | "prefix",
  access: ProtectedAccess,
  reason: Reason,
): ProtectedPathEntry[] {
  return names.map((name) => pathEntry(posix.join(home, name), match, access, reason));
}

/** 설정 `protectedPaths.extra`의 값을 절대 경로로 풀고, 풀 수 없는 값을 따로 돌려준다 */
export function resolveExtraPaths(
  extra: readonly string[],
  home: string,
): { readonly resolved: readonly string[]; readonly rejected: readonly string[] } {
  const resolved: string[] = [];
  const rejected: string[] = [];
  for (const value of extra) {
    if (value === "~" || value.startsWith("~/") || posix.isAbsolute(value)) {
      resolved.push(canonicalizePath(toAbsolutePath(value, home, "/")));
    } else {
      rejected.push(value);
    }
  }
  return { resolved, rejected };
}

export interface ProtectedPathInput {
  readonly dirs: ProtectedDirs;
  /** SandboxProvider.defaultProtectedPaths(dirs) */
  readonly providerEntries: readonly ProtectedPathEntry[];
  /** SecretService.protectedPaths(): 비밀 파일 절대 경로. 값 없음 */
  readonly secretPaths: readonly string[];
  /** 부모 env의 SOPS_AGE_KEY_FILE */
  readonly ageKeyFileEnv: string | undefined;
  /** l0.sandbox.protectedPaths.extra를 resolveExtraPaths로 푼 값 */
  readonly extraPaths: readonly string[];
}

/** 작업 공간 root마다 붙는 git 실행 경로(L0.sandbox.spec §3.3 git_exec 행) */
export function gitProtectedEntries(roots: readonly string[]): ProtectedPathEntry[] {
  const entries: ProtectedPathEntry[] = [];
  for (const root of roots) {
    entries.push(
      pathEntry(posix.join(root, ".git", "config"), "exact", "write", "git_exec"),
      pathEntry(posix.join(root, ".git", "config.worktree"), "exact", "write", "git_exec"),
      pathEntry(posix.join(root, ".git", "info", "attributes"), "exact", "write", "git_exec"),
      pathEntry(posix.join(root, ".git", "hooks"), "prefix", "write", "git_exec"),
      pathEntry(posix.join(root, ".gitmodules"), "exact", "write", "git_exec"),
    );
  }
  return entries;
}

function dedupe(entries: readonly ProtectedPathEntry[]): ProtectedPathEntry[] {
  const seen = new Set<string>();
  const result: ProtectedPathEntry[] = [];
  for (const item of entries) {
    const key = `${item.match}|${item.access}|${item.reason}|${item.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * 기본 보호 경로(공통 표 + provider 항목 + 비밀 경로 + 설정 추가분). 작업 공간 root별 git 항목은 제외한다.
 * 더 구체적인 항목(비밀)을 앞에 둔다. matchProtectedPath는 맞는 첫 항목을 돌려주기 때문이다.
 */
export function buildProtectedPaths(input: ProtectedPathInput): readonly ProtectedPathEntry[] {
  const { home, data, config } = input.dirs;
  const entries: ProtectedPathEntry[] = [
    // 비밀
    pathEntry(posix.join(config, "secrets"), "prefix", "read_write", "secret_key"),
    ...input.secretPaths
      .filter((path) => posix.isAbsolute(path))
      .map((path) => pathEntry(path, "prefix", "read_write", "secret_key")),
    pathEntry(posix.join(home, ".config", "sops"), "prefix", "read_write", "secret_key"),
    pathEntry(
      posix.join(home, ".config", "sops", "age", "keys.txt"),
      "exact",
      "read_write",
      "secret_key",
    ),
    ...(input.ageKeyFileEnv !== undefined && posix.isAbsolute(input.ageKeyFileEnv)
      ? [pathEntry(input.ageKeyFileEnv, "exact", "read_write", "secret_key")]
      : []),
    // Xeon 데이터와 설정
    pathEntry(data, "prefix", "read_write", "xeon_data"),
    pathEntry(config, "prefix", "write", "xeon_config"),
    // 자격 파일
    pathEntry(posix.join(home, ".ssh"), "prefix", "read_write", "credentials"),
    entry(".env", "basename", "read_write", "credentials", [".env.example"]),
    entry(".env.*", "basename", "read_write", "credentials", [".env.example"]),
    ...homeEntries(home, [".claude", ".codex", ".pi"], "prefix", "read_write", "agent_credentials"),
    ...homeEntries(
      home,
      [".config/gh", ".aws", ".kube", ".config/gcloud"],
      "prefix",
      "read_write",
      "credentials",
    ),
    ...homeEntries(
      home,
      [".git-credentials", ".netrc", ".docker/config.json", ".npmrc", ".pypirc"],
      "exact",
      "read_write",
      "credentials",
    ),
    // 셸 시작 파일
    ...homeEntries(
      home,
      [".bashrc", ".bash_profile", ".zshrc", ".zprofile", ".zshenv", ".profile", ".gitconfig"],
      "exact",
      "write",
      "shell_startup",
    ),
    // 지속 실행 등록
    pathEntry(posix.join(home, ".local", "bin"), "prefix", "write", "persistence"),
    ...input.providerEntries,
    // 설정 추가분
    ...input.extraPaths.map((path) => pathEntry(path, "prefix", "read_write", "user_extra")),
  ];
  return dedupe(entries);
}

/** 기본 보호 경로에 작업 공간 root별 git 항목을 더한다 */
export function withGitEntries(
  base: readonly ProtectedPathEntry[],
  roots: readonly string[],
): readonly ProtectedPathEntry[] {
  return dedupe([...base, ...gitProtectedEntries(roots)]);
}

/** 이름 패턴(끝의 *만 와일드카드)이 파일 이름과 맞는가 */
function nameMatches(pattern: string, name: string): boolean {
  return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}

/**
 * basename 항목을 쓰기 루트 아래 파일의 리터럴 경로로 바꾼다. 깊이 `depth`까지 훑고 심볼릭 링크 디렉터리는 따라가지 않는다.
 * 실행 중 새로 생긴 파일은 덮지 못한다(L0.sandbox.spec §5.1). 결과는 중복 없이 정렬한다.
 */
export function expandBasenameEntries(
  entries: readonly ProtectedPathEntry[],
  roots: readonly string[],
  depth: number,
): string[] {
  const patterns = entries.filter((item) => item.match === "basename");
  if (patterns.length === 0) return [];
  const found = new Set<string>();
  const visit = (dir: string, remaining: number): void => {
    const listed = attempt(() => readdirSync(dir, { withFileTypes: true }));
    // 읽을 수 없는 디렉터리는 탐색하지 않는다. 그 아래 basename 항목은 후보에 오르지 않는다
    if (!listed.ok) return;
    for (const child of listed.value) {
      const full = posix.join(dir, child.name);
      if (child.isDirectory()) {
        if (remaining > 1) visit(full, remaining - 1);
        continue;
      }
      const hit = patterns.some(
        (item) => nameMatches(item.path, child.name) && !(item.except ?? []).includes(child.name),
      );
      if (hit) found.add(full);
    }
  };
  for (const root of roots) visit(root, depth);
  return [...found].toSorted();
}

/**
 * 보호 경로 안에 있는 쓰기 루트를 지운다(L0.sandbox.spec §3.3). denyWrite가 이기므로 결과는 같지만
 * 자동 허용 판정을 흐리지 않으려는 것이다. basename 항목은 파일 이름 규칙이라 쓰기 루트 판정에 쓰지 않는다.
 */
export function dropProtectedWriteRoots(
  roots: readonly string[],
  entries: readonly ProtectedPathEntry[],
): { readonly kept: string[]; readonly removed: string[] } {
  const pathEntries = entries.filter((item) => item.match !== "basename");
  const kept: string[] = [];
  const removed: string[] = [];
  for (const root of roots) {
    const hit = matchProtectedPath(pathEntries, root, "write");
    if (hit === undefined) kept.push(root);
    else removed.push(root);
  }
  return { kept, removed };
}
