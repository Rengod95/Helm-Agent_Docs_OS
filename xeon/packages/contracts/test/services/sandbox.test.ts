import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import {
  SandboxPolicySchema,
  SandboxRunReportSchema,
  SandboxStatusSchema,
  SelfTestReportSchema,
  describeSandboxStatus,
  matchProtectedPath,
  type ProtectedPathEntry,
  type SandboxStatus,
} from "../../src/services/index.ts";

const ENTRIES: readonly ProtectedPathEntry[] = [
  { path: "/home/u/.local/share/xeon", match: "prefix", access: "read_write", reason: "xeon_data" },
  { path: "/home/u/.config/xeon", match: "prefix", access: "write", reason: "xeon_config" },
  { path: "/home/u/.bashrc", match: "exact", access: "write", reason: "shell_startup" },
  { path: ".env.*", match: "basename", access: "read_write", reason: "credentials" },
  {
    path: ".env",
    match: "basename",
    access: "read_write",
    except: [".env.example"],
    reason: "credentials",
  },
  { path: "/work/.git/hooks", match: "prefix", access: "write", reason: "git_exec" },
];

describe("matchProtectedPath", () => {
  test("prefix entries cover the directory itself and everything below", () => {
    expect(matchProtectedPath(ENTRIES, "/home/u/.local/share/xeon", "read")?.reason).toBe(
      "xeon_data",
    );
    expect(
      matchProtectedPath(ENTRIES, "/home/u/.local/share/xeon/db/x.sqlite", "write")?.reason,
    ).toBe("xeon_data");
    expect(
      matchProtectedPath(ENTRIES, "/home/u/.local/share/xeon-other/x", "write"),
    ).toBeUndefined();
  });

  test("write-only entries do not block reads", () => {
    expect(
      matchProtectedPath(ENTRIES, "/home/u/.config/xeon/settings.json", "read"),
    ).toBeUndefined();
    expect(matchProtectedPath(ENTRIES, "/home/u/.config/xeon/settings.json", "write")?.reason).toBe(
      "xeon_config",
    );
    expect(matchProtectedPath(ENTRIES, "/home/u/.bashrc", "read")).toBeUndefined();
    expect(matchProtectedPath(ENTRIES, "/home/u/.bashrc", "write")?.reason).toBe("shell_startup");
  });

  test("exact entries match only the exact path", () => {
    expect(matchProtectedPath(ENTRIES, "/home/u/.bashrc.bak", "write")).toBeUndefined();
  });

  test("basename patterns match names with a trailing wildcard and honour exceptions", () => {
    expect(matchProtectedPath(ENTRIES, "/work/app/.env", "read")?.reason).toBe("credentials");
    expect(matchProtectedPath(ENTRIES, "/work/app/.env.local", "read")?.reason).toBe("credentials");
    expect(matchProtectedPath(ENTRIES, "/work/app/.env.example", "read")?.path).toBe(".env.*");
    const withoutPrefixPattern = ENTRIES.filter((entry) => entry.path !== ".env.*");
    expect(
      matchProtectedPath(withoutPrefixPattern, "/work/app/.env.example", "read"),
    ).toBeUndefined();
    expect(matchProtectedPath(ENTRIES, "/work/app/environment", "read")).toBeUndefined();
  });

  test("git hooks are write-protected", () => {
    expect(matchProtectedPath(ENTRIES, "/work/.git/hooks/pre-commit", "write")?.reason).toBe(
      "git_exec",
    );
    expect(matchProtectedPath(ENTRIES, "/work/.git/hooks/pre-commit", "read")).toBeUndefined();
  });

  test("a trailing slash on a prefix entry does not change the result", () => {
    const slashed: readonly ProtectedPathEntry[] = [
      { path: "/a/b/", match: "prefix", access: "read_write", reason: "user_extra" },
    ];
    expect(matchProtectedPath(slashed, "/a/b/c", "read")).toBeDefined();
    expect(matchProtectedPath(slashed, "/a/bc", "read")).toBeUndefined();
  });

  test("the first matching entry wins and an empty list matches nothing", () => {
    expect(matchProtectedPath([], "/anything", "write")).toBeUndefined();
    const two: readonly ProtectedPathEntry[] = [
      { path: "/a", match: "prefix", access: "read_write", reason: "credentials" },
      { path: "/a", match: "prefix", access: "read_write", reason: "user_extra" },
    ];
    expect(matchProtectedPath(two, "/a/x", "read")?.reason).toBe("credentials");
  });
});

