import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { matchProtectedPath, type ProtectedPathEntry } from "@fresnel/contracts/services";
import {
  SUGGESTED_NAME_PATTERNS,
  SUGGESTED_PROTECTED_PATHS,
  buildProtectedPaths,
  dropProtectedWriteRoots,
  expandBasenameEntries,
  gitProtectedEntries,
  resolveExtraPaths,
  suggestedProtectedPaths,
  withGitEntries,
} from "../src/protected-paths.ts";
import { selectSandboxProvider } from "../src/select.ts";
import { createSandboxService } from "../src/service.ts";
import {
  darwinPlatform,
  fakeOs,
  fakeSrt,
  linuxPlatform,
  makeTestDirs,
  NO_CANCEL,
  recordingShell,
  settingsOf,
  type TestDirs,
} from "./support/fakes.ts";

function build(
  dirs: TestDirs,
  overrides: Partial<Parameters<typeof buildProtectedPaths>[0]> = {},
): readonly ProtectedPathEntry[] {
  return buildProtectedPaths({
    dirs,
    providerEntries: [],
    secretPaths: [],
    ageKeyFileEnv: undefined,
    extraPaths: [],
    scope: "narrow",
    ...overrides,
  });
}

function find(
  entries: readonly ProtectedPathEntry[],
  path: string,
): ProtectedPathEntry | undefined {
  return entries.find((entry) => entry.path === path);
}

