import { readdirSync } from "node:fs";
import { posix } from "node:path";
import { attempt } from "@fresnel/contracts";
import {
  matchProtectedPath,
  type OsDirs,
  type ProtectedAccess,
  type ProtectedMatch,
  type ProtectedPathEntry,
  type SandboxPlatform,
} from "@fresnel/contracts/services";
import { canonicalizePath, toAbsolutePath } from "./paths.ts";

/** srt 자동 보호 경로 탐색 깊이 기본값(srt `mandatoryDenySearchDepth` 기본 3). basename 항목을 쓰기 루트 아래에서 찾을 때 쓴다 */
export const BASENAME_SEARCH_DEPTH = 3;

// L0.sandbox.spec §3.3. [결정: 2026-11-20, 사용자, AGE-63 "전체 허용, 막을 부분만 대화로 더한다"]
// 기본은 읽기를 막지 않는다. 자격 폴더·파일은 쓰기만 막고, 읽기까지 막을 것은 설정 `l0.sandbox.protectedPaths.extra`로 고른다.
// Fresnel 자신의 시크릿·데이터·설정은 읽기도 거부한다(아래 `secret_key`, `fresnel_data` 항목).

type Reason = ProtectedPathEntry["reason"];
type ProtectedDirs = Pick<OsDirs, "home" | "data" | "config">;

/** 제안 목록의 OS 구분. `all`은 모든 OS다 */
export type SuggestedOs = "all" | "darwin" | "linux";

/**
 * 제안 목록의 경로 한 줄. 기본으로는 쓰기만 막고, 설정 `l0.sandbox.protectedPaths.extra`에 `path`를 적으면 셸 도구와 파일 도구가
 * 읽기와 쓰기를 모두 막는다. `path`는 설정 값과 같은 모양이다(`~/…` 또는 절대 경로). 표시와 제안에 쓴다.
 */
export interface SuggestedProtectedPath {
  readonly path: string;
  readonly match: "exact" | "prefix";
  readonly reason: "credentials" | "agent_credentials";
  readonly os: SuggestedOs;
  /** 설정 화면이나 제안 문장에 쓰는 짧은 이름(영어) */
  readonly label: string;
}

/**
 * 제안 목록의 이름 패턴 한 줄(`.env`, `.env.*`). 기본으로는 쓰기만 막는다. 설정 `extra`는 경로만 받으므로 이 패턴은 거기서 고를 수 없다
 * (`appliesViaExtra`는 항상 거짓이다).
 */
export interface SuggestedNamePattern {
  readonly pattern: string;
  readonly except: readonly string[];
  readonly reason: "credentials";
  readonly label: string;
  readonly appliesViaExtra: false;
}

/**
 * 제안 목록: 이전 기본값에서 읽기를 막던 자격 경로다(L0.sandbox.spec §3.3). 기본 항목의 정본이다. 기본으로는 이 목록을 쓰기 전용으로 만들고,
 * 읽기까지 막으려면 사용자가 설정 `extra`에 적는다. CLI 인증 파일(`~/.npmrc` 등)은 원래 읽기를 허용했다. 막으려면 여기서 골라 `extra`에 적는다.
 * 브라우저 프로필과 메신저·메일 데이터는 없다(막지 않는다). 막으려면 `extra`에 직접 적는다.
 */
