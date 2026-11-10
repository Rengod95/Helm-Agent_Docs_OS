import { describe, expect, test } from "bun:test";
import { parseHostArgv } from "../src/argv.ts";
import type { CommandIo } from "../src/host-command.ts";
import {
  autostartStatus,
  installAutostart,
  launchdPlistOf,
  systemdQuote,
  systemdUnitOf,
  uninstallAutostart,
  type AutostartRunResult,
} from "../src/service/autostart.ts";
import { autostartLineOf, runServiceCommand } from "../src/service/commands.ts";
import { FAKE_COMMAND, fakeAutostart } from "./fixtures/autostart-fake.ts";
import { scratchRuntimeDir } from "./fixtures/service-harness.ts";

// 로그인 자동 시작(L4.host-service.spec §3.2, L4.remote.spec §4.2 방식 D). 모든 시험은 가짜 기기를 쓴다: 실제 홈과 launchctl·systemctl은 건드리지 않는다.

const PLIST = "/Users/tester/Library/LaunchAgents/com.fresnel.service.plist";
const UNIT = "/Users/tester/.config/systemd/user/fresnel.service";
const NO_OUTPUT: AutostartRunResult = { exitCode: 0, stdout: "" };

/** 리눅스 가짜 기기의 답: is-enabled는 `enabled`, loginctl은 주어진 Linger 줄 */
function linuxReply(linger: string): (line: string) => AutostartRunResult {
  return (line) => {
    if (line.startsWith("loginctl ")) return { exitCode: 0, stdout: `${linger}\n` };
    if (line === "systemctl --user is-enabled fresnel.service") {
      return { exitCode: 0, stdout: "enabled\n" };
    }
    return NO_OUTPUT;
  };
}