describe("protected paths", () => {
  test("default table has the Fresnel rows with the documented access and reasons", () => {
    const dirs = makeTestDirs();
    const entries = build(dirs);
    expect(find(entries, dirs.data)).toMatchObject({
      match: "prefix",
      access: "read_write",
      reason: "fresnel_data",
    });
    expect(find(entries, dirs.config)).toMatchObject({
      match: "prefix",
      access: "write",
      reason: "fresnel_config",
    });
    // 자격 폴더는 기본으로 쓰기만 막는다(읽기는 설정 extra로 막는다)
    expect(find(entries, join(dirs.home, ".ssh"))).toMatchObject({
      access: "write",
      reason: "credentials",
    });
    expect(find(entries, join(dirs.home, ".claude"))).toMatchObject({
      reason: "agent_credentials",
    });
    expect(find(entries, join(dirs.home, ".zshrc"))).toMatchObject({
      match: "exact",
      access: "write",
      reason: "shell_startup",
    });
    expect(find(entries, join(dirs.home, ".local", "bin"))).toMatchObject({
      access: "write",
      reason: "persistence",
    });
    expect(find(entries, join(dirs.home, ".docker", "config.json"))).toMatchObject({
      match: "exact",
    });
    const env = entries.filter((entry) => entry.match === "basename");
    expect(env.map((entry) => entry.path)).toEqual([".env", ".env.*"]);
    expect(env.every((entry) => entry.except?.includes(".env.example") === true)).toBe(true);
  });

  test("protected paths cannot be reduced by settings or by empty caller deny lists", async () => {
    const dirs = makeTestDirs();
    // 설정 추가분이 비어 있어도 기본 항목이 모두 있다
    const defaults = build(dirs);
    expect(defaults.length).toBeGreaterThan(20);
    // 서비스 수준: 호출자가 readDeny·writeDeny를 비워도 유효 정책에 기본 항목이 모두 들어간다
    const srt = fakeSrt();
    const service = await createSandboxService(
      {
        os: fakeOs(dirs),
        settings: () => settingsOf({ protectedPathsExtra: [] }),
        srt,
        platform: linuxPlatform(),
        parentEnv: () => ({}),
      },
      new AbortController().signal,
    );
    const emptied = {
      ...service.defaultPolicy({ workspaceRoots: [dirs.workspace], tempDir: dirs.tmp }),
      readDeny: [],
      writeDeny: [],
    };
    const result = await service
      .wrapShell(recordingShell(), emptied)
      .exec("true", { cwd: dirs.workspace }, NO_CANCEL);
    expect(result.ok).toBe(true);
    const fs = srt.wrapCalls[0]?.customConfig.filesystem;
    const denyRead = (fs?.denyRead ?? []).map(String);
    const denyWrite = (fs?.denyWrite ?? []).map(String);
    for (const entry of defaults) {
      if (entry.match === "basename") continue;
      if (entry.access === "read_write") expect(denyRead).toContain(entry.path);
      expect(denyWrite).toContain(entry.path);
    }
    // 작업 공간 git 실행 경로도 들어간다
    expect(denyWrite).toContain(join(dirs.workspace, ".git", "hooks"));
    expect(denyWrite).toContain(join(dirs.workspace, ".git", "config"));
  });

  test("protected paths extra adds entries as read_write user_extra", () => {
    const dirs = makeTestDirs();
    const { resolved, rejected } = resolveExtraPaths(
      ["~/vault", join(dirs.root, "other"), "relative/dir"],
      dirs.home,
    );
    expect(rejected).toEqual(["relative/dir"]);
    expect(resolved).toEqual([join(dirs.home, "vault"), join(dirs.root, "other")]);
    const entries = build(dirs, { extraPaths: resolved });
    const extra = entries.filter((entry) => entry.reason === "user_extra");
    expect(extra.map((entry) => entry.path)).toEqual([...resolved]);
    expect(extra.every((entry) => entry.access === "read_write")).toBe(true);
    expect(matchProtectedPath(entries, join(dirs.home, "vault", "x.txt"), "read")?.reason).toBe(
      "user_extra",
    );
  });

  test("protected paths include secret files", () => {
    const dirs = makeTestDirs();
    const sopsFile = join(dirs.root, "elsewhere", "secrets.sops.yaml");
    const ageKey = join(dirs.root, "keys", "age.txt");
    const entries = build(dirs, { secretPaths: [sopsFile, "not-absolute"], ageKeyFileEnv: ageKey });
    const secrets = join(dirs.config, "secrets");
    expect(find(entries, secrets)).toMatchObject({ access: "read_write", reason: "secret_key" });
    expect(find(entries, sopsFile)).toMatchObject({ access: "read_write", reason: "secret_key" });
    expect(find(entries, ageKey)).toMatchObject({
      match: "exact",
      access: "read_write",
      reason: "secret_key",
    });
    expect(find(entries, join(dirs.home, ".config", "sops"))).toMatchObject({
      reason: "secret_key",
    });
    expect(entries.some((entry) => entry.path === "not-absolute")).toBe(false);
    // 시크릿 항목은 <config> 항목보다 앞에 있어 읽기 거부 사유가 secret_key로 나온다
    expect(matchProtectedPath(entries, join(secrets, "age", "keys.txt"), "read")?.reason).toBe(
      "secret_key",
    );
    expect(matchProtectedPath(entries, join(dirs.config, "settings.json"), "read")).toBeUndefined();
    expect(matchProtectedPath(entries, join(dirs.config, "settings.json"), "write")?.reason).toBe(
      "fresnel_config",
    );
  });

  test("protected paths use OS dirs and the provider rows", () => {
    const dirs = makeTestDirs();
    const darwin = selectSandboxProvider(darwinPlatform());
    const linux = selectSandboxProvider(linuxPlatform());
    const onDarwin = build(dirs, { providerEntries: darwin.defaultProtectedPaths(dirs) });
    const onLinux = build(dirs, { providerEntries: linux.defaultProtectedPaths(dirs) });
    const launchAgents = join(dirs.home, "Library", "LaunchAgents");
    const systemd = join(dirs.home, ".config", "systemd", "user");
    expect(find(onDarwin, launchAgents)).toBeDefined();
    expect(find(onDarwin, systemd)).toBeUndefined();
    expect(find(onLinux, systemd)).toBeDefined();
    expect(find(onLinux, launchAgents)).toBeUndefined();
    // 데이터·설정 디렉터리는 입력 OsDirs를 따른다
    const other = makeTestDirs();
    expect(find(build(other), other.data)).toBeDefined();
    expect(find(build(other), dirs.data)).toBeUndefined();
  });

  test("git entries are added per workspace root", () => {
    const dirs = makeTestDirs();
    const entries = gitProtectedEntries([dirs.workspace]);
    expect(entries.map((entry) => entry.path)).toEqual([
      join(dirs.workspace, ".git", "config"),
      join(dirs.workspace, ".git", "config.worktree"),
      join(dirs.workspace, ".git", "info", "attributes"),
      join(dirs.workspace, ".git", "hooks"),
      join(dirs.workspace, ".gitmodules"),
    ]);
    expect(entries.every((entry) => entry.access === "write" && entry.reason === "git_exec")).toBe(
      true,
    );
    const merged = withGitEntries(build(dirs), [dirs.workspace]);
    expect(
      matchProtectedPath(merged, join(dirs.workspace, ".git", "hooks", "pre-commit"), "write")
        ?.reason,
    ).toBe("git_exec");
    expect(
      matchProtectedPath(merged, join(dirs.workspace, ".git", "hooks", "pre-commit"), "read"),
    ).toBeUndefined();
  });

  test("basename entries expand with exceptions and honor the depth limit", () => {
    const dirs = makeTestDirs();
    const root = dirs.workspace;
    mkdirSync(join(root, "a", "b", "c"), { recursive: true });
    writeFileSync(join(root, ".env"), "X=1");
    writeFileSync(join(root, ".env.local"), "X=1");
    writeFileSync(join(root, ".env.example"), "X=");
    writeFileSync(join(root, "a", ".env.production"), "X=1");
    writeFileSync(join(root, "a", "b", ".env"), "X=1");
    writeFileSync(join(root, "a", "b", "c", ".env"), "X=1");
    writeFileSync(join(root, "environment.txt"), "x");
    const entries = build(dirs);
    // 기본 `.env` 항목은 쓰기만 막으므로 읽기 목록은 비고, 쓰기 목록에 든다
    const depth3 = expandBasenameEntries(entries, [root], 3);
    expect(depth3.writeFiles).toEqual(
      [
        join(root, ".env"),
        join(root, ".env.local"),
        join(root, "a", ".env.production"),
        join(root, "a", "b", ".env"),
      ].toSorted(),
    );
    expect(depth3.readFiles).toEqual([]);
    expect(expandBasenameEntries(entries, [root], 1).writeFiles).toEqual([
      join(root, ".env"),
      join(root, ".env.local"),
    ]);
    expect(expandBasenameEntries([], [root], 3)).toEqual({
      readFiles: [],
      writeFiles: [],
      truncated: false,
    });
  });

  test("a name pattern that is read-denied lands in both lists, a write-only one only in the write list", () => {
    const dirs = makeTestDirs();
    const root = dirs.workspace;
    writeFileSync(join(root, ".env"), "X=1");
    writeFileSync(join(root, ".env.example"), "X=");
    const readDenied: ProtectedPathEntry = {
      path: ".env",
      match: "basename",
      access: "read_write",
      reason: "user_extra",
      except: [".env.example"],
    };
    const both = expandBasenameEntries([readDenied], [root], 1);
    expect(both.readFiles).toEqual([join(root, ".env")]);
    expect(both.writeFiles).toEqual([join(root, ".env")]);
    const writeOnly = expandBasenameEntries(build(dirs), [root], 1);
    expect(writeOnly.readFiles).toEqual([]);
    expect(writeOnly.writeFiles).toEqual([join(root, ".env")]);
  });

  test("a write root inside a protected path is removed", () => {
    const dirs = makeTestDirs();
    const entries = withGitEntries(build(dirs), [dirs.workspace]);
    const roots = [
      dirs.workspace,
      join(dirs.data, "blobs"),
      join(dirs.workspace, ".git", "hooks"),
      join(dirs.home, ".ssh"),
    ];
    const { kept, removed } = dropProtectedWriteRoots(roots, entries);
    expect(kept).toEqual([dirs.workspace]);
    expect(removed).toEqual(roots.slice(1));
  });

  test("a write root that merely shares a name prefix with a protected path is kept", () => {
    const dirs = makeTestDirs();
    const entries = build(dirs);
    const lookalike = `${dirs.data}-copy`;
    expect(dropProtectedWriteRoots([lookalike], entries).kept).toEqual([lookalike]);
  });

  test("service removes protected write roots and warns", async () => {
    const dirs = makeTestDirs();
    const os = fakeOs(dirs);
    const service = await createSandboxService(
      {
        os,
        settings: () => settingsOf(),
        srt: fakeSrt(),
        platform: linuxPlatform(),
        parentEnv: () => ({}),
      },
      new AbortController().signal,
    );
    const policy = service.defaultPolicy({
      workspaceRoots: [dirs.workspace, dirs.data],
      tempDir: dirs.tmp,
    });
    expect(policy.writeRoots).toEqual([dirs.workspace, dirs.tmp].toSorted());
    expect(os.log.entries.some((entry) => entry.event === "sandbox.write_root_removed")).toBe(true);
    expect(policy.readDeny).toContain(dirs.data);
    expect(policy.writeDeny).toContain(dirs.config);
    expect(
      service
        .protectedPaths([dirs.workspace])
        .some((entry) => entry.path === join(dirs.workspace, ".git", "hooks")),
    ).toBe(true);
  });
});