export const SUGGESTED_PROTECTED_PATHS: readonly SuggestedProtectedPath[] = [
  // 클라우드·배포 자격
  { path: "~/.ssh", match: "prefix", reason: "credentials", os: "all", label: "SSH keys" },
  { path: "~/.aws", match: "prefix", reason: "credentials", os: "all", label: "AWS credentials" },
  {
    path: "~/.kube",
    match: "prefix",
    reason: "credentials",
    os: "all",
    label: "Kubernetes config",
  },
  {
    path: "~/.config/gcloud",
    match: "prefix",
    reason: "credentials",
    os: "all",
    label: "Google Cloud credentials",
  },
  {
    path: "~/.azure",
    match: "prefix",
    reason: "credentials",
    os: "all",
    label: "Azure credentials",
  },
  {
    path: "~/.git-credentials",
    match: "exact",
    reason: "credentials",
    os: "all",
    label: "Git stored credentials",
  },
  { path: "~/.gnupg", match: "prefix", reason: "credentials", os: "all", label: "GnuPG keys" },
  {
    path: "~/.password-store",
    match: "prefix",
    reason: "credentials",
    os: "all",
    label: "pass password store",
  },
  {
    path: "~/.config/op",
    match: "prefix",
    reason: "credentials",
    os: "all",
    label: "1Password CLI",
  },
  { path: "~/.op", match: "prefix", reason: "credentials", os: "all", label: "1Password CLI data" },
  {
    path: "~/.config/glab-cli",
    match: "prefix",
    reason: "credentials",
    os: "all",
    label: "GitLab CLI tokens",
  },
  {
    path: "~/.cargo/credentials.toml",
    match: "exact",
    reason: "credentials",
    os: "all",
    label: "Cargo registry token",
  },
  {
    path: "~/.cargo/credentials",
    match: "exact",
    reason: "credentials",
    os: "all",
    label: "Cargo registry token (older)",
  },
  {
    path: "~/.gem/credentials",
    match: "exact",
    reason: "credentials",
    os: "all",
    label: "RubyGems key",
  },
  {
    path: "~/.terraform.d/credentials.tfrc.json",
    match: "exact",
    reason: "credentials",
    os: "all",
    label: "Terraform Cloud token",
  },
  // 다른 AI 하네스의 인증·토큰 폴더(`~/.claude`와 같은 기준)
  {
    path: "~/.claude",
    match: "prefix",
    reason: "agent_credentials",
    os: "all",
    label: "Claude Code tokens",
  },
  {
    path: "~/.codex",
    match: "prefix",
    reason: "agent_credentials",
    os: "all",
    label: "Codex tokens",
  },
  { path: "~/.pi", match: "prefix", reason: "agent_credentials", os: "all", label: "Pi tokens" },
  {
    path: "~/.gemini",
    match: "prefix",
    reason: "agent_credentials",
    os: "all",
    label: "Gemini CLI tokens",
  },
  {
    path: "~/.cursor",
    match: "prefix",
    reason: "agent_credentials",
    os: "all",
    label: "Cursor tokens",
  },
  {
    path: "~/.config/github-copilot",
    match: "prefix",
    reason: "agent_credentials",
    os: "all",
    label: "GitHub Copilot tokens",
  },
  {
    path: "~/.config/opencode",
    match: "prefix",
    reason: "agent_credentials",
    os: "all",
    label: "opencode config",
  },
  {
    path: "~/.local/share/opencode",
    match: "prefix",
    reason: "agent_credentials",
    os: "all",
    label: "opencode auth",
  },
  // CLI 인증 파일: 기본으로 읽을 수 있고 쓰기는 항상 막는다. 읽기도 막으려면 여기서 골라 `extra`에 적는다
  {
    path: "~/.config/gh",
    match: "prefix",
    reason: "credentials",
    os: "all",
    label: "GitHub CLI tokens",
  },
  { path: "~/.netrc", match: "exact", reason: "credentials", os: "all", label: "netrc logins" },
  {
    path: "~/.docker/config.json",
    match: "exact",
    reason: "credentials",
    os: "all",
    label: "Docker registry logins",
  },
  {
    path: "~/.npmrc",
    match: "exact",
    reason: "credentials",
    os: "all",
    label: "npm registry tokens",
  },
  {
    path: "~/.pypirc",
    match: "exact",
    reason: "credentials",
    os: "all",
    label: "PyPI upload tokens",
  },
  // macOS: 키체인, 쿠키, 비밀번호 관리자
  {
    path: "/Library/Keychains",
    match: "prefix",
    reason: "credentials",
    os: "darwin",
    label: "System keychains",
  },
  {
    path: "~/Library/Keychains",
    match: "prefix",
    reason: "credentials",
    os: "darwin",
    label: "Login keychain",
  },
  {
    path: "~/Library/Cookies",
    match: "prefix",
    reason: "credentials",
    os: "darwin",
    label: "Cookie store",
  },
  {
    path: "~/Library/Application Support/1Password",
    match: "prefix",
    reason: "credentials",
    os: "darwin",
    label: "1Password data",
  },
  {
    path: "~/Library/Application Support/Bitwarden",
    match: "prefix",
    reason: "credentials",
    os: "darwin",
    label: "Bitwarden data",
  },
  {
    path: "~/Library/Application Support/KeePassXC",
    match: "prefix",
    reason: "credentials",
    os: "darwin",
    label: "KeePassXC data",
  },
  {
    path: "~/Library/Group Containers/2BUA8C4S2C.com.1password",
    match: "prefix",
    reason: "credentials",
    os: "darwin",
    label: "1Password group container",
  },
  {
    path: "~/Library/Containers/com.1password.1password",
    match: "prefix",
    reason: "credentials",
    os: "darwin",
    label: "1Password container",
  },
  // Linux: 비밀번호 관리자와 키링
  {
    path: "~/.config/1Password",
    match: "prefix",
    reason: "credentials",
    os: "linux",
    label: "1Password data",
  },
  {
    path: "~/.config/Bitwarden",
    match: "prefix",
    reason: "credentials",
    os: "linux",
    label: "Bitwarden data",
  },
  {
    path: "~/.config/KeePassXC",
    match: "prefix",
    reason: "credentials",
    os: "linux",
    label: "KeePassXC data",
  },
  {
    path: "~/.config/keepassxc",
    match: "prefix",
    reason: "credentials",
    os: "linux",
    label: "KeePassXC data (lowercase)",
  },
  {
    path: "~/.local/share/keyrings",
    match: "prefix",
    reason: "credentials",
    os: "linux",
    label: "Keyring",
  },
  {
    path: "~/.local/share/kwalletd",
    match: "prefix",
    reason: "credentials",
    os: "linux",
    label: "KWallet",
  },
];

