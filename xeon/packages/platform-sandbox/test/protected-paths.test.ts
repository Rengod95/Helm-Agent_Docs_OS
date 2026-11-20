import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { matchProtectedPath, type ProtectedPathEntry } from "@fresnel/contracts/services";
import {
  buildProtectedPaths,
  dropProtectedWriteRoots,
  expandBasenameEntries,
  gitProtectedEntries,
  resolveExtraPaths,
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
    credentialReadAllowed: true,
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
    expect(find(entries, join(dirs.home, ".ssh"))).toMatchObject({
      access: "read_write",
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
    const depth3 = expandBasenameEntries(entries, [root], 3);
    expect(depth3).toEqual(
      [
        join(root, ".env"),
        join(root, ".env.local"),
        join(root, "a", ".env.production"),
        join(root, "a", "b", ".env"),
      ].toSorted(),
    );
    expect(expandBasenameEntries(entries, [root], 1)).toEqual([
      join(root, ".env"),
      join(root, ".env.local"),
    ]);
    expect(expandBasenameEntries([], [root], 3)).toEqual([]);
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
        .protectedPaths()
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
    expect(matchProtectedPath(entries, join(dirs.home, ".ssh", "id_ed25519"), "read")?.reason).toBe(
      "credentials",
    );
    expect(matchProtectedPath(entries, join(dirs.workspace, ".env"), "read")?.reason).toBe(
      "credentials",
    );
    expect(
      matchProtectedPath(entries, join(dirs.workspace, ".env.example"), "read"),
    ).toBeUndefined();
  });
});

describe("secret folders added to the default table (enPp)", () => {
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
    }
    const onLinux = build(dirs, {
      providerEntries: selectSandboxProvider(linuxPlatform()).defaultProtectedPaths(dirs),
    });
    for (const name of linuxOpen) {
      expect(matchProtectedPath(onLinux, join(dirs.home, name), "read")).toBeUndefined();
    }
  });

  test("common rows deny read and write on every OS", () => {
    const dirs = makeTestDirs();
    for (const providerEntries of [
      selectSandboxProvider(darwinPlatform()).defaultProtectedPaths(dirs),
      selectSandboxProvider(linuxPlatform()).defaultProtectedPaths(dirs),
    ]) {
      const entries = build(dirs, { providerEntries });
      for (const name of common) {
        const hit = matchProtectedPath(entries, join(dirs.home, name), "read");
        expect(hit?.reason).toBe("credentials");
        expect(hit?.access).toBe("read_write");
        expect(matchProtectedPath(entries, join(dirs.home, name), "write")?.reason).toBe(
          "credentials",
        );
      }
      for (const name of agents) {
        expect(matchProtectedPath(entries, join(dirs.home, name), "read")?.reason).toBe(
          "agent_credentials",
        );
      }
    }
  });

  test("tools still read their plain config: only the credential file of cargo and terraform is denied", () => {
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

  test("macOS rows come from the darwin provider, Linux rows from the linux provider", () => {
    const dirs = makeTestDirs();
    const onDarwin = build(dirs, {
      providerEntries: selectSandboxProvider(darwinPlatform()).defaultProtectedPaths(dirs),
    });
    const onLinux = build(dirs, {
      providerEntries: selectSandboxProvider(linuxPlatform()).defaultProtectedPaths(dirs),
    });
    for (const name of mac) {
      expect(matchProtectedPath(onDarwin, join(dirs.home, name), "read")?.reason).toBe(
        "credentials",
      );
      expect(matchProtectedPath(onLinux, join(dirs.home, name), "read")).toBeUndefined();
    }
    for (const name of linux) {
      expect(matchProtectedPath(onLinux, join(dirs.home, name), "read")?.reason).toBe(
        "credentials",
      );
      expect(matchProtectedPath(onDarwin, join(dirs.home, name), "read")).toBeUndefined();
    }
    // 시스템 키체인은 홈 밖 절대 경로다
    expect(matchProtectedPath(onDarwin, "/Library/Keychains/System.keychain", "read")?.reason).toBe(
      "credentials",
    );
    expect(
      matchProtectedPath(onLinux, "/Library/Keychains/System.keychain", "read"),
    ).toBeUndefined();
  });

  test("credentialFiles=allow does not open any of the added rows", () => {
    const dirs = makeTestDirs();
    const entries = build(dirs, {
      credentialReadAllowed: true,
      providerEntries: selectSandboxProvider(darwinPlatform()).defaultProtectedPaths(dirs),
    });
    for (const name of [...common, ...agents, ...mac]) {
      expect(matchProtectedPath(entries, join(dirs.home, name), "read")).toBeDefined();
    }
  });

  test("protectedPaths.extra still adds on top of the larger default table", () => {
    const dirs = makeTestDirs();
    const extra = join(dirs.home, "vault");
    const entries = build(dirs, { extraPaths: [extra] });
    expect(matchProtectedPath(entries, join(extra, "x"), "read")?.reason).toBe("user_extra");
    expect(matchProtectedPath(entries, join(dirs.home, ".gnupg", "x"), "read")?.reason).toBe(
      "credentials",
    );
  });
});

describe("credential file reads (M3-REQ-55)", () => {
  const readable = [
    ".npmrc",
    ".netrc",
    ".pypirc",
    join(".docker", "config.json"),
    join(".config", "gh", "hosts.yml"),
  ];
  const stillDenied = [join(".ssh", "id_ed25519"), join(".aws", "credentials"), ".git-credentials"];

  test("by default CLI auth files are readable but not writable, keys and cloud credentials stay unreadable", () => {
    const dirs = makeTestDirs();
    const entries = build(dirs);
    for (const name of readable) {
      const path = join(dirs.home, name);
      expect(matchProtectedPath(entries, path, "read")).toBeUndefined();
      expect(matchProtectedPath(entries, path, "write")?.reason).toBe("credentials");
    }
    for (const name of stillDenied) {
      expect(matchProtectedPath(entries, join(dirs.home, name), "read")?.reason).toBe(
        "credentials",
      );
    }
  });

  test("credentialFiles=deny blocks reading them too", () => {
    const dirs = makeTestDirs();
    const entries = build(dirs, { credentialReadAllowed: false });
    for (const name of readable) {
      expect(matchProtectedPath(entries, join(dirs.home, name), "read")?.reason).toBe(
        "credentials",
      );
    }
  });

  test("the service follows the setting when it builds the default policy", async () => {
    const dirs = makeTestDirs();
    const npmrc = join(dirs.home, ".npmrc");
    const make = async (mode: "allow" | "deny") => {
      const service = await createSandboxService(
        {
          os: fakeOs(dirs),
          settings: () => settingsOf({ credentialFiles: mode }),
          srt: fakeSrt(),
          platform: linuxPlatform(),
          parentEnv: () => ({}),
        },
        new AbortController().signal,
      );
      return service.defaultPolicy({ workspaceRoots: [dirs.workspace], tempDir: dirs.tmp });
    };
    const allowed = await make("allow");
    expect(allowed.readDeny).not.toContain(npmrc);
    expect(allowed.writeDeny).toContain(npmrc);
    const denied = await make("deny");
    expect(denied.readDeny).toContain(npmrc);
  });
});