describe("matchProtectedPath decides by access", () => {
  test("write-only entries do not match reads and prefix compares by path segment", () => {
    const dirs = makeTestDirs();
    const entries = build(dirs);
    expect(matchProtectedPath(entries, join(dirs.home, ".zshrc"), "read")).toBeUndefined();
    expect(matchProtectedPath(entries, join(dirs.home, ".zshrc"), "write")?.reason).toBe(
      "shell_startup",
    );
    expect(matchProtectedPath(entries, join(dirs.home, ".sshd"), "read")).toBeUndefined();
    expect(matchProtectedPath(entries, join(dirs.home, ".sshd"), "write")).toBeUndefined();
    expect(
      matchProtectedPath(entries, join(dirs.home, ".ssh", "id_ed25519"), "read"),
    ).toBeUndefined();
    expect(
      matchProtectedPath(entries, join(dirs.home, ".ssh", "id_ed25519"), "write")?.reason,
    ).toBe("credentials");
    expect(matchProtectedPath(entries, join(dirs.workspace, ".env"), "read")).toBeUndefined();
    expect(matchProtectedPath(entries, join(dirs.workspace, ".env"), "write")?.reason).toBe(
      "credentials",
    );
    expect(
      matchProtectedPath(entries, join(dirs.workspace, ".env.example"), "write"),
    ).toBeUndefined();
  });
});