/** 제안 목록의 이름 패턴. 기본으로 쓰기만 막는다(L0.sandbox.spec §3.3). 설정 `extra`로는 고를 수 없다 */
export const SUGGESTED_NAME_PATTERNS: readonly SuggestedNamePattern[] = [
  {
    pattern: ".env",
    except: [".env.example"],
    reason: "credentials",
    label: "Environment file (.env)",
    appliesViaExtra: false,
  },
  {
    pattern: ".env.*",
    except: [".env.example"],
    reason: "credentials",
    label: "Environment files (.env.*)",
    appliesViaExtra: false,
  },
];

/**
 * 이 OS에서 제안되는 경로 줄. darwin은 `all`과 `darwin`, linux와 wsl2는 `all`과 `linux`, 그 밖의 OS는 `all`만이다.
 * 설정 화면과 나중의 도구(제안하기)가 쓴다. 표 전체는 `SUGGESTED_PROTECTED_PATHS`다.
 */
export function suggestedProtectedPaths(
  platform: SandboxPlatform,
): readonly SuggestedProtectedPath[] {
  const os =
    platform === "darwin"
      ? "darwin"
      : platform === "linux" || platform === "wsl2"
        ? "linux"
        : undefined;
  return SUGGESTED_PROTECTED_PATHS.filter((row) => row.os === "all" || row.os === os);
}

/** 기본 항목의 경로(`~/…` 또는 절대 경로)를 이 기기의 정규 절대 경로로 푼다 */
function resolveSuggested(path: string, home: string): string {
  return canonicalizePath(toAbsolutePath(path, home, "/"));
}

/** 제안 줄 하나를 쓰기 전용 기본 항목으로 만든다 */
function writeOnlyEntry(row: SuggestedProtectedPath, home: string): ProtectedPathEntry {
  return {
    path: resolveSuggested(row.path, home),
    match: row.match,
    access: "write",
    reason: row.reason,
  };
}

/**
 * provider가 쓰는 OS별 제안 항목(쓰기 전용). 공통 줄(`all`)은 `buildProtectedPaths`가 만든다.
 * 여기 있는 줄과 `SUGGESTED_PROTECTED_PATHS`가 같은 표이므로 OS별 목록을 두 곳에 적지 않는다.
 */
export function osCredentialEntries(home: string, os: "darwin" | "linux"): ProtectedPathEntry[] {
  return SUGGESTED_PROTECTED_PATHS.filter((row) => row.os === os).map((row) =>
    writeOnlyEntry(row, home),
  );
}

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
  /** SandboxProvider.defaultProtectedPaths(dirs). OS별 쓰기 전용 자격 항목과 지속 실행 등록 */
  readonly providerEntries: readonly ProtectedPathEntry[];
  /** SecretService.protectedPaths(): 시크릿 파일 절대 경로. 값 없음 */
  readonly secretPaths: readonly string[];
  /** 부모 env의 SOPS_AGE_KEY_FILE */
  readonly ageKeyFileEnv: string | undefined;
  /** l0.sandbox.protectedPaths.extra를 resolveExtraPaths로 푼 값. 읽기와 쓰기를 모두 막는다 */
  readonly extraPaths: readonly string[];
}

