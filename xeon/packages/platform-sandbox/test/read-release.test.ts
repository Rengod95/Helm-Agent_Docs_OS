import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { matchProtectedPath, type ProtectedPathEntry } from "@fresnel/contracts/services";
import { applyReadRelease, buildProtectedPaths } from "../src/protected-paths.ts";
import { createSandboxService } from "../src/service.ts";
import {
  fakeOs,
  fakeSrt,
  linuxPlatform,
  makeTestDirs,
  NO_CANCEL,
  recordingShell,
  settingsOf,
  type TestDirs,
} from "./support/fakes.ts";

// settings `l0.sandbox.protectedPaths.allowRead`(AGE-63 결정 2 나)의 순수 규칙과 서비스 연결

const KEYCHAIN = "Library/Keychains";
const CHROME = "Library/Application Support/Google/Chrome";

function table(dirs: TestDirs): readonly ProtectedPathEntry[] {
  const provider = [KEYCHAIN, CHROME].map((name): ProtectedPathEntry => ({
    path: join(dirs.home, name),
    match: "prefix",
    access: "read_write",
    reason: "credentials",
  }));
  return buildProtectedPaths({
    dirs,
    providerEntries: provider,
    secretPaths: [join(dirs.root, "vault", "secrets.sops.yaml")],
    ageKeyFileEnv: undefined,
    extraPaths: [],
    credentialReadAllowed: true,
  });
}

describe("applyReadRelease", () => {
  test("an entry's own path becomes write-only and the rest of the table is unchanged", () => {
    const dirs = makeTestDirs();
    const before = table(dirs);
    const chrome = join(dirs.home, CHROME);
    const after = applyReadRelease(before, [chrome], dirs.home);
    expect(after.carved).toEqual([]);
    expect(after.ignored).toEqual({ unknown: 0, pinned: 0 });
    expect(after.entries.length).toBe(before.length);
    for (const [index, entry] of before.entries()) {
      const next = after.entries[index];
      if (entry.path === chrome) expect(next).toEqual({ ...entry, access: "write" });
      else expect(next).toEqual(entry);
    }
    expect(
      matchProtectedPath(after.entries, join(chrome, "Default", "Cookies"), "read"),
    ).toBeUndefined();
    expect(
      matchProtectedPath(after.entries, join(chrome, "Default", "Cookies"), "write")?.path,
    ).toBe(chrome);
  });

  test("a path inside an entry keeps the entry and is carved out", () => {
    const dirs = makeTestDirs();
    const before = table(dirs);
    const inner = join(dirs.home, ".aws", "sso");
    const after = applyReadRelease(before, [inner], dirs.home);
    expect(after.entries).toEqual(before);
    expect(after.carved).toEqual([inner]);
  });

  test("pinned entries are never released: product secrets, data, and keychains", () => {
    const dirs = makeTestDirs();
    const before = table(dirs);
    const pinned = [
      join(dirs.config, "secrets"),
      join(dirs.config, "secrets", "sub"),
      dirs.data,
      join(dirs.home, ".config", "sops", "age", "keys.txt"),
      join(dirs.root, "vault", "secrets.sops.yaml"),
      join(dirs.home, KEYCHAIN),
      join(dirs.home, KEYCHAIN, "login.keychain-db"),
    ];
    const after = applyReadRelease(before, pinned, dirs.home);
    expect(after.entries).toEqual(before);
    expect(after.carved).toEqual([]);
    expect(after.ignored).toEqual({ unknown: 0, pinned: pinned.length });
  });

  test("a path outside the default table, a parent of an entry and a name rule release nothing", () => {
    const dirs = makeTestDirs();
    const before = table(dirs);
    const after = applyReadRelease(
      before,
      [
        join(dirs.home, "projects"),
        join(dirs.home, "Library"),
        dirs.home,
        join(dirs.workspace, ".env"),
      ],
      dirs.home,
    );
    expect(after.entries).toEqual(before);
    expect(after.carved).toEqual([]);
    expect(after.ignored).toEqual({ unknown: 4, pinned: 0 });
  });
});

