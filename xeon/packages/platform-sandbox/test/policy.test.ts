import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SandboxPolicy } from "@fresnel/contracts/services";
import {
  BLOCKED_NETWORK,
  candidateWriteRoots,
  mergePolicy,
  socatPathOf,
  toSrtFileConfig,
  toSrtGlobalConfig,
  type PolicyInput,
} from "../src/policy.ts";
import { makeTestDirs } from "./support/fakes.ts";

function basePolicy(overrides: Partial<SandboxPolicy> = {}): SandboxPolicy {
  return {
    writeRoots: [],
    readDeny: [],
    writeDeny: [],
    network: { allowedDomains: [], deniedDomains: [] },
    allowEscape: false,
    ...overrides,
  };
}

function input(
  policy: SandboxPolicy,
  home: string,
  base: string,
  overrides: Partial<PolicyInput> = {},
): PolicyInput {
  return {
    policy,
    protectedReadDeny: [],
    protectedWriteDeny: [],
    basenameReadFiles: [],
    basenameWriteFiles: [],
    home,
    base,
    ...overrides,
  };
}

describe("policy", () => {
  test("normalizes paths to absolute realpaths", () => {
    const dirs = makeTestDirs();
    mkdirSync(join(dirs.workspace, "real"), { recursive: true });
    symlinkSync(join(dirs.workspace, "real"), join(dirs.workspace, "link"));
    const policy = basePolicy({
      writeRoots: [
        "src/../src",
        "~/notes",
        join(dirs.workspace, "link"),
        join(dirs.workspace, "missing", "deeper"),
      ],
    });
    const roots = candidateWriteRoots(input(policy, dirs.home, dirs.workspace));
    expect(roots).toEqual(
      [
        join(dirs.workspace, "src"),
        join(dirs.home, "notes"),
        join(dirs.workspace, "real"),
        join(dirs.workspace, "missing", "deeper"),
      ].toSorted(),
    );
  });

  test("removes duplicates and sorts", () => {
    const dirs = makeTestDirs();
    const policy = basePolicy({
      writeRoots: [join(dirs.workspace, "b"), join(dirs.workspace, "a"), join(dirs.workspace, "b")],
      readDeny: ["/zzz", "/aaa", "/zzz"],
    });
    const base = input(policy, dirs.home, dirs.workspace);
    const roots = candidateWriteRoots(base);
    expect(roots).toEqual([join(dirs.workspace, "a"), join(dirs.workspace, "b")]);
    const effective = mergePolicy(base, roots);
    expect(effective.readDeny).toEqual(["/aaa", "/zzz"]);
  });

  test("readDeny also denies writes and protected paths are always merged", () => {
    const dirs = makeTestDirs();
    const effective = mergePolicy(
      input(
        basePolicy({ readDeny: ["/secret-a"], writeDeny: ["/frozen"] }),
        dirs.home,
        dirs.workspace,
        {
          protectedReadDeny: ["/p/read"],
          protectedWriteDeny: ["/p/read", "/p/write"],
          // 읽기도 거부하는 이름 항목은 두 목록에, 쓰기만 거부하는 이름 항목은 쓰기 목록에만 든다
          basenameReadFiles: ["/r/.env"],
          basenameWriteFiles: ["/r/.env", "/w/.env"],
        },
      ),
      [],
    );
    expect(effective.readDeny).toEqual(["/p/read", "/r/.env", "/secret-a"]);
    expect(effective.writeDeny).toEqual([
      "/frozen",
      "/p/read",
      "/p/write",
      "/r/.env",
      "/secret-a",
      "/w/.env",
    ]);
  });

  test("emits literal paths only: plain strings never carry glob characters", () => {
    const config = toSrtFileConfig({
      writeRoots: ["/w/plain", "/w/we*ird"],
      readDeny: ["/r/[x]", "/r/ok"],
      writeDeny: ["/d/a?b", "/d/ok"],
    });
    const fs = config.filesystem;
    expect(fs).toBeDefined();
    const entries = [...(fs?.allowWrite ?? []), ...(fs?.denyRead ?? []), ...(fs?.denyWrite ?? [])];
    for (const entry of entries) {
      if (typeof entry === "string") expect(entry).not.toMatch(/[*?[\]{}]/);
      else expect(entry.literal).toBe(true);
    }
    expect(fs?.allowWrite).toEqual(["/w/plain", { path: "/w/we*ird", literal: true }]);
  });

  test("keeps network global and files per command", () => {
    const global = toSrtGlobalConfig({}, BLOCKED_NETWORK);
    expect(global.network.allowedDomains).toEqual([]);
    expect(global.filesystem.allowWrite).toEqual([]);
    expect(global.filesystem.denyRead).toEqual([]);
    expect(global.filesystem.denyWrite).toEqual([]);
    const perCommand = toSrtFileConfig({ writeRoots: ["/w"], readDeny: [], writeDeny: [] });
    expect("network" in perCommand).toBe(false);
    expect(perCommand.filesystem?.allowWrite).toEqual(["/w"]);
  });

  test("pins weakening options off and passes helper paths", () => {
    const config = toSrtGlobalConfig(
      { bwrapPath: "/usr/bin/bwrap", socatPath: "/usr/bin/socat", ripgrepCommand: "/usr/bin/rg" },
      BLOCKED_NETWORK,
    );
    expect(config.enableWeakerNestedSandbox).toBe(false);
    expect(config.enableWeakerNetworkIsolation).toBe(false);
    expect(config.allowAppleEvents).toBe(false);
    expect(config.allowPty).toBe(false);
    expect(config.filesystem.allowGitConfig).toBe(false);
    expect(config.network.strictAllowlist).toBe(true);
    expect(config.network.allowAllUnixSockets).toBe(false);
    expect(config.network.allowLocalBinding).toBe(false);
    expect(config.bwrapPath).toBe("/usr/bin/bwrap");
    expect(config.socatPath).toBe("/usr/bin/socat");
    expect(config.ripgrep).toEqual({ command: "/usr/bin/rg" });
    expect(
      toSrtFileConfig({ writeRoots: [], readDeny: [], writeDeny: [] }).filesystem?.allowGitConfig,
    ).toBe(false);
  });

  test("a read allow-list denies the whole root and reopens only the allowed paths", () => {
    const dirs = makeTestDirs();
    const plugin = join(dirs.root, "plugin");
    mkdirSync(plugin, { recursive: true });
    const merged = mergePolicy(
      input(basePolicy({ readAllow: [plugin, "/usr/lib"] }), dirs.home, dirs.root),
      [],
    );
    expect(merged.readAllow).toEqual([plugin, "/usr/lib"].toSorted());
    const fs = toSrtFileConfig(merged).filesystem;
    expect(fs?.denyRead).toEqual(["/"]);
    expect(fs?.allowRead).toEqual([plugin, "/usr/lib"].toSorted());
  });

  test("without a read allow-list the config is the deny-list form it always was", () => {
    const merged = mergePolicy(input(basePolicy({ readDeny: ["/r"] }), "/h", "/b"), []);
    expect(merged.readAllow).toBeUndefined();
    const fs = toSrtFileConfig(merged).filesystem;
    expect(fs?.denyRead).toEqual(["/r"]);
    expect("allowRead" in (fs ?? {})).toBe(false);
  });

  test("an allow-list entry that overlaps a read-protected path is dropped, an empty list stays a list", () => {
    const dirs = makeTestDirs();
    const protectedDir = join(dirs.root, "data");
    const inside = join(protectedDir, "ext");
    const outside = join(dirs.root, "plugin");
    mkdirSync(inside, { recursive: true });
    mkdirSync(outside, { recursive: true });
    const merged = mergePolicy(
      input(basePolicy({ readAllow: [protectedDir, inside, dirs.root, outside] }), dirs.home, "/", {
        protectedReadDeny: [protectedDir],
      }),
      [],
    );
    expect(merged.readAllow).toEqual([outside]);
    const none = mergePolicy(input(basePolicy({ readAllow: [] }), dirs.home, "/"), []);
    expect(none.readAllow).toEqual([]);
    expect(toSrtFileConfig(none).filesystem?.denyRead).toEqual(["/"]);
  });

  test("an allow-list entry inside a carvable (Fresnel data) path stays, one that contains it or sits in another protected path does not", () => {
    const dirs = makeTestDirs();
    const data = join(dirs.root, "data");
    const secrets = join(dirs.root, "secrets");
    const tree = join(data, "plugin-store", "reviewed", "kit", "abc", "tree");
    const secretFile = join(secrets, "key");
    mkdirSync(tree, { recursive: true });
    mkdirSync(secrets, { recursive: true });
    const merged = mergePolicy(
      input(basePolicy({ readAllow: [tree, data, secretFile] }), dirs.home, "/", {
        protectedReadDeny: [data, secrets],
        carvableReadDeny: [data],
      }),
      [],
    );
    expect(merged.readAllow).toEqual([tree]);
  });

  test("a symlink name stays in the allow-list next to its real path", () => {
    const dirs = makeTestDirs();
    const real = join(dirs.root, "real");
    const link = join(dirs.root, "link");
    mkdirSync(real, { recursive: true });
    symlinkSync(real, link);
    const merged = mergePolicy(input(basePolicy({ readAllow: [link] }), dirs.home, "/"), []);
    expect(merged.readAllow).toEqual([link, real].toSorted());
  });

  test("socatPathOf follows a socat symlink to the real file and leaves other names alone", () => {
    const dirs = makeTestDirs();
    const real = join(dirs.root, "socat1");
    writeFileSync(real, "");
    const link = join(dirs.root, "socat");
    symlinkSync(real, link);
    expect(socatPathOf(link)).toBe(real);
    const multicall = join(dirs.root, "busybox");
    writeFileSync(multicall, "");
    const alias = join(dirs.root, "socat-alias");
    symlinkSync(multicall, alias);
    expect(socatPathOf(alias)).toBe(alias);
    expect(socatPathOf("/missing/socat")).toBe("/missing/socat");
  });
});
