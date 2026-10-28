import { describe, expect, test } from "bun:test";
import { describeSandboxStatus, type BinaryName } from "@xeon/contracts/services";
import { createSandboxService } from "../src/service.ts";
import { selectSandboxProvider, type PlatformInput } from "../src/select.ts";
import {
  buildStatus,
  classifyInitFailure,
  classifySrtMessages,
  formatStatusLine,
} from "../src/status.ts";
import {
  darwinPlatform,
  fakeOs,
  fakeSrt,
  linuxPlatform,
  makeTestDirs,
  NO_CANCEL,
  recordingShell,
  selfTestShell,
  settingsOf,
  type FakeSrtOptions,
} from "./support/fakes.ts";
import type { SandboxSettings } from "../src/settings.ts";

async function create(
  platform: PlatformInput,
  options: {
    missing?: readonly BinaryName[];
    srt?: FakeSrtOptions;
    settings?: Partial<SandboxSettings>;
  } = {},
): ReturnType<typeof createSandboxService> {
  const dirs = makeTestDirs();
  return createSandboxService(
    {
      os: fakeOs(dirs, options.missing ?? []),
      settings: () => settingsOf(options.settings),
      srt: fakeSrt(options.srt),
      platform,
      parentEnv: () => ({}),
    },
    new AbortController().signal,
  );
}

