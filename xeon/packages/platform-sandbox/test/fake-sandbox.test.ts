import { describe, expect, test } from "bun:test";
import { fakeSandbox } from "../src/testing/index.ts";
import { NO_CANCEL, recordingShell } from "./support/fakes.ts";

describe("fakeSandbox", () => {
  test("defaults to an available srt sandbox and marks sandboxed runs", async () => {
    const sandbox = fakeSandbox();
    expect(sandbox.status()).toEqual({
      level: "srt",
      platform: "linux",
      available: true,
      onUnavailable: "disable_execute",
    });
    const shell = recordingShell();
    const policy = sandbox.defaultPolicy({ workspaceRoots: ["/w"], tempDir: "/t" });
    const result = await sandbox.wrapShell(shell, policy).exec(["ls"], undefined, NO_CANCEL);
    expect(result.ok && result.value.sandbox).toEqual({
      sandboxed: true,
      level: "srt",
      violations: [],
      violationsTruncated: false,
    });
    expect(shell.calls[0]?.command).toEqual(["ls"]);
    expect(sandbox.wrapped).toEqual([{ command: ["ls"], policy }]);
    expect(
      sandbox.autoAllow(policy, {
        command: "ls",
        cwd: "/w",
        workspaceRoots: ["/w"],
        tempDir: "/t",
      }),
    ).toEqual({
      allow: true,
    });
    expect((await sandbox.selfTest(shell, NO_CANCEL)).passed).toBe(true);
  });

  test("uses the real onUnavailable table", async () => {
    const shell = recordingShell();
    const policy = fakeSandbox().defaultPolicy({ workspaceRoots: ["/w"], tempDir: "/t" });
    const rejecting = fakeSandbox({ status: { available: false, reason: "unsupported_os" } });
    expect(rejecting.status().level).toBe("none");
    const rejected = await rejecting.wrapShell(shell, policy).exec("ls", undefined, NO_CANCEL);
    expect(!rejected.ok && rejected.error.code).toBe("sandbox_unavailable");
    expect(shell.calls.length).toBe(0);
    expect((await rejecting.selfTest(shell, NO_CANCEL)).passed).toBe(false);
    const running = fakeSandbox({
      status: { available: false, reason: "unsupported_os", onUnavailable: "run_unsandboxed" },
    });
    const ran = await running.wrapShell(shell, policy).exec("ls", undefined, NO_CANCEL);
    expect(ran.ok && ran.value.sandbox?.unsandboxedBy).toBe("run_unsandboxed");
  });

  test("fixed decisions and protected paths come from the options", () => {
    const sandbox = fakeSandbox({
      autoAllow: { allow: false, blocks: ["escape_requested"] },
      protectedPaths: [{ path: "/p", match: "prefix", access: "read_write", reason: "user_extra" }],
    });
    const policy = sandbox.defaultPolicy({ workspaceRoots: ["/w"], tempDir: "/t" });
    expect(policy.readDeny).toEqual(["/p"]);
    expect(sandbox.protectedPaths().length).toBe(1);
    expect(
      sandbox.autoAllow(policy, { command: "x", cwd: "/w", workspaceRoots: ["/w"], tempDir: "/t" }),
    ).toEqual({ allow: false, blocks: ["escape_requested"] });
  });

  test("wrapArgv records the request and returns the argv for an available sandbox", async () => {
    const sandbox = fakeSandbox();
    const policy = sandbox.defaultPolicy({ workspaceRoots: ["/w"], tempDir: "/t" });
    const request = { command: "node", args: ["server.js"], cwd: "/w" };
    const result = await sandbox.wrapArgv(policy, request, NO_CANCEL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sandboxed).toBe(true);
    expect(result.value.argv).toEqual(["node", "server.js"]);
    expect(sandbox.wrappedArgv).toEqual([{ request, policy }]);
  });

  test("wrapArgv with an unavailable disable_execute status is err unavailable", async () => {
    const sandbox = fakeSandbox({ status: { available: false, reason: "unsupported_os" } });
    const policy = sandbox.defaultPolicy({ workspaceRoots: ["/w"], tempDir: "/t" });
    const request = { command: "node", args: [], cwd: undefined };
    const result = await sandbox.wrapArgv(policy, request, NO_CANCEL);
    expect(!result.ok && result.error).toEqual({ kind: "unavailable", reason: "unsupported_os" });
    expect(sandbox.wrappedArgv.length).toBe(1);
  });
});
