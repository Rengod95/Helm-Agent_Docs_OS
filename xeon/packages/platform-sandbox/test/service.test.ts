import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { matchProtectedPath } from "@xeon/contracts/services";
import { createSandboxService } from "../src/service.ts";
import type { SandboxSettings } from "../src/settings.ts";
import {
  fakeOs,
  fakeSrt,
  linuxPlatform,
  makeTestDirs,
  NO_CANCEL,
  recordingShell,
  settingsOf,
} from "./support/fakes.ts";

describe("sandbox service wiring", () => {
  test("secret paths, the age key env and extra settings reach protectedPaths and the policy", async () => {
    const dirs = makeTestDirs();
    const sops = join(dirs.root, "vault", "secrets.sops.yaml");
    const ageKey = join(dirs.root, "keys", "age.txt");
    let current: SandboxSettings = settingsOf({ protectedPathsExtra: ["~/vault", "relative"] });
    const os = fakeOs(dirs);
    const srt = fakeSrt();
    const service = await createSandboxService(
      {
        os,
        secrets: { protectedPaths: () => [sops] },
        settings: () => current,
        srt,
        platform: linuxPlatform(),
        parentEnv: () => ({ SOPS_AGE_KEY_FILE: ageKey }),
      },
      new AbortController().signal,
    );
    expect(
      os.log.entries.some((entry) => entry.event === "sandbox.protected_path_extra_rejected"),
    ).toBe(true);
    const entries = service.protectedPaths();
    expect(matchProtectedPath(entries, sops, "read")?.reason).toBe("secret_key");
    expect(matchProtectedPath(entries, ageKey, "write")?.reason).toBe("secret_key");
    expect(matchProtectedPath(entries, join(dirs.home, "vault", "a"), "read")?.reason).toBe(
      "user_extra",
    );

    // nextTurn 설정은 다음 호출부터 반영된다
    current = settingsOf({
      protectedPathsExtra: [],
      writeRootsExtra: [join(dirs.root, "extra-out")],
    });
    expect(
      matchProtectedPath(service.protectedPaths(), join(dirs.home, "vault", "a"), "read"),
    ).toBeUndefined();
    const policy = service.defaultPolicy({ workspaceRoots: [dirs.workspace], tempDir: dirs.tmp });
    expect(policy.writeRoots).toContain(join(dirs.root, "extra-out"));
    expect(policy.network).toEqual({ allowedDomains: [], deniedDomains: [] });
    expect(policy.allowEscape).toBe(false);
    // 설정으로 더한 쓰기 루트는 자동 허용 대상이 아니다
    const decision = service.autoAllow(policy, {
      command: "ls",
      cwd: dirs.workspace,
      workspaceRoots: [dirs.workspace],
      tempDir: dirs.tmp,
    });
    expect(decision).toEqual({ allow: false, blocks: ["write_root_outside"] });
  });

  test("protectedPaths grows with the workspace roots it has seen", async () => {
    const dirs = makeTestDirs();
    const service = await createSandboxService(
      {
        os: fakeOs(dirs),
        settings: () => settingsOf(),
        srt: fakeSrt(),
        platform: linuxPlatform(),
        parentEnv: () => ({}),
      },
      new AbortController().signal,
    );
    const hook = join(dirs.workspace, ".git", "hooks", "pre-commit");
    expect(matchProtectedPath(service.protectedPaths(), hook, "write")).toBeUndefined();
    service.defaultPolicy({ workspaceRoots: [dirs.workspace], tempDir: dirs.tmp });
    expect(matchProtectedPath(service.protectedPaths(), hook, "write")?.reason).toBe("git_exec");
  });

  test("a bug-level error from detection degrades to an unavailable status", async () => {
    const dirs = makeTestDirs();
    const service = await createSandboxService(
      {
        os: {
          ...fakeOs(dirs),
          resolveBinary: () => Promise.reject(new RangeError("boom")),
        },
        settings: () => settingsOf(),
        srt: fakeSrt(),
        platform: linuxPlatform(),
        parentEnv: () => ({}),
      },
      new AbortController().signal,
    );
    expect(service.status().available).toBe(false);
    expect(service.status().reason).toBe("missing_dependency");
    const shell = recordingShell();
    const result = await service
      .wrapShell(
        shell,
        service.defaultPolicy({ workspaceRoots: [dirs.workspace], tempDir: dirs.tmp }),
      )
      .exec("true", undefined, NO_CANCEL);
    expect(result.ok).toBe(false);
    expect(shell.calls.length).toBe(0);
  });

  test("refresh runs detection again after a dependency appears", async () => {
    const dirs = makeTestDirs();
    let missing = true;
    const os = fakeOs(dirs);
    const srt = fakeSrt();
    const service = await createSandboxService(
      {
        os: {
          ...os,
          resolveBinary: (name, options, signal) =>
            missing && name === "bwrap"
              ? fakeOs(dirs, ["bwrap"]).resolveBinary(name, options, signal)
              : os.resolveBinary(name, options, signal),
        },
        settings: () => settingsOf(),
        srt,
        platform: linuxPlatform(),
        parentEnv: () => ({}),
      },
      new AbortController().signal,
    );
    expect(service.status().reason).toBe("missing_dependency");
    missing = false;
    const status = await service.refresh(new AbortController().signal);
    expect(status.available).toBe(true);
    expect(srt.initializeCalls.length).toBe(1);
  });
});