async function start(allowOf: (dirs: TestDirs) => readonly string[]) {
  const dirs = makeTestDirs();
  const allow = allowOf(dirs);
  const os = fakeOs(dirs);
  const srt = fakeSrt();
  const service = await createSandboxService(
    {
      os,
      settings: () => settingsOf({ protectedPathsAllowRead: allow }),
      srt,
      platform: linuxPlatform(),
      parentEnv: () => ({}),
    },
    new AbortController().signal,
  );
  return { dirs, os, srt, service };
}

describe("service wiring", () => {
  test("only a call that asks for the release opens the entry, and write stays denied", async () => {
    const run = await start((dirs) => [join(dirs.home, ".kube")]);
    const { dirs: d, service, srt } = run;
    const released = service.defaultPolicy({
      workspaceRoots: [d.workspace],
      tempDir: d.tmp,
      userReadRelease: true,
    });
    const home = join(d.home, ".kube");
    expect(released.readDeny).not.toContain(home);
    expect(released.writeDeny).toContain(home);
    expect(released.userReadRelease).toBe(true);
    await service
      .wrapShell(recordingShell(), released)
      .exec("true", { cwd: d.workspace }, NO_CANCEL);
    const fs = srt.wrapCalls[0]?.customConfig.filesystem;
    expect((fs?.denyRead ?? []).map(String)).not.toContain(home);
    expect((fs?.denyWrite ?? []).map(String)).toContain(home);

    const plain = service.defaultPolicy({ workspaceRoots: [d.workspace], tempDir: d.tmp });
    expect(plain.readDeny).toContain(home);
    expect(plain.userReadRelease).toBeUndefined();
    // 플래그가 없는 호출(MCP, 플러그인 경로)은 정책에 readDeny를 비워도 기본 거부가 그대로다
    const { userReadRelease: _flag, ...unflagged } = released;
    const bare = { ...unflagged, readDeny: [] };
    await service.wrapShell(recordingShell(), bare).exec("true", { cwd: d.workspace }, NO_CANCEL);
    expect((srt.wrapCalls[1]?.customConfig.filesystem?.denyRead ?? []).map(String)).toContain(home);
    // 파일 도구가 보는 보호 경로 목록은 그대로다
    expect(
      matchProtectedPath(service.protectedPaths(), join(home, "config"), "read"),
    ).toBeDefined();
  });

  test("an inner path is passed to srt as allowRead while the entry stays denied", async () => {
    const run = await start((dirs) => [join(dirs.home, ".aws", "sso")]);
    const { dirs: d, service, srt } = run;
    const policy = service.defaultPolicy({
      workspaceRoots: [d.workspace],
      tempDir: d.tmp,
      userReadRelease: true,
    });
    await service.wrapShell(recordingShell(), policy).exec("true", { cwd: d.workspace }, NO_CANCEL);
    const fs = srt.wrapCalls[0]?.customConfig.filesystem;
    expect((fs?.denyRead ?? []).map(String)).toContain(join(d.home, ".aws"));
    expect((fs?.allowRead ?? []).map(String)).toEqual([join(d.home, ".aws", "sso")]);
  });

  test("script-env, no-write and read-only profiles ignore the release", async () => {
    const run = await start((dirs) => [join(dirs.home, ".kube")]);
    const { dirs: d, service } = run;
    for (const profile of ["script-env", "no-write", "read-only"] as const) {
      const policy = service.defaultPolicy({
        workspaceRoots: [],
        tempDir: d.tmp,
        profile,
        projectDir: d.workspace,
        userReadRelease: true,
      });
      expect(policy.userReadRelease).toBeUndefined();
      expect(policy.readDeny).toContain(join(d.home, ".kube"));
    }
  });

  test("values that release nothing leave only counts in the log", async () => {
    const run = await start((dirs) => [
      "relative/dir",
      join(dirs.home, "projects"),
      join(dirs.config, "secrets"),
      join(dirs.home, ".kube"),
    ]);
    const entry = run.os.log.entries.find(
      (item) => item.event === "sandbox.protected_path_release_ignored",
    );
    expect(entry?.fields).toEqual({ component: "sandbox", relative: 1, unknown: 1, pinned: 1 });
  });
});
