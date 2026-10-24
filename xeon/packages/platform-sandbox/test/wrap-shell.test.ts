import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ShellExecOptions } from "@xeon/contracts/services";
import { createSandboxService, type SandboxServiceHandle } from "../src/service.ts";
import { MAX_VIOLATIONS } from "../src/violations.ts";
import { envAdditions, newCommandId, quoteArgv } from "../src/wrap-shell.ts";
import { seededRandom } from "./support/clock.ts";
import {
  darwinPlatform,
  execFailure,
  fakeOs,
  fakeSrt,
  linuxPlatform,
  makeTestDirs,
  NO_CANCEL,
  recordingShell,
  secretEnvRequest,
  settingsOf,
  type FakeOs,
  type FakeSrt,
  type FakeSrtOptions,
  type TestDirs,
} from "./support/fakes.ts";

interface Fixture {
  readonly dirs: TestDirs;
  readonly os: FakeOs;
  readonly srt: FakeSrt;
  readonly service: SandboxServiceHandle;
}

async function fixture(
  srtOptions: FakeSrtOptions = {},
  extra: { darwin?: boolean; parentEnv?: Record<string, string> } = {},
): Promise<Fixture> {
  const dirs = makeTestDirs();
  const os = fakeOs(dirs);
  const srt = fakeSrt(srtOptions);
  const service = await createSandboxService(
    {
      os,
      settings: () => settingsOf(),
      srt,
      platform: extra.darwin === true ? darwinPlatform() : linuxPlatform(),
      parentEnv: () => extra.parentEnv ?? {},
    },
    new AbortController().signal,
  );
  return { dirs, os, srt, service };
}

function policyFor(f: Fixture): ReturnType<SandboxServiceHandle["defaultPolicy"]> {
  return f.service.defaultPolicy({ workspaceRoots: [f.dirs.workspace], tempDir: f.dirs.tmp });
}

const onOutput = (): void => undefined;

