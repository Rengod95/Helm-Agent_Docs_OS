import { describe, expect, test } from "bun:test";
import type { OnUnavailable, SandboxPolicy } from "@xeon/contracts/services";
import { createSandboxService, type SandboxServiceHandle } from "../src/service.ts";
import type { SandboxSettings } from "../src/settings.ts";
import {
  fakeOs,
  fakeSrt,
  linuxPlatform,
  makeTestDirs,
  NO_CANCEL,
  recordingShell,
  settingsOf,
  type FakeSrt,
  type RecordingShell,
  type TestDirs,
} from "./support/fakes.ts";
import type { PlatformInput } from "../src/select.ts";

interface Rig {
  readonly dirs: TestDirs;
  readonly srt: FakeSrt;
  readonly shell: RecordingShell;
  readonly service: SandboxServiceHandle;
  /** 설정을 바꾼다. 다음 호출부터 반영된다 */
  set(next: Partial<SandboxSettings>): void;
  policy(overrides?: Partial<SandboxPolicy>): SandboxPolicy;
}

async function rig(platform: PlatformInput, initial: Partial<SandboxSettings> = {}): Promise<Rig> {
  const dirs = makeTestDirs();
  const srt = fakeSrt();
  let current = settingsOf(initial);
  const service = await createSandboxService(
    {
      os: fakeOs(dirs),
      settings: () => current,
      srt,
      platform,
      parentEnv: () => ({}),
    },
    new AbortController().signal,
  );
  return {
    dirs,
    srt,
    shell: recordingShell(),
    service,
    set: (next) => {
      current = { ...current, ...next };
    },
    policy: (overrides = {}) => ({
      ...service.defaultPolicy({ workspaceRoots: [dirs.workspace], tempDir: dirs.tmp }),
      ...overrides,
    }),
  };
}

const WIN32: PlatformInput = { platform: "win32", arch: "x64", env: {}, procVersion: undefined };

async function exec(r: Rig, policy: SandboxPolicy): ReturnType<RecordingShell["exec"]> {
  return r.service.wrapShell(r.shell, policy).exec("echo hi", { cwd: r.dirs.workspace }, NO_CANCEL);
}

describe("onUnavailable", () => {
  test("disable_execute rejects without spawn", async () => {
    const r = await rig(WIN32);
    expect(r.service.status()).toMatchObject({
      level: "none",
      available: false,
      reason: "unsupported_os",
      platform: "win32",
      onUnavailable: "disable_execute",
    });
    const result = await exec(r, r.policy());
    expect(!result.ok && result.error.code).toBe("sandbox_unavailable");
    expect(r.shell.calls.length).toBe(0);
    expect(r.srt.wrapCalls.length).toBe(0);
    expect(r.srt.initializeCalls.length).toBe(0);
  });

  test("ask needs escape: a plain call is rejected, an approved escape runs", async () => {
    const r = await rig(WIN32, { onUnavailable: "ask" });
    const plain = await exec(r, r.policy());
    expect(!plain.ok && plain.error.code).toBe("sandbox_unavailable");
    expect(r.shell.calls.length).toBe(0);
    const escaped = await exec(r, r.policy({ allowEscape: true }));
    expect(escaped.ok && escaped.value.sandbox).toEqual({
      sandboxed: false,
      level: "none",
      unsandboxedBy: "escape",
      violations: [],
      violationsTruncated: false,
    });
    expect(r.shell.calls.length).toBe(1);
    expect(r.srt.wrapCalls.length).toBe(0);
  });

  test("run_unsandboxed runs and marks", async () => {
    const r = await rig(WIN32, { onUnavailable: "run_unsandboxed" });
    const result = await exec(r, r.policy());
    expect(result.ok && result.value.sandbox?.unsandboxedBy).toBe("run_unsandboxed");
    expect(result.ok && result.value.sandbox?.sandboxed).toBe(false);
    expect(r.shell.calls[0]?.command).toBe("echo hi");
    expect(r.srt.wrapCalls.length).toBe(0);
  });

  test("an escape call is rejected unless escapeRetry is on or the policy is ask", async () => {
    const r = await rig(linuxPlatform());
    expect(r.service.status().available).toBe(true);
    const denied = await exec(r, r.policy({ allowEscape: true }));
    expect(!denied.ok && denied.error.code).toBe("sandbox_unavailable");
    expect(!denied.ok && denied.error.message).toContain("outside the sandbox");
    expect(r.shell.calls.length).toBe(0);
    r.set({ escapeRetry: true });
    const allowed = await exec(r, r.policy({ allowEscape: true }));
    expect(allowed.ok && allowed.value.sandbox?.unsandboxedBy).toBe("escape");
    expect(r.srt.wrapCalls.length).toBe(0);
  });

  const platforms: readonly (readonly [string, PlatformInput])[] = [
    ["win32", WIN32],
    ["freebsd", { platform: "freebsd", arch: "x64", env: {}, procVersion: undefined }],
    ["wsl1", linuxPlatform({ procVersion: "Linux version 4.4.0-19041-Microsoft" })],
    ["ia32", linuxPlatform({ arch: "ia32" })],
  ];
  const values: readonly OnUnavailable[] = ["disable_execute", "ask", "run_unsandboxed"];
  const combos = platforms.flatMap(([name, platform]) =>
    values.map((onUnavailable) => [name, platform, onUnavailable] as const),
  );
  test.each(combos)("%s with %s follows the same table", async (_name, platform, onUnavailable) => {
    const r = await rig(platform, { onUnavailable });
    const result = await exec(r, r.policy());
    expect(result.ok).toBe(onUnavailable === "run_unsandboxed");
    expect(r.shell.calls.length).toBe(onUnavailable === "run_unsandboxed" ? 1 : 0);
  });
});

describe("disabled sandbox", () => {
  test("runs unsandboxed, marks disabled and keeps reason disabled", async () => {
    const r = await rig(linuxPlatform(), { enabled: false });
    expect(r.service.status()).toMatchObject({
      level: "none",
      available: false,
      reason: "disabled",
    });
    const result = await exec(r, r.policy());
    expect(result.ok && result.value.sandbox?.unsandboxedBy).toBe("disabled");
    expect(r.srt.initializeCalls.length).toBe(0);
    expect(r.srt.wrapCalls.length).toBe(0);
    // allowEscape와 무관하게 disabled로 표시한다
    const escaped = await exec(r, r.policy({ allowEscape: true }));
    expect(escaped.ok && escaped.value.sandbox?.unsandboxedBy).toBe("disabled");
  });

  test("turning the setting on makes the next call refresh and isolate", async () => {
    const r = await rig(linuxPlatform(), { enabled: false });
    r.set({ enabled: true });
    const result = await exec(r, r.policy());
    expect(result.ok && result.value.sandbox?.sandboxed).toBe(true);
    expect(r.srt.initializeCalls.length).toBe(1);
    expect(r.service.status().available).toBe(true);
  });

  test("turning the setting off takes effect on the next call and resets srt", async () => {
    const r = await rig(linuxPlatform());
    expect(r.srt.initializeCalls.length).toBe(1);
    r.set({ enabled: false });
    expect(r.service.status().reason).toBe("disabled");
    const result = await exec(r, r.policy());
    expect(result.ok && result.value.sandbox?.unsandboxedBy).toBe("disabled");
    expect(r.srt.resetCalls).toBe(1);
  });

  test("dispose resets srt once", async () => {
    const r = await rig(linuxPlatform());
    await r.service.dispose();
    await r.service.dispose();
    expect(r.srt.resetCalls).toBe(1);
  });
});