describe("status", () => {
  test("reports missing binaries with install hints", async () => {
    const service = await create(linuxPlatform(), { missing: ["bwrap"] });
    const status = service.status();
    expect(status).toMatchObject({
      level: "none",
      available: false,
      reason: "missing_dependency",
      missing: ["bwrap"],
    });
    expect(status.installHints?.[0]).toContain("bubblewrap");
    const summary = describeSandboxStatus(status);
    expect(summary.severity).toBe("critical");
    expect(summary.hints.join(" ")).toContain("apt install");
  });

  test("reports every missing binary on Linux and only rg on macOS", async () => {
    const linux = await create(linuxPlatform(), { missing: ["bwrap", "socat", "rg"] });
    expect(linux.status().missing).toEqual(["bwrap", "socat", "rg"]);
    const darwin = await create(darwinPlatform(), { missing: ["rg"] });
    expect(darwin.status()).toMatchObject({ reason: "missing_dependency", missing: ["rg"] });
    expect(darwin.status().installHints).toEqual(["brew install ripgrep"]);
  });

  test("ready platforms initialize srt once with the found helper paths", async () => {
    const dirs = makeTestDirs();
    const srt = fakeSrt();
    const service = await createSandboxService(
      {
        os: fakeOs(dirs),
        settings: () => settingsOf(),
        srt,
        platform: linuxPlatform(),
        parentEnv: () => ({}),
      },
      new AbortController().signal,
    );
    expect(service.status()).toEqual({
      level: "srt",
      platform: "linux",
      available: true,
      onUnavailable: "disable_execute",
    });
    expect(srt.initializeCalls.length).toBe(1);
    const call = srt.initializeCalls[0];
    expect(call?.enableLogMonitor).toBe(false);
    // 네트워크는 기본 허용이다. 거부 목록이 비어 있고 목록 밖 호스트를 허용한다
    expect(call?.allowUnlistedHosts).toBe(true);
    expect(call?.config.network).toMatchObject({
      allowedDomains: [],
      deniedDomains: [],
      strictAllowlist: false,
    });
    expect(call?.config.enableWeakerNestedSandbox).toBe(false);
    expect(call?.config.bwrapPath).toBe("/usr/bin/bwrap");
    expect(call?.config.socatPath).toBe("/usr/bin/socat");
    expect(call?.config.ripgrep).toEqual({ command: "/usr/bin/rg" });
    expect(describeSandboxStatus(service.status()).severity).toBe("ok");
    const mac = fakeSrt();
    await createSandboxService(
      {
        os: fakeOs(dirs),
        settings: () => settingsOf(),
        srt: mac,
        platform: darwinPlatform(),
        parentEnv: () => ({}),
      },
      new AbortController().signal,
    );
    expect(mac.initializeCalls[0]?.enableLogMonitor).toBe(true);
  });

  test.each([
    ["win32", { platform: "win32", arch: "x64", env: {}, procVersion: undefined }],
    ["freebsd", { platform: "freebsd", arch: "x64", env: {}, procVersion: undefined }],
    [
      "wsl1",
      linuxPlatform({
        procVersion: "Linux version 4.4.0-19041-Microsoft (Microsoft@Microsoft.com)",
      }),
    ],
    ["ia32", linuxPlatform({ arch: "ia32" })],
  ] as const)("maps unsupported platform %s", async (_name, platform) => {
    const status = (await create(platform)).status();
    expect(status.level).toBe("none");
    expect(status.available).toBe(false);
    expect(status.reason).toBe("unsupported_os");
  });

  test("a WSL1 kernel is reported as platform wsl1", async () => {
    expect(
      (await create(linuxPlatform({ procVersion: "4.4.0-Microsoft" }))).status().platform,
    ).toBe("wsl1");
  });

  test("maps what srt itself reports", async () => {
    const unsupported = await create(linuxPlatform(), { srt: { supported: false } });
    expect(unsupported.status().reason).toBe("unsupported_os");
    const socat = await create(linuxPlatform(), { srt: { dependencyErrors: ["socat not found"] } });
    expect(socat.status()).toMatchObject({ reason: "missing_dependency", missing: ["socat"] });
    const seccomp = await create(linuxPlatform(), {
      srt: { dependencyErrors: ["seccomp apply binary not found", "mystery failure"] },
    });
    expect(seccomp.status()).toMatchObject({ reason: "missing_dependency", missing: ["seccomp"] });
    expect(seccomp.status().installHints).toContain("mystery failure");
    const init = await create(linuxPlatform(), {
      srt: {
        initializeError: new Error(
          "Sandbox dependencies not available: bubblewrap (bwrap) not found",
        ),
      },
    });
    expect(init.status()).toMatchObject({ reason: "missing_dependency", missing: ["bwrap"] });
    const odd = await create(linuxPlatform(), {
      srt: { initializeError: new TypeError("secret detail") },
    });
    expect(odd.status().reason).toBe("missing_dependency");
    expect(JSON.stringify(odd.status())).not.toContain("secret detail");
    expect(JSON.stringify(odd.status())).toContain("TypeError");
  });

  test("understands the messages the real srt 0.0.79 reports", () => {
    const provider = selectSandboxProvider(linuxPlatform());
    const detection = classifySrtMessages(
      ["bubblewrap (bwrap) not installed", "socat not installed", "ripgrep (rg) not found"],
      provider,
    );
    expect(detection).toMatchObject({
      kind: "unavailable",
      reason: "missing_dependency",
      missing: ["bwrap", "socat", "rg"],
    });
    const init = classifyInitFailure(
      new Error(
        "Sandbox dependencies not available: bubblewrap (bwrap) not installed, socat not installed",
      ),
      provider,
    );
    expect(init).toMatchObject({ reason: "missing_dependency", missing: ["bwrap", "socat"] });
    expect(classifySrtMessages(["Unsupported platform"], provider)).toMatchObject({
      reason: "unsupported_os",
    });
  });

  test("long unknown srt messages are cut in the install hints", () => {
    const provider = selectSandboxProvider(linuxPlatform());
    const detection = classifySrtMessages(["x".repeat(900)], provider);
    expect(detection.kind === "unavailable" && detection.installHints[0]?.length).toBe(500);
  });

  test("a disabled sandbox warns in the start log and in the doctor summary", async () => {
    const dirs = makeTestDirs();
    const os = fakeOs(dirs);
    const service = await createSandboxService(
      {
        os,
        settings: () => settingsOf({ enabled: false, onUnavailable: "run_unsandboxed" }),
        srt: fakeSrt(),
        platform: linuxPlatform(),
        parentEnv: () => ({}),
      },
      new AbortController().signal,
    );
    const start = os.log.entries.find((entry) => entry.event === "sandbox.status");
    expect(start?.level).toBe("warn");
    expect(start?.fields["line"]).toBe(
      "sandbox level=none platform=linux available=false reason=disabled onUnavailable=run_unsandboxed",
    );
    expect(describeSandboxStatus(service.status()).severity).toBe("warn");
  });

  test("the start log is one line with status fields only", async () => {
    const dirs = makeTestDirs();
    const os = fakeOs(dirs);
    await createSandboxService(
      {
        os,
        settings: () => settingsOf(),
        srt: fakeSrt(),
        platform: linuxPlatform(),
        parentEnv: () => ({}),
      },
      new AbortController().signal,
    );
    const entries = os.log.entries.filter((entry) => entry.event === "sandbox.status");
    expect(entries.length).toBe(1);
    expect(entries[0]?.level).toBe("info");
    expect(entries[0]?.fields["line"]).toBe(
      "sandbox level=srt platform=linux available=true reason=none onUnavailable=disable_execute",
    );
  });

  test("formatStatusLine renders reason none when available", () => {
    const provider = selectSandboxProvider(linuxPlatform());
    const status = buildStatus({
      provider,
      enabled: true,
      detection: { kind: "ready", tools: {} },
      onUnavailable: "ask",
      lastSelfTest: undefined,
    });
    expect(formatStatusLine(status)).toBe(
      "sandbox level=srt platform=linux available=true reason=none onUnavailable=ask",
    );
  });

  test("status after a failed self-test is unavailable with the failed items", async () => {
    const dirs = makeTestDirs();
    const os = fakeOs(dirs);
    const service = await createSandboxService(
      {
        os,
        settings: () => settingsOf(),
        srt: fakeSrt({ passthrough: true }),
        platform: linuxPlatform(),
        parentEnv: () => ({}),
      },
      new AbortController().signal,
    );
    const report = await service.selfTest(selfTestShell(new Set(["network_denied"])), NO_CANCEL);
    expect(report.passed).toBe(false);
    const status = service.status();
    expect(status).toMatchObject({
      level: "none",
      available: false,
      reason: "self_test_failed",
      lastSelfTest: { passed: false, failed: ["network_denied"] },
    });
    expect(describeSandboxStatus(status).severity).toBe("critical");
    // 격리를 쓸 수 없는 상태에서도 다음 자가 시험은 돌 수 있고, 통과하면 복구된다
    const again = await service.selfTest(selfTestShell(), NO_CANCEL);
    expect(again.passed).toBe(true);
    expect(service.status()).toMatchObject({ available: true, level: "srt" });
    expect(service.status().lastSelfTest?.passed).toBe(true);
  });

  test("a failed self-test blocks shell execution until it passes", async () => {
    const dirs = makeTestDirs();
    const service = await createSandboxService(
      {
        os: fakeOs(dirs),
        settings: () => settingsOf(),
        srt: fakeSrt({ passthrough: true }),
        platform: linuxPlatform(),
        parentEnv: () => ({}),
      },
      new AbortController().signal,
    );
    await service.selfTest(selfTestShell(new Set(["env_allowlist"])), NO_CANCEL);
    const shell = recordingShell();
    const policy = service.defaultPolicy({ workspaceRoots: [dirs.workspace], tempDir: dirs.tmp });
    const result = await service.wrapShell(shell, policy).exec("true", undefined, NO_CANCEL);
    expect(!result.ok && result.error.code).toBe("sandbox_unavailable");
    expect(shell.calls.length).toBe(0);
  });

  test("self-test is not recorded when the sandbox is unavailable", async () => {
    const service = await create(linuxPlatform(), { missing: ["socat"] });
    const report = await service.selfTest(selfTestShell(), NO_CANCEL);
    expect(report.passed).toBe(false);
    expect(report.items.every((item) => item.detail === "sandbox_unavailable")).toBe(true);
    expect(service.status().reason).toBe("missing_dependency");
    expect(service.status().lastSelfTest).toBeUndefined();
  });
});