describe("wrapShell", () => {
  test("merges protected paths and forwards options unchanged", async () => {
    const f = await fixture();
    mkdirSync(join(f.dirs.workspace, "pkg"), { recursive: true });
    writeFileSync(join(f.dirs.workspace, ".env"), "A=1");
    writeFileSync(join(f.dirs.workspace, "pkg", ".env.local"), "A=1");
    writeFileSync(join(f.dirs.workspace, ".env.example"), "A=");
    const secretEnv = secretEnvRequest("bash:gh");
    const options: ShellExecOptions = {
      cwd: f.dirs.workspace,
      secretEnv,
      window: { maxBytes: 10, maxLines: 2, minIntervalMs: 5, bytesPerSecond: 100 },
      spill: { afterBytes: 1, afterLines: 1 },
      onOutput,
      timeout: 9,
    };
    const shell = recordingShell();
    const policy = { ...policyFor(f), readDeny: [], writeDeny: [] };
    const result = await f.service
      .wrapShell(shell, policy)
      .exec(["echo", "hi"], options, NO_CANCEL);

    expect(result.ok).toBe(true);
    const call = shell.calls[0];
    expect(call?.command).toEqual(["bash", "-c", "WRAPPED:echo hi"]);
    expect(call?.options?.secretEnv).toBe(secretEnv);
    expect(call?.options?.onOutput).toBe(onOutput);
    expect(call?.options?.window).toBe(options.window);
    expect(call?.options?.spill).toBe(options.spill);
    expect(call?.options?.timeout).toBe(9);
    expect(call?.options?.cwd).toBe(f.dirs.workspace);

    const wrap = f.srt.wrapCalls[0];
    expect(wrap?.binShell).toBe("bash");
    expect(wrap?.cwd).toBe(f.dirs.workspace);
    expect(wrap?.commandId).toMatch(/^[0-9a-f]{32}$/);
    const fs = wrap?.customConfig.filesystem;
    expect(fs?.allowWrite).toContain(f.dirs.workspace);
    const denyRead = (fs?.denyRead ?? []).map(String);
    const denyWrite = (fs?.denyWrite ?? []).map(String);
    expect(denyRead).toContain(f.dirs.data);
    expect(denyRead).toContain(join(f.dirs.home, ".ssh"));
    expect(denyRead).toContain(join(f.dirs.workspace, ".env"));
    expect(denyRead).toContain(join(f.dirs.workspace, "pkg", ".env.local"));
    expect(denyRead).not.toContain(join(f.dirs.workspace, ".env.example"));
    expect(denyWrite).toContain(f.dirs.config);
    expect(denyWrite).toContain(join(f.dirs.workspace, ".git", "hooks"));
    expect(denyWrite).toContain(join(f.dirs.workspace, ".env"));
    expect("network" in (wrap?.customConfig ?? {})).toBe(false);
  });

  test("attaches the report to a successful sandboxed run only", async () => {
    const f = await fixture();
    const good = await f.service
      .wrapShell(recordingShell(), policyFor(f))
      .exec("true", { cwd: f.dirs.workspace }, NO_CANCEL);
    expect(good.ok && good.value.sandbox).toEqual({
      sandboxed: true,
      level: "srt",
      violations: [],
      violationsTruncated: false,
    });
    expect(good.ok && good.value.exitCode).toBe(0);
    const failing = recordingShell(() => execFailure("spawn_error"));
    const bad = await f.service.wrapShell(failing, policyFor(f)).exec("true", undefined, NO_CANCEL);
    expect(bad.ok).toBe(false);
    expect(f.srt.cleanupCalls).toBe(2);
  });

  test("quotes argv commands and keeps string commands as they are", async () => {
    expect(quoteArgv(["printf", "%s", "a'b c"])).toBe(`printf %s 'a'\\''b c'`);
    expect(quoteArgv(["echo", "", "$HOME", "FOO=bar", "~x", "a;b"])).toBe(
      `echo '' '$HOME' 'FOO=bar' '~x' 'a;b'`,
    );
    const f = await fixture();
    const shell = recordingShell();
    await f.service
      .wrapShell(shell, policyFor(f))
      .exec(["printf", "%s", "a'b c"], { cwd: f.dirs.workspace }, NO_CANCEL);
    await f.service.wrapShell(shell, policyFor(f)).exec("echo $HOME | wc", undefined, NO_CANCEL);
    expect(f.srt.wrapCalls.map((call) => call.command)).toEqual([
      `printf %s 'a'\\''b c'`,
      "echo $HOME | wc",
    ]);
  });

  test("passes only the srt env additions", async () => {
    const f = await fixture(
      { wrapEnv: { KEEP: "same", CHANGED: "new", ADDED: "1", GONE: undefined } },
      { parentEnv: { KEEP: "same", CHANGED: "old" } },
    );
    const shell = recordingShell();
    await f.service
      .wrapShell(shell, policyFor(f))
      .exec("true", { env: { MINE: "x" }, cwd: f.dirs.workspace }, NO_CANCEL);
    expect(shell.calls[0]?.options?.env).toEqual({ MINE: "x", CHANGED: "new", ADDED: "1" });
    // 차이가 없으면 env 옵션을 건드리지 않는다
    const same = await fixture({ wrapEnv: { A: "1" } }, { parentEnv: { A: "1" } });
    const shell2 = recordingShell();
    await same.service
      .wrapShell(shell2, policyFor(same))
      .exec("true", { cwd: same.dirs.workspace }, NO_CANCEL);
    expect(shell2.calls[0]?.options && "env" in shell2.calls[0].options).toBe(false);
    expect(envAdditions({ A: "1" }, { A: "1", B: "2" })).toEqual({ B: "2" });
  });

  test("wrap failure skips cleanupAfterCommand and reports name and code only", async () => {
    const boom = Object.assign(new Error("secret path /home/u/.ssh/id leaked in message"), {
      name: "LinuxSandboxProfileError",
      code: "E_PROFILE",
    });
    const f = await fixture({ wrapError: boom });
    const shell = recordingShell();
    const result = await f.service
      .wrapShell(shell, policyFor(f))
      .exec("true", undefined, NO_CANCEL);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("sandbox_failed");
    expect(result.error.message).toContain("LinuxSandboxProfileError");
    expect(result.error.message).toContain("E_PROFILE");
    expect(result.error.message).not.toContain(".ssh");
    expect(f.srt.cleanupCalls).toBe(0);
    expect(shell.calls.length).toBe(0);
  });

  test("an aborted signal never reaches srt or the shell", async () => {
    const f = await fixture();
    const controller = new AbortController();
    controller.abort();
    const shell = recordingShell();
    const result = await f.service
      .wrapShell(shell, policyFor(f))
      .exec("true", undefined, { abortSignal: controller.signal });
    expect(!result.ok && result.error.code).toBe("aborted");
    expect(f.srt.wrapCalls.length).toBe(0);
    expect(shell.calls.length).toBe(0);
  });

  test("an invalid converted config is a bug and a network allow-list is rejected in M1", async () => {
    const f = await fixture({ validateIssues: ["filesystem.denyRead: bad"] });
    const shell = recordingShell();
    expect(
      f.service.wrapShell(shell, policyFor(f)).exec("true", undefined, NO_CANCEL),
    ).rejects.toThrow("invalid srt config");
    const g = await fixture();
    const withNetwork = {
      ...policyFor(g),
      network: { allowedDomains: ["example.com"], deniedDomains: [] },
    };
    const result = await g.service
      .wrapShell(recordingShell(), withNetwork)
      .exec("true", undefined, NO_CANCEL);
    expect(!result.ok && result.error.code).toBe("sandbox_failed");
    expect(g.srt.wrapCalls.length).toBe(0);
  });

  test("glob warnings from srt on Linux are a bug", async () => {
    const f = await fixture({ globWarnings: ["skipped pattern"] });
    expect(
      f.service.wrapShell(recordingShell(), policyFor(f)).exec("true", undefined, NO_CANCEL),
    ).rejects.toThrow("glob patterns");
  });

  test("an empty argv is a spawn error without wrapping", async () => {
    const f = await fixture();
    const result = await f.service
      .wrapShell(recordingShell(), policyFor(f))
      .exec([], undefined, NO_CANCEL);
    expect(!result.ok && result.error.code).toBe("spawn_error");
    expect(f.srt.wrapCalls.length).toBe(0);
  });

  test("cleanup delegates to the shell", async () => {
    const f = await fixture();
    const shell = recordingShell();
    await f.service.wrapShell(shell, policyFor(f)).cleanup(NO_CANCEL);
    expect(shell.cleanupCalls).toBe(1);
  });

  test("violations are merged, truncated and value-free", async () => {
    const longPath = `/very/${"long/".repeat(80)}file`;
    const many = Array.from(
      { length: MAX_VIOLATIONS + 5 },
      (_, i) => `bash(1) deny(1) file-write-create /tmp/f${i}`,
    );
    const lines = [
      "bash(7) deny(1) file-write-create /home/u/.ssh/id",
      "bash(7) deny(1) file-write-create /home/u/.ssh/id",
      "bash(7) deny(1) file-read-data /home/u/.aws/credentials",
      "deny network-outbound evil.example:443 (not on allow-list)",
      `bash(7) deny(1) file-write-create ${longPath}`,
      "bash(7) deny(1) mach-lookup com.apple.something",
      ...many,
    ];
    const f = await fixture({ violationLines: lines }, { darwin: true });
    const result = await f.service
      .wrapShell(recordingShell(), policyFor(f))
      .exec("true", undefined, NO_CANCEL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const report = result.value.sandbox;
    expect(report?.violations.length).toBe(MAX_VIOLATIONS);
    expect(report?.violationsTruncated).toBe(true);
    expect(report?.violations[0]).toEqual({
      source: "seatbelt",
      operation: "file_write",
      target: "/home/u/.ssh/id",
      count: 2,
    });
    expect(report?.violations[1]).toEqual({
      source: "seatbelt",
      operation: "file_read",
      target: "/home/u/.aws/credentials",
      count: 1,
    });
    expect(report?.violations[2]).toEqual({
      source: "proxy",
      operation: "network",
      target: "evil.example:443",
      count: 1,
    });
    expect(report?.violations[3]?.target?.length).toBe(200);
    expect(report?.violations[4]).toEqual({ source: "seatbelt", operation: "other", count: 1 });
  });

  test("start log and report carry no secret values", async () => {
    const secretValue = "s3cr3t-value-xyz-123";
    const f = await fixture({ violationLines: ["bash(1) deny(1) file-read-data /home/u/.npmrc"] });
    const secretEnv = secretEnvRequest("bash:npm");
    const shell = recordingShell();
    const result = await f.service.wrapShell(shell, policyFor(f)).exec(
      "npm view x",
      // exec가 spawn 직전에 넣는 값이 아니라, 호출자가 넘긴 평범한 env 값이 로그와 보고에 새지 않는지 본다
      { env: { SOME_VALUE: secretValue }, secretEnv },
      NO_CANCEL,
    );
    expect(result.ok).toBe(true);
    expect(JSON.stringify(f.os.log.entries)).not.toContain(secretValue);
    expect(JSON.stringify(result.ok ? result.value.sandbox : undefined)).not.toContain(secretValue);
    expect(JSON.stringify(f.srt.wrapCalls)).not.toContain(secretValue);
    // 비밀 참조는 아래 Shell에 그대로 도착한다
    expect(shell.calls[0]?.options?.secretEnv).toBe(secretEnv);
    expect(shell.calls[0]?.options?.env?.["SOME_VALUE"]).toBe(secretValue);
  });
});

describe("command ids", () => {
  test("128-bit hex ids come from the injected random source", () => {
    const a = newCommandId(seededRandom(1));
    const b = newCommandId(seededRandom(1));
    const c = newCommandId(seededRandom(2));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    const random = seededRandom(5);
    expect(newCommandId(random)).not.toBe(newCommandId(random));
  });
});