describe("secret folders are write-only in the default table (AGE-63)", () => {
  const common = [
    join(".gnupg", "private-keys-v1.d", "k"),
    join(".password-store", "a.gpg"),
    join(".azure", "accessTokens.json"),
    join(".config", "op", "config"),
    join(".cargo", "credentials.toml"),
    join(".terraform.d", "credentials.tfrc.json"),
  ];
  const agents = [
    join(".gemini", "oauth_creds.json"),
    join(".cursor", "mcp.json"),
    join(".local", "share", "opencode", "auth.json"),
  ];
  const mac = [
    join("Library", "Keychains", "login.keychain-db"),
    join("Library", "Application Support", "1Password", "data", "a.sqlite"),
    join("Library", "Application Support", "Bitwarden", "data.json"),
  ];
  const linux = [
    join(".local", "share", "keyrings", "login.keyring"),
    join(".config", "1Password", "settings", "s.json"),
    join(".config", "Bitwarden", "data.json"),
  ];
  // 브라우저 프로필과 메신저·메일은 기본으로 막지 않는다 [결정: 2026-11-20, 사용자, AGE-63]
  const macOpen = [
    join("Library", "Application Support", "Google", "Chrome", "Default", "Cookies"),
    join("Library", "Application Support", "Firefox", "Profiles", "p", "logins.json"),
    join("Library", "Application Support", "Arc", "User Data", "Default", "History"),
    join("Library", "Application Support", "Slack", "storage", "a"),
    join("Library", "Mail", "V10", "a.emlx"),
  ];
  const linuxOpen = [
    join(".config", "google-chrome", "Default", "Login Data"),
    join(".mozilla", "firefox", "p", "key4.db"),
    join(".config", "BraveSoftware", "Brave-Browser", "Default", "Cookies"),
    join(".config", "Signal", "sql", "db.sqlite"),
    join(".thunderbird", "p", "a"),
  ];

  test("browser profiles and messenger or mail data are not in the default table on either OS", () => {
    const dirs = makeTestDirs();
    const darwin = build(dirs, {
      providerEntries: selectSandboxProvider(darwinPlatform()).defaultProtectedPaths(dirs),
    });
    for (const name of macOpen) {
      expect(matchProtectedPath(darwin, join(dirs.home, name), "read")).toBeUndefined();
      expect(matchProtectedPath(darwin, join(dirs.home, name), "write")).toBeUndefined();
    }
    const onLinux = build(dirs, {
      providerEntries: selectSandboxProvider(linuxPlatform()).defaultProtectedPaths(dirs),
    });
    for (const name of linuxOpen) {
      expect(matchProtectedPath(onLinux, join(dirs.home, name), "read")).toBeUndefined();
      expect(matchProtectedPath(onLinux, join(dirs.home, name), "write")).toBeUndefined();
    }
  });

  test("the default table denies reads only for Fresnel's own paths: no credential row is read-denied", () => {
    const dirs = makeTestDirs();
    for (const platform of [darwinPlatform(), linuxPlatform()]) {
      const entries = build(dirs, {
        providerEntries: selectSandboxProvider(platform).defaultProtectedPaths(dirs),
      });
      const readReasons = entries
        .filter((entry) => entry.access === "read_write")
        .map((entry) => entry.reason);
      expect([...new Set(readReasons)].toSorted()).toEqual(["fresnel_data", "secret_key"]);
    }
  });

  test("the common rows are readable and not writable on every OS", () => {
    const dirs = makeTestDirs();
    for (const providerEntries of [
      selectSandboxProvider(darwinPlatform()).defaultProtectedPaths(dirs),
      selectSandboxProvider(linuxPlatform()).defaultProtectedPaths(dirs),
    ]) {
      const entries = build(dirs, { providerEntries });
      for (const name of common) {
        expect(matchProtectedPath(entries, join(dirs.home, name), "read")).toBeUndefined();
        expect(matchProtectedPath(entries, join(dirs.home, name), "write")?.reason).toBe(
          "credentials",
        );
      }
      for (const name of agents) {
        expect(matchProtectedPath(entries, join(dirs.home, name), "read")).toBeUndefined();
        expect(matchProtectedPath(entries, join(dirs.home, name), "write")?.reason).toBe(
          "agent_credentials",
        );
      }
    }
  });

  test("tools still read their plain config: only the credential file of cargo and terraform is listed", () => {
    const dirs = makeTestDirs();
    const entries = build(dirs);
    for (const name of [
      join(".cargo", "config.toml"),
      join(".cargo", "bin", "rustc"),
      join(".terraform.d", "plugins", "p"),
      ".gitconfig",
    ]) {
      expect(matchProtectedPath(entries, join(dirs.home, name), "read")).toBeUndefined();
    }
  });

  test("macOS rows come from the darwin provider, Linux rows from the linux provider; both are write-only", () => {
    const dirs = makeTestDirs();
    const onDarwin = build(dirs, {
      providerEntries: selectSandboxProvider(darwinPlatform()).defaultProtectedPaths(dirs),
    });
    const onLinux = build(dirs, {
      providerEntries: selectSandboxProvider(linuxPlatform()).defaultProtectedPaths(dirs),
    });
    for (const name of mac) {
      expect(matchProtectedPath(onDarwin, join(dirs.home, name), "read")).toBeUndefined();
      expect(matchProtectedPath(onDarwin, join(dirs.home, name), "write")?.reason).toBe(
        "credentials",
      );
      expect(matchProtectedPath(onLinux, join(dirs.home, name), "write")).toBeUndefined();
    }
    for (const name of linux) {
      expect(matchProtectedPath(onLinux, join(dirs.home, name), "read")).toBeUndefined();
      expect(matchProtectedPath(onLinux, join(dirs.home, name), "write")?.reason).toBe(
        "credentials",
      );
      expect(matchProtectedPath(onDarwin, join(dirs.home, name), "write")).toBeUndefined();
    }
    // 시스템 키체인은 홈 밖 절대 경로다
    expect(
      matchProtectedPath(onDarwin, "/Library/Keychains/System.keychain", "read"),
    ).toBeUndefined();
    expect(
      matchProtectedPath(onDarwin, "/Library/Keychains/System.keychain", "write")?.reason,
    ).toBe("credentials");
    expect(
      matchProtectedPath(onLinux, "/Library/Keychains/System.keychain", "write"),
    ).toBeUndefined();
  });

  test("protectedPaths.extra still adds on top of the default table, and a listed secret folder is read-denied", () => {
    const dirs = makeTestDirs();
    const extra = join(dirs.home, "vault");
    const entries = build(dirs, { extraPaths: [extra] });
    expect(matchProtectedPath(entries, join(extra, "x"), "read")?.reason).toBe("user_extra");
    expect(matchProtectedPath(entries, join(dirs.home, ".gnupg", "x"), "read")).toBeUndefined();
    const listed = build(dirs, { extraPaths: [join(dirs.home, ".gnupg")] });
    expect(matchProtectedPath(listed, join(dirs.home, ".gnupg", "x"), "read")?.reason).toBe(
      "user_extra",
    );
  });
});