const makeWithSettings = (overrides: Parameters<typeof settingsOf>[0], srt = fakeSrt()) =>
  createSandboxService(
    {
      os: fakeOs(makeTestDirs()),
      settings: () => settingsOf(overrides),
      srt,
      platform: linuxPlatform(),
      parentEnv: () => ({}),
    },
    new AbortController().signal,
  ).then((service) => ({ service, srt }));

describe("network blocklist and nested namespaces", () => {
  test("blocked domains reach srt as deniedDomains and the default policy lists them", async () => {
    const { service, srt } = await makeWithSettings({
      blockedDomains: ["bad.example", "*.tracker.example"],
    });
    expect(srt.initializeCalls[0]?.config.network.deniedDomains).toEqual([
      "bad.example",
      "*.tracker.example",
    ]);
    const policy = service.defaultPolicy({ workspaceRoots: [], tempDir: "/tmp/x" });
    expect(policy.network).toEqual({
      allowedDomains: [],
      deniedDomains: ["bad.example", "*.tracker.example"],
    });
  });

  test("an entry srt rejects is dropped and the others stay blocked", async () => {
    const srt = fakeSrt({ invalidDomains: ["*.com"] });
    const { srt: used } = await makeWithSettings({ blockedDomains: ["*.com", "ok.example"] }, srt);
    expect(used.initializeCalls[0]?.config.network.deniedDomains).toEqual(["ok.example"]);
  });

  test("nestedNamespaces is off by default and on only when the setting asks", async () => {
    const off = await makeWithSettings({});
    expect(off.srt.initializeCalls[0]?.config.enableWeakerNestedSandbox).toBe(false);
    const on = await makeWithSettings({ nestedNamespaces: true });
    expect(on.srt.initializeCalls[0]?.config.enableWeakerNestedSandbox).toBe(true);
  });
});