function captureIo(): { readonly io: CommandIo; stdout(): string; stderr(): string } {
  const decoder = new TextDecoder();
  const out: string[] = [];
  const err: string[] = [];
  const sink = (target: string[]): WritableStream<Uint8Array> =>
    new WritableStream<Uint8Array>({
      write(chunk) {
        target.push(decoder.decode(chunk));
      },
    });
  return {
    io: { stdin: new ReadableStream<Uint8Array>(), stdout: sink(out), stderr: sink(err) },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

describe("unit texts", () => {
  test("the launchd plist for a fixed command is exact", () => {
    expect(launchdPlistOf(FAKE_COMMAND)).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        "<dict>",
        "  <key>Label</key>",
        "  <string>com.fresnel.service</string>",
        "  <key>ProgramArguments</key>",
        "  <array>",
        "    <string>/opt/fresnel/bin/fresnel</string>",
        "    <string>service</string>",
        "    <string>run</string>",
        "  </array>",
        "  <key>RunAtLoad</key>",
        "  <true/>",
        "  <key>ProcessType</key>",
        "  <string>Background</string>",
        "</dict>",
        "</plist>",
        "",
      ].join("\n"),
    );
  });

  test("the systemd unit for a fixed command is exact", () => {
    expect(systemdUnitOf(FAKE_COMMAND)).toBe(
      [
        "[Unit]",
        "Description=Fresnel service",
        "",
        "[Service]",
        "Type=simple",
        'ExecStart="/opt/fresnel/bin/fresnel" "service" "run"',
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
      ].join("\n"),
    );
  });

  test("XML escaping: &, <, > and quotes are escaped in the program path and the arguments", () => {
    const plist = launchdPlistOf({
      command: "/Users/a&b/<Fresnel>/fresnel",
      args: ["service", "run", '--name="x"'],
    });
    expect(plist).toContain(
      [
        "  <array>",
        "    <string>/Users/a&amp;b/&lt;Fresnel&gt;/fresnel</string>",
        "    <string>service</string>",
        "    <string>run</string>",
        "    <string>--name=&quot;x&quot;</string>",
        "  </array>",
      ].join("\n"),
    );
    expect(plist).not.toContain("a&b");
    expect(plist).not.toContain("<Fresnel>");
  });

  test("systemd quoting: a space stays inside one token; quote, backslash, % and $ are escaped", () => {
    expect(systemdUnitOf({ command: "/opt/My Apps/fresnel", args: ["service", "run"] })).toContain(
      'ExecStart="/opt/My Apps/fresnel" "service" "run"\n',
    );
    expect(systemdQuote('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(systemdQuote("100%")).toBe('"100%%"');
    expect(systemdQuote("$HOME")).toBe('"$$HOME"');
  });
});

describe("macOS round trip", () => {
  test("install, status, uninstall run the exact launchctl sequence and leave no file", async () => {
    const fake = fakeAutostart({ platform: "darwin" });
    expect(await installAutostart(fake.deps)).toEqual({
      kind: "installed",
      platform: "darwin",
      path: PLIST,
      active: true,
    });
    expect(fake.files.get(PLIST)).toBe(launchdPlistOf(FAKE_COMMAND));
    expect(await autostartStatus(fake.deps)).toEqual({
      platform: "darwin",
      supported: true,
      registered: true,
      active: true,
      path: PLIST,
      linger: null,
    });
    expect(await uninstallAutostart(fake.deps)).toEqual({
      kind: "removed",
      platform: "darwin",
      path: PLIST,
    });
    expect([...fake.files.keys()]).toEqual([]);
    expect(fake.calls).toEqual([
      "launchctl bootout gui/501/com.fresnel.service",
      `launchctl bootstrap gui/501 ${PLIST}`,
      "launchctl print gui/501/com.fresnel.service",
      "launchctl bootout gui/501/com.fresnel.service",
    ]);
  });

  test("a bootstrap failure leaves no file and reports launchctl_failed", async () => {
    const fake = fakeAutostart({
      platform: "darwin",
      reply: (line) =>
        line.startsWith("launchctl bootstrap") ? { exitCode: 5, stdout: "" } : NO_OUTPUT,
    });
    expect(await installAutostart(fake.deps)).toEqual({
      kind: "failed",
      reason: "launchctl_failed",
    });
    expect([...fake.files.keys()]).toEqual([]);
    expect(fake.calls).toEqual([
      "launchctl bootout gui/501/com.fresnel.service",
      `launchctl bootstrap gui/501 ${PLIST}`,
    ]);
  });

  test("uninstall with no plist is not_registered, and launchctl is still asked to bootout", async () => {
    const fake = fakeAutostart({ platform: "darwin" });
    expect(await uninstallAutostart(fake.deps)).toEqual({
      kind: "not_registered",
      platform: "darwin",
      path: PLIST,
    });
    expect(fake.calls).toEqual(["launchctl bootout gui/501/com.fresnel.service"]);
  });

  test("a plist that is registered but not loaded reads as registered and inactive", async () => {
    const fake = fakeAutostart({
      platform: "darwin",
      reply: () => ({ exitCode: 113, stdout: "" }),
    });
    fake.files.set(PLIST, launchdPlistOf(FAKE_COMMAND));
    expect(await autostartStatus(fake.deps)).toEqual({
      platform: "darwin",
      supported: true,
      registered: true,
      active: false,
      path: PLIST,
      linger: null,
    });
  });
});

describe("Linux round trip", () => {
  test("install, status, uninstall with linger on run the exact systemctl sequence and need no advice", async () => {
    const fake = fakeAutostart({ platform: "linux", reply: linuxReply("Linger=yes") });
    expect(await installAutostart(fake.deps)).toEqual({
      kind: "installed",
      platform: "linux",
      path: UNIT,
      active: true,
    });
    expect(fake.files.get(UNIT)).toBe(systemdUnitOf(FAKE_COMMAND));
    expect(await autostartStatus(fake.deps)).toEqual({
      platform: "linux",
      supported: true,
      registered: true,
      active: true,
      path: UNIT,
      linger: true,
    });
    expect(await uninstallAutostart(fake.deps)).toEqual({
      kind: "removed",
      platform: "linux",
      path: UNIT,
    });
    expect([...fake.files.keys()]).toEqual([]);
    expect(fake.calls).toEqual([
      "systemctl --user daemon-reload",
      "systemctl --user enable fresnel.service",
      "loginctl show-user 501 -p Linger",
      "systemctl --user is-enabled fresnel.service",
      "loginctl show-user 501 -p Linger",
      "systemctl --user disable fresnel.service",
      "systemctl --user daemon-reload",
    ]);
  });

  test("with linger off, install asks for the advice and status reports linger false", async () => {
    const fake = fakeAutostart({ platform: "linux", reply: linuxReply("Linger=no") });
    expect(await installAutostart(fake.deps)).toEqual({
      kind: "installed",
      platform: "linux",
      path: UNIT,
      active: true,
      lingerAdvice: true,
    });
    expect(await autostartStatus(fake.deps)).toEqual({
      platform: "linux",
      supported: true,
      registered: true,
      active: true,
      path: UNIT,
      linger: false,
    });
  });

  test("a loginctl that fails leaves linger unknown: status says null and install still asks for the advice", async () => {
    const fake = fakeAutostart({
      platform: "linux",
      reply: (line) =>
        line.startsWith("loginctl ") ? { exitCode: 1, stdout: "" } : linuxReply("")(line),
    });
    expect(await installAutostart(fake.deps)).toEqual({
      kind: "installed",
      platform: "linux",
      path: UNIT,
      active: true,
      lingerAdvice: true,
    });
    expect(await autostartStatus(fake.deps)).toEqual({
      platform: "linux",
      supported: true,
      registered: true,
      active: true,
      path: UNIT,
      linger: null,
    });
  });

  test("a failed enable removes the unit again and reloads systemd, and reports systemctl_failed", async () => {
    const fake = fakeAutostart({
      platform: "linux",
      reply: (line) =>
        line === "systemctl --user enable fresnel.service"
          ? { exitCode: 1, stdout: "" }
          : NO_OUTPUT,
    });
    expect(await installAutostart(fake.deps)).toEqual({
      kind: "failed",
      reason: "systemctl_failed",
    });
    expect([...fake.files.keys()]).toEqual([]);
    expect(fake.calls).toEqual([
      "systemctl --user daemon-reload",
      "systemctl --user enable fresnel.service",
      "systemctl --user daemon-reload",
    ]);
  });

  test("a failed daemon-reload removes the unit and reports systemctl_failed before enabling", async () => {
    const fake = fakeAutostart({
      platform: "linux",
      reply: (line) =>
        line === "systemctl --user daemon-reload" ? { exitCode: 1, stdout: "" } : NO_OUTPUT,
    });
    expect(await installAutostart(fake.deps)).toEqual({
      kind: "failed",
      reason: "systemctl_failed",
    });
    expect([...fake.files.keys()]).toEqual([]);
    expect(fake.calls).toEqual(["systemctl --user daemon-reload"]);
  });

  test("uninstall with no unit is not_registered, and disable and daemon-reload still run", async () => {
    const fake = fakeAutostart({ platform: "linux", reply: linuxReply("Linger=yes") });
    expect(await uninstallAutostart(fake.deps)).toEqual({
      kind: "not_registered",
      platform: "linux",
      path: UNIT,
    });
    expect(fake.calls).toEqual([
      "systemctl --user disable fresnel.service",
      "systemctl --user daemon-reload",
    ]);
  });
});

describe("write failures and unsupported platforms", () => {
  test("a write failure is reported as write_failed and nothing is run", async () => {
    const fake = fakeAutostart({ platform: "darwin", failWrites: true });
    expect(await installAutostart(fake.deps)).toEqual({ kind: "failed", reason: "write_failed" });
    expect(fake.calls).toEqual([]);
    expect([...fake.files.keys()]).toEqual([]);
  });

  test("win32 is unsupported for install, uninstall and status, and nothing is touched", async () => {
    const fake = fakeAutostart({ platform: "win32" });
    expect(await installAutostart(fake.deps)).toEqual({ kind: "unsupported_platform" });
    expect(await uninstallAutostart(fake.deps)).toEqual({ kind: "unsupported_platform" });
    expect(await autostartStatus(fake.deps)).toEqual({
      platform: "win32",
      supported: false,
      registered: false,
      active: false,
      path: null,
      linger: null,
    });
    expect(fake.calls).toEqual([]);
    expect([...fake.files.keys()]).toEqual([]);
  });
});

describe("the status line", () => {
  test("autostartLineOf adds the linger note only on linux with linger off", () => {
    const base = {
      supported: true,
      registered: true,
      path: UNIT,
    } as const;
    expect(autostartLineOf({ ...base, platform: "linux", active: true, linger: false })).toBe(
      "autostart on (linger off)",
    );
    expect(autostartLineOf({ ...base, platform: "linux", active: true, linger: true })).toBe(
      "autostart on",
    );
    expect(autostartLineOf({ ...base, platform: "linux", active: true, linger: null })).toBe(
      "autostart on",
    );
    expect(
      autostartLineOf({ ...base, platform: "darwin", active: false, linger: null, path: PLIST }),
    ).toBe("autostart off");
  });

  test("service status with no service prints the autostart line after the stopped line", async () => {
    const runtime = scratchRuntimeDir();
    try {
      const fake = fakeAutostart({ platform: "linux", reply: linuxReply("Linger=no") });
      const captured = captureIo();
      const code = await runServiceCommand({ kind: "service-status", json: false }, captured.io, {
        runtimeDir: runtime.dir,
        autostart: fake.deps,
      });
      expect(code).toBe(1);
      expect(captured.stdout()).toBe(
        "service not running (no_registration)\nautostart on (linger off)\n",
      );
    } finally {
      runtime.dispose();
    }
  });
});

describe("service install and uninstall output", () => {
  test("install prints the path on stdout and the linger advice on stderr; uninstall says removed, then not registered", async () => {
    const fake = fakeAutostart({ platform: "linux", reply: linuxReply("Linger=no") });
    const install = captureIo();
    expect(
      await runServiceCommand({ kind: "service-install" }, install.io, { autostart: fake.deps }),
    ).toBe(0);
    expect(install.stdout()).toBe(`autostart installed (${UNIT})\n`);
    expect(install.stderr()).toBe(
      'run "loginctl enable-linger" to keep the service after logout\n',
    );

    const removed = captureIo();
    expect(
      await runServiceCommand({ kind: "service-uninstall" }, removed.io, { autostart: fake.deps }),
    ).toBe(0);
    expect(removed.stdout()).toBe("autostart removed\n");
    expect(removed.stderr()).toBe("");

    const again = captureIo();
    expect(
      await runServiceCommand({ kind: "service-uninstall" }, again.io, { autostart: fake.deps }),
    ).toBe(0);
    expect(again.stdout()).toBe("autostart not registered\n");
  });

  test("an install with linger on prints no advice", async () => {
    const fake = fakeAutostart({ platform: "linux", reply: linuxReply("Linger=yes") });
    const captured = captureIo();
    expect(
      await runServiceCommand({ kind: "service-install" }, captured.io, { autostart: fake.deps }),
    ).toBe(0);
    expect(captured.stderr()).toBe("");
  });

  test("a failed install exits 1 with the reason on stderr and nothing on stdout", async () => {
    const fake = fakeAutostart({
      platform: "darwin",
      reply: (line) =>
        line.startsWith("launchctl bootstrap") ? { exitCode: 5, stdout: "" } : NO_OUTPUT,
    });
    const captured = captureIo();
    expect(
      await runServiceCommand({ kind: "service-install" }, captured.io, { autostart: fake.deps }),
    ).toBe(1);
    expect(captured.stdout()).toBe("");
    expect(captured.stderr()).toBe("autostart could not be installed (launchctl_failed)\n");
  });

  test("install on an unsupported platform exits 1 with one stderr line", async () => {
    const fake = fakeAutostart({ platform: "win32" });
    const captured = captureIo();
    expect(
      await runServiceCommand({ kind: "service-install" }, captured.io, { autostart: fake.deps }),
    ).toBe(1);
    expect(captured.stdout()).toBe("");
    expect(captured.stderr()).toBe(
      "login autostart is supported on macOS (launchd) and Linux (systemd) only\n",
    );
  });
});

describe("argv", () => {
  test("service install and service uninstall parse to their commands and refuse extra arguments", () => {
    expect(parseHostArgv(["service", "install"])).toEqual({
      ok: true,
      command: { kind: "service-install" },
    });
    expect(parseHostArgv(["service", "uninstall"])).toEqual({
      ok: true,
      command: { kind: "service-uninstall" },
    });
    expect(parseHostArgv(["service", "install", "--json"])).toEqual({
      ok: false,
      message: "unknown argument: --json",
    });
    expect(parseHostArgv(["service", "uninstall", "now"])).toEqual({
      ok: false,
      message: "unknown argument: now",
    });
  });
});