describe("suggested protected paths (AGE-63 layer B will offer these)", () => {
  test("every row is a ~/ or absolute path with a label, and the name patterns are never added through extra", () => {
    for (const row of SUGGESTED_PROTECTED_PATHS) {
      expect(row.path === "~" || row.path.startsWith("~/") || row.path.startsWith("/")).toBe(true);
      expect(row.label.length).toBeGreaterThan(0);
    }
    expect(SUGGESTED_NAME_PATTERNS.map((item) => [item.pattern, item.appliesViaExtra])).toEqual([
      [".env", false],
      [".env.*", false],
    ]);
  });

  test("the OS filter gives darwin the keychain rows, linux the keyring rows, and other OSes only the shared rows", () => {
    const onDarwin = suggestedProtectedPaths("darwin").map((row) => row.path);
    expect(onDarwin).toContain("/Library/Keychains");
    expect(onDarwin).toContain("~/Library/Keychains");
    expect(onDarwin).not.toContain("~/.local/share/keyrings");
    const onLinux = suggestedProtectedPaths("linux").map((row) => row.path);
    expect(onLinux).toContain("~/.local/share/keyrings");
    expect(onLinux).not.toContain("/Library/Keychains");
    expect(suggestedProtectedPaths("wsl2").map((row) => row.path)).toEqual(onLinux);
    const shared = SUGGESTED_PROTECTED_PATHS.filter((row) => row.os === "all").map(
      (row) => row.path,
    );
    expect(suggestedProtectedPaths("win32").map((row) => row.path)).toEqual(shared);
    expect(shared).toContain("~/.ssh");
    expect(shared).toContain("~/.npmrc");
  });

  test("the default table holds every applicable row as write-only, so no suggested row is read-denied by default", () => {
    const dirs = makeTestDirs();
    for (const platform of [darwinPlatform(), linuxPlatform()]) {
      const provider = selectSandboxProvider(platform);
      const entries = build(dirs, { providerEntries: provider.defaultProtectedPaths(dirs) });
      for (const row of suggestedProtectedPaths(provider.platform)) {
        const [resolved = ""] = resolveExtraPaths([row.path], dirs.home).resolved;
        const target = row.match === "exact" ? resolved : join(resolved, "probe");
        expect(matchProtectedPath(entries, target, "read")).toBeUndefined();
        expect(matchProtectedPath(entries, target, "write")?.reason).toBe(row.reason);
      }
    }
  });

  test("adding every applicable row to protectedPaths.extra denies reading and writing it", () => {
    const dirs = makeTestDirs();
    for (const platform of [darwinPlatform(), linuxPlatform()]) {
      const provider = selectSandboxProvider(platform);
      const rows = suggestedProtectedPaths(provider.platform);
      const { resolved } = resolveExtraPaths(
        rows.map((row) => row.path),
        dirs.home,
      );
      const entries = build(dirs, {
        providerEntries: provider.defaultProtectedPaths(dirs),
        extraPaths: resolved,
      });
      for (const row of rows) {
        const [path = ""] = resolveExtraPaths([row.path], dirs.home).resolved;
        const target = row.match === "exact" ? path : join(path, "probe");
        expect(matchProtectedPath(entries, target, "read")?.reason).toBe("user_extra");
        expect(matchProtectedPath(entries, target, "write")).toBeDefined();
      }
    }
  });
});