/** 홈 아래 기본 쓰기 전용 항목이 쓰는 셸 시작 파일(쓰기 거부, 읽기 허용) */
const SHELL_STARTUP_FILES = [
  ".bashrc",
  ".bash_profile",
  ".zshrc",
  ".zprofile",
  ".zshenv",
  ".profile",
  ".gitconfig",
] as const;

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
 * 기본 보호 경로(공통 표 + provider 항목 + 시크릿 경로 + 설정 추가분). 작업 공간 root별 git 항목은 제외한다.
 * 더 구체적인 항목(시크릿)을 앞에 둔다. matchProtectedPath는 맞는 첫 항목을 돌려주기 때문이다.
 * 읽기 거부는 `read_write` 항목만 만든다. `write` 항목은 쓰기만 막는다(자격 폴더의 기본 상태).
 */
export function buildProtectedPaths(input: ProtectedPathInput): readonly ProtectedPathEntry[] {
  const { home, data, config } = input.dirs;
  const entries: ProtectedPathEntry[] = [
    // 시크릿: Fresnel 자신의 것이라 읽기도 거부한다
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
    // Fresnel 데이터와 설정
    pathEntry(data, "prefix", "read_write", "fresnel_data"),
    pathEntry(config, "prefix", "write", "fresnel_config"),
    // 자격 경로(제안 목록의 공통 줄)와 이름 패턴: 기본은 쓰기만 막는다
    ...SUGGESTED_PROTECTED_PATHS.filter((row) => row.os === "all").map((row) =>
      writeOnlyEntry(row, home),
    ),
    ...SUGGESTED_NAME_PATTERNS.map((pattern) =>
      entry(pattern.pattern, "basename", "write", pattern.reason, pattern.except),
    ),
    // 셸 시작 파일
    ...SHELL_STARTUP_FILES.map((name) =>
      pathEntry(posix.join(home, name), "exact", "write", "shell_startup"),
    ),
    // 지속 실행 등록
    pathEntry(posix.join(home, ".local", "bin"), "prefix", "write", "persistence"),
    ...input.providerEntries,
    // 설정 추가분: 읽기와 쓰기를 모두 막는다
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

/** `expandBasenameEntries`의 결과. 두 목록 모두 정렬되어 있고 중복이 없다 */
export interface BasenameExpansion {
  /** 읽기도 거부하는 파일(`read_write` 이름 항목이 맞은 것) */
  readonly readFiles: string[];
  /** 쓰기를 거부하는 파일(읽기 전용 이름 항목이 맞은 것을 포함한 모든 맞은 파일) */
  readonly writeFiles: string[];
}

/**
 * basename 항목을 쓰기 루트 아래 파일의 리터럴 경로로 바꾼다. 깊이 `depth`까지 훑고 심볼릭 링크 디렉터리는 따라가지 않는다.
 * 실행 중 새로 생긴 파일은 덮지 못한다(L0.sandbox.spec §5.1). 한 번 훑어 읽기 거부 파일과 쓰기 거부 파일을 함께 돌려준다.
 */
export function expandBasenameEntries(
  entries: readonly ProtectedPathEntry[],
  roots: readonly string[],
  depth: number,
): BasenameExpansion {
  const patterns = entries.filter((item) => item.match === "basename");
  const readFiles = new Set<string>();
  const writeFiles = new Set<string>();
  if (patterns.length === 0) return { readFiles: [], writeFiles: [] };
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
      const hits = patterns.filter(
        (item) => nameMatches(item.path, child.name) && !(item.except ?? []).includes(child.name),
      );
      if (hits.length === 0) continue;
      writeFiles.add(full);
      if (hits.some((item) => item.access === "read_write")) readFiles.add(full);
    }
  };
  for (const root of roots) visit(root, depth);
  return { readFiles: [...readFiles].toSorted(), writeFiles: [...writeFiles].toSorted() };
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
