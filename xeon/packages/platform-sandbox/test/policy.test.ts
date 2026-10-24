import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import type { SandboxPolicy } from "@xeon/contracts/services";
import {
  BLOCKED_NETWORK,
  candidateWriteRoots,
  mergePolicy,
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
    basenameFiles: [],
    extraWriteRoots: [],
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
          basenameFiles: ["/w/.env"],
        },
      ),
      [],
    );
    expect(effective.readDeny).toEqual(["/p/read", "/secret-a", "/w/.env"]);
    expect(effective.writeDeny).toEqual(["/frozen", "/p/read", "/p/write", "/secret-a", "/w/.env"]);
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
});