function status(overrides: Partial<SandboxStatus>): SandboxStatus {
  return {
    level: "srt",
    platform: "linux",
    available: true,
    onUnavailable: "disable_execute",
    ...overrides,
  };
}

describe("describeSandboxStatus", () => {
  test("an active sandbox is ok", () => {
    const summary = describeSandboxStatus(status({}));
    expect(summary.severity).toBe("ok");
    expect(summary.hints).toEqual([]);
  });

  test("missing programs carry the install hints", () => {
    const summary = describeSandboxStatus(
      status({
        level: "none",
        available: false,
        reason: "missing_dependency",
        missing: ["bwrap", "socat"],
        installHints: ["sudo apt install bubblewrap socat"],
      }),
    );
    expect(summary.severity).toBe("critical");
    expect(summary.summary).toContain("bwrap, socat");
    expect(summary.hints).toEqual(["sudo apt install bubblewrap socat"]);
  });

  test("severity follows onUnavailable except for a failed self-test", () => {
    const base = {
      level: "none",
      available: false,
      reason: "unsupported_os",
      platform: "win32",
    } as const;
    expect(
      describeSandboxStatus(status({ ...base, onUnavailable: "disable_execute" })).severity,
    ).toBe("critical");
    expect(describeSandboxStatus(status({ ...base, onUnavailable: "ask" })).severity).toBe("warn");
    expect(
      describeSandboxStatus(status({ ...base, onUnavailable: "run_unsandboxed" })).severity,
    ).toBe("warn");
    const failed = describeSandboxStatus(
      status({
        level: "none",
        available: false,
        reason: "self_test_failed",
        onUnavailable: "run_unsandboxed",
        lastSelfTest: { at: 1, passed: false, failed: ["network_denied"] },
      }),
    );
    expect(failed.severity).toBe("critical");
    expect(failed.summary).toContain("network_denied");
  });

  test("disabled explains how to turn it on", () => {
    const summary = describeSandboxStatus(
      status({ level: "none", available: false, reason: "disabled", onUnavailable: "ask" }),
    );
    expect(summary.severity).toBe("warn");
    expect(summary.hints[0]).toContain("l0.sandbox.enabled");
  });

  test("it only needs the status value and does not change it", () => {
    const value = status({ level: "none", available: false, reason: "disabled" });
    const before = JSON.stringify(value);
    describeSandboxStatus(value);
    expect(JSON.stringify(value)).toBe(before);
  });
});

describe("sandbox schemas", () => {
  test("status", () => {
    expect(parse(SandboxStatusSchema, status({})).ok).toBe(true);
    expect(
      parse(
        SandboxStatusSchema,
        status({ lastSelfTest: { at: 1, passed: false, failed: ["env_allowlist"] } }),
      ).ok,
    ).toBe(true);
    expect(parse(SandboxStatusSchema, { ...status({}), platform: "plan9" }).ok).toBe(false);
    const badItem = { ...status({}), lastSelfTest: { at: 1, passed: false, failed: ["nope"] } };
    expect(parse(SandboxStatusSchema, badItem).ok).toBe(false);
  });

  test("policy", () => {
    const policy = {
      writeRoots: ["/work"],
      readDeny: [],
      writeDeny: [],
      network: { allowedDomains: [], deniedDomains: [] },
      allowEscape: false,
    };
    expect(parse(SandboxPolicySchema, policy).ok).toBe(true);
    expect(parse(SandboxPolicySchema, { ...policy, allowEscape: "yes" }).ok).toBe(false);
  });

  test("run report", () => {
    const report = {
      sandboxed: true,
      level: "srt",
      violations: [
        { source: "seatbelt", operation: "file_write", target: "/etc/passwd", count: 2 },
      ],
      violationsTruncated: false,
    };
    expect(parse(SandboxRunReportSchema, report).ok).toBe(true);
    expect(parse(SandboxRunReportSchema, { ...report, unsandboxedBy: "escape" }).ok).toBe(true);
    expect(parse(SandboxRunReportSchema, { ...report, level: "vm" }).ok).toBe(false);
  });

  test("self-test report", () => {
    const report = {
      at: 1,
      durationMs: 20,
      passed: true,
      items: [{ id: "network_denied", passed: true }],
    };
    expect(parse(SelfTestReportSchema, report).ok).toBe(true);
    expect(parse(SelfTestReportSchema, { ...report, items: [{ id: "x", passed: true }] }).ok).toBe(
      false,
    );
  });
});
