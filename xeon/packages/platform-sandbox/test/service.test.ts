import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { matchProtectedPath } from "@fresnel/contracts/services";
import { canonicalizePath } from "../src/paths.ts";
import { createSandboxService } from "../src/service.ts";
import type { SandboxSettings } from "../src/settings.ts";
import {
  darwinPlatform,
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
    current = settingsOf({ protectedPathsExtra: [] });
    expect(
      matchProtectedPath(service.protectedPaths(), join(dirs.home, "vault", "a"), "read"),
    ).toBeUndefined();
    const policy = service.defaultPolicy({ workspaceRoots: [dirs.workspace], tempDir: dirs.tmp });
    expect(policy.writeRoots).toEqual([dirs.workspace, dirs.tmp].toSorted());
    expect(policy.network).toEqual({ allowedDomains: [], deniedDomains: [] });
    expect(policy.allowEscape).toBe(false);
  });

  test("protectedPaths covers the roots the caller passes from the first call", async () => {
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
    // 호출한 쪽이 root를 넘기면 bash를 돌린 적이 없어도 첫 호출부터 막힌다
    expect(
      matchProtectedPath(service.protectedPaths([dirs.workspace]), hook, "write")?.reason,
    ).toBe("git_exec");
    expect(
      matchProtectedPath(
        service.protectedPaths([dirs.workspace]),
        join(dirs.workspace, ".git", "config"),
        "write",
      )?.reason,
    ).toBe("git_exec");
    // root를 넘기지 않으면 git 항목은 없다
    expect(matchProtectedPath(service.protectedPaths(), hook, "write")).toBeUndefined();
    // 쓰기 범위 제한이 없는 대화(root에 `/`가 있다)는 .git/hooks도 제안 목록도 막지 않는다
    const open = service.protectedPaths([dirs.workspace, "/"]);
    expect(matchProtectedPath(open, hook, "write")).toBeUndefined();
    expect(matchProtectedPath(open, join(dirs.home, ".zshrc"), "write")).toBeUndefined();
    expect(matchProtectedPath(open, join(dirs.home, ".ssh", "id"), "write")).toBeUndefined();
    expect(matchProtectedPath(open, join(dirs.data, "x"), "read")?.reason).toBe("fresnel_data");
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

describe("defaultPolicy no-write with systemTools", () => {
  test("adds the system tool folders to the read allow-list only when asked, and never a write root", async () => {
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
    const base = {
      workspaceRoots: [],
      tempDir: dirs.tmp,
      profile: "no-write" as const,
      readRoots: ["/plugin"],
    };
    const plain = service.defaultPolicy(base);
    const tools = service.defaultPolicy({ ...base, systemTools: true });
    expect(plain.readAllow).not.toContain("/usr/bin");
    expect(tools.readAllow).toContain("/usr/bin");
    expect(tools.readAllow).toContain("/bin");
    expect(tools.writeRoots).toEqual([]);
    expect(tools.writeDeny).toEqual(plain.writeDeny);
    // 시스템 도구 폴더가 없는 제공자 쪽(여기서는 bwrap)은 Seatbelt 전용 막기를 싣지 않는다
    expect(tools.toolDeny ?? []).toEqual([]);
    expect(tools.machDeny ?? []).toEqual([]);
  });
});

describe("protected path keys and the suggested list (AGE-63)", () => {
  test("protectedPathKey resolves ~, ~/ and absolute values the way the extra list does, and refuses other shapes", async () => {
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
    expect(service.protectedPathKey("~")).toBe(canonicalizePath(dirs.home));
    expect(service.protectedPathKey("~/vault/")).toBe(canonicalizePath(join(dirs.home, "vault")));
    expect(service.protectedPathKey(join(dirs.root, "x"))).toBe(
      canonicalizePath(join(dirs.root, "x")),
    );
    expect(service.protectedPathKey("/")).toBe("/");
    expect(service.protectedPathKey("relative/x")).toBeUndefined();
    expect(service.protectedPathKey("~other/x")).toBeUndefined();
  });

  test("suggestedProtectedPaths lists this OS's rows in ~/ form, each with its canonical key", async () => {
    const dirs = makeTestDirs();
    const linux = await createSandboxService(
      {
        os: fakeOs(dirs),
        settings: () => settingsOf(),
        srt: fakeSrt(),
        platform: linuxPlatform(),
        parentEnv: () => ({}),
      },
      new AbortController().signal,
    );
    const rows = linux.suggestedProtectedPaths();
    expect(rows).toContainEqual({
      path: "~/.ssh",
      label: "SSH keys",
      key: canonicalizePath(join(dirs.home, ".ssh")),
    });
    // macOS 전용 줄(키체인)은 Linux 목록에 없다
    expect(rows.map((row) => row.path)).not.toContain("~/Library/Keychains");
    const darwin = await createSandboxService(
      {
        os: fakeOs(dirs),
        settings: () => settingsOf(),
        srt: fakeSrt(),
        platform: darwinPlatform(),
        parentEnv: () => ({}),
      },
      new AbortController().signal,
    );
    expect(darwin.suggestedProtectedPaths().map((row) => row.path)).toContain(
      "~/Library/Keychains",
    );
  });
});