describe("CLI auth files, keys and cloud credentials (M3-REQ-55, AGE-63)", () => {
  const writeOnly = [
    ".npmrc",
    ".netrc",
    ".pypirc",
    join(".docker", "config.json"),
    join(".config", "gh", "hosts.yml"),
  ];
  const keysAndCloud = [
    join(".ssh", "id_ed25519"),
    join(".aws", "credentials"),
    ".git-credentials",
  ];

  test("by default CLI auth files, keys and cloud credentials are readable but not writable", () => {
    const dirs = makeTestDirs();
    const entries = build(dirs);
    for (const name of [...writeOnly, ...keysAndCloud]) {
      const path = join(dirs.home, name);
      expect(matchProtectedPath(entries, path, "read")).toBeUndefined();
      expect(matchProtectedPath(entries, path, "write")?.reason).toBe("credentials");
    }
  });

  test("listing a CLI auth file in protectedPaths.extra denies reading and writing it", () => {
    const dirs = makeTestDirs();
    const { resolved } = resolveExtraPaths(["~/.npmrc", "~/.config/gh"], dirs.home);
    const entries = build(dirs, { extraPaths: resolved });
    expect(matchProtectedPath(entries, join(dirs.home, ".npmrc"), "read")?.reason).toBe(
      "user_extra",
    );
    expect(matchProtectedPath(entries, join(dirs.home, ".npmrc"), "write")).toBeDefined();
    expect(
      matchProtectedPath(entries, join(dirs.home, ".config", "gh", "hosts.yml"), "read")?.reason,
    ).toBe("user_extra");
    // 목록에 없는 것은 그대로 읽힌다
    expect(matchProtectedPath(entries, join(dirs.home, ".netrc"), "read")).toBeUndefined();
  });

  test("the service's default policy follows protectedPaths.extra", async () => {
    const dirs = makeTestDirs();
    const npmrc = join(dirs.home, ".npmrc");
    const ssh = join(dirs.home, ".ssh");
    const make = async (extra: string[]) => {
      const service = await createSandboxService(
        {
          os: fakeOs(dirs),
          settings: () => settingsOf({ protectedPathsExtra: extra }),
          srt: fakeSrt(),
          platform: linuxPlatform(),
          parentEnv: () => ({}),
        },
        new AbortController().signal,
      );
      return service.defaultPolicy({ workspaceRoots: [dirs.workspace], tempDir: dirs.tmp });
    };
    const plain = await make([]);
    expect(plain.readDeny).not.toContain(npmrc);
    expect(plain.readDeny).not.toContain(ssh);
    expect(plain.writeDeny).toContain(npmrc);
    expect(plain.writeDeny).toContain(ssh);
    const listed = await make(["~/.npmrc"]);
    expect(listed.readDeny).toContain(npmrc);
    expect(listed.writeDeny).toContain(npmrc);
    expect(listed.readDeny).not.toContain(ssh);
  });
});
