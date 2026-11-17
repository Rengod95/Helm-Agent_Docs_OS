import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SandboxArgvRequest, SandboxPolicy } from "@fresnel/contracts/services";
import type { PlatformInput } from "../src/select.ts";
import { createSandboxService, type SandboxServiceHandle } from "../src/service.ts";
import type { SandboxSettings } from "../src/settings.ts";
import { quoteArgv } from "../src/wrap-shell.ts";
import {
  fakeOs,
  fakeSrt,
  linuxPlatform,
  makeTestDirs,
  NO_CANCEL,
  recordingShell,
  settingsOf,
  type FakeSrt,
  type FakeSrtOptions,
  type TestDirs,
} from "./support/fakes.ts";

// L0.sandbox.spec §4.9 wrapArgv 시험. wrapShell과 같은 정책 변환·격리 불가 판정을 쓰는지 값으로 본다.

const WIN32: PlatformInput = { platform: "win32", arch: "x64", env: {}, procVersion: undefined };

interface Rig {
  readonly dirs: TestDirs;
  readonly srt: FakeSrt;
  readonly service: SandboxServiceHandle;
  policy(overrides?: Partial<SandboxPolicy>): SandboxPolicy;
}

interface RigOptions {
  readonly srt?: FakeSrtOptions;
  readonly platform?: PlatformInput;
  readonly settings?: Partial<SandboxSettings>;
  readonly parentEnv?: Record<string, string>;
}

async function rig(options: RigOptions = {}): Promise<Rig> {
  const dirs = makeTestDirs();
  const srt = fakeSrt(options.srt);
  const service = await createSandboxService(
    {
      os: fakeOs(dirs),
      settings: () => settingsOf(options.settings),
      srt,
      platform: options.platform ?? linuxPlatform(),
      parentEnv: () => options.parentEnv ?? {},
    },
    new AbortController().signal,
  );
  return {
    dirs,
    srt,
    service,
    policy: (overrides = {}) => ({
      ...service.defaultPolicy({ workspaceRoots: [dirs.workspace], tempDir: dirs.tmp }),
      ...overrides,
    }),
  };
}

const tool = (overrides: Partial<SandboxArgvRequest> = {}): SandboxArgvRequest => ({
  command: "node",
  args: ["server.js"],
  cwd: undefined,
  ...overrides,
});

/** `export TMPDIR=<폴더>; exec …` 명령에서 임시 폴더를 읽는다 */
function tempOf(command: string | undefined): string {
  const match = /^export TMPDIR=(\S+); exec /.exec(command ?? "");
  return match?.[1] ?? "";
}

describe("wrapArgv", () => {
  test("returns the srt argv for an available sandbox, quotes the command once, passes cwd through", async () => {
    const r = await rig();
    const result = await r.service.wrapArgv(
      r.policy(),
      tool({ command: "printf", args: ["%s", "a'b c"], cwd: r.dirs.workspace }),
      NO_CANCEL,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sandboxed).toBe(true);
    expect(result.value.unsandboxedBy).toBeUndefined();
    expect(result.value.argv).toEqual(["bash", "-c", `WRAPPED:printf %s 'a'\\''b c'`]);
    expect(r.srt.wrapCalls.length).toBe(1);
    expect(r.srt.wrapCalls[0]?.command).toBe(`printf %s 'a'\\''b c'`);
    expect(r.srt.wrapCalls[0]?.command).toBe(quoteArgv(["printf", "%s", "a'b c"]));
    expect(r.srt.wrapCalls[0]?.binShell).toBe("bash");
    expect(r.srt.wrapCalls[0]?.cwd).toBe(r.dirs.workspace);
    expect(r.srt.cleanupCalls).toBe(0);
  });

  test("env holds only the srt entries that differ from the parent env", async () => {
    const r = await rig({
      srt: { wrapEnv: { KEEP: "same", CHANGED: "new", ADDED: "1", GONE: undefined } },
      parentEnv: { KEEP: "same", CHANGED: "old" },
    });
    const result = await r.service.wrapArgv(r.policy(), tool(), NO_CANCEL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.env).toEqual({ CHANGED: "new", ADDED: "1" });
  });

  test("converts the policy like wrapShell, so protected paths stay even when the caller passes an empty policy", async () => {
    const r = await rig();
    writeFileSync(join(r.dirs.workspace, ".env"), "A=1");
    const policy = { ...r.policy(), readDeny: [], writeDeny: [] };
    const shellResult = await r.service
      .wrapShell(recordingShell(), policy)
      .exec("true", { cwd: r.dirs.workspace }, NO_CANCEL);
    const argvResult = await r.service.wrapArgv(
      policy,
      tool({ command: "true", args: [], cwd: r.dirs.workspace }),
      NO_CANCEL,
    );
    expect(shellResult.ok).toBe(true);
    expect(argvResult.ok).toBe(true);
    const [viaShell, viaArgv] = r.srt.wrapCalls;
    expect(viaArgv?.customConfig).toEqual(viaShell?.customConfig);
    const fs = viaArgv?.customConfig.filesystem;
    const denyRead = (fs?.denyRead ?? []).map(String);
    const denyWrite = (fs?.denyWrite ?? []).map(String);
    expect(fs?.allowWrite).toContain(r.dirs.workspace);
    expect(denyRead).toContain(r.dirs.data);
    expect(denyRead).toContain(join(r.dirs.home, ".ssh"));
    expect(denyRead).toContain(join(r.dirs.workspace, ".env"));
    expect(denyWrite).toContain(r.dirs.config);
    expect(denyWrite).toContain(join(r.dirs.workspace, ".git", "hooks"));
    expect("network" in (viaArgv?.customConfig ?? {})).toBe(false);
  });

  test("cleanup runs the srt cleanup once however often it is called", async () => {
    const r = await rig();
    const result = await r.service.wrapArgv(r.policy(), tool(), NO_CANCEL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(r.srt.cleanupCalls).toBe(0);
    result.value.cleanup();
    result.value.cleanup();
    expect(r.srt.cleanupCalls).toBe(1);
  });

  test("a wrap failure is err failed with name and code only, and skips cleanupAfterCommand", async () => {
    const boom = Object.assign(new Error("secret path /home/u/.ssh/id leaked in message"), {
      name: "LinuxSandboxProfileError",
      code: "E_PROFILE",
    });
    const r = await rig({ srt: { wrapError: boom } });
    const result = await r.service.wrapArgv(r.policy(), tool(), NO_CANCEL);
    expect(!result.ok && result.error).toEqual({
      kind: "failed",
      message: "sandbox wrap failed: LinuxSandboxProfileError (E_PROFILE)",
    });
    expect(!result.ok && result.error.kind === "failed" && result.error.message).not.toContain(
      ".ssh",
    );
    expect(r.srt.cleanupCalls).toBe(0);
  });

  test("an aborted signal is err aborted and srt is never called", async () => {
    const r = await rig();
    const controller = new AbortController();
    controller.abort();
    const result = await r.service.wrapArgv(r.policy(), tool(), {
      abortSignal: controller.signal,
    });
    expect(!result.ok && result.error).toEqual({ kind: "aborted" });
    expect(r.srt.wrapCalls.length).toBe(0);
  });

  test("unavailable with disable_execute is err unavailable with the status reason, and srt is never called", async () => {
    const r = await rig({ platform: WIN32, settings: { onUnavailable: "disable_execute" } });
    expect(r.service.status()).toMatchObject({ available: false, reason: "unsupported_os" });
    const result = await r.service.wrapArgv(r.policy(), tool(), NO_CANCEL);
    expect(!result.ok && result.error).toEqual({ kind: "unavailable", reason: "unsupported_os" });
    expect(r.srt.wrapCalls.length).toBe(0);
    expect(r.srt.initializeCalls.length).toBe(0);
  });

  test("run_unsandboxed returns the plain argv marked run_unsandboxed, with no env and no srt call", async () => {
    const r = await rig({ platform: WIN32, settings: { onUnavailable: "run_unsandboxed" } });
    const result = await r.service.wrapArgv(
      r.policy(),
      tool({ args: ["server.js", "--flag"], cwd: r.dirs.workspace }),
      NO_CANCEL,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sandboxed).toBe(false);
    expect(result.value.unsandboxedBy).toBe("run_unsandboxed");
    expect(result.value.argv).toEqual(["node", "server.js", "--flag"]);
    expect(result.value.env).toEqual({});
    expect(r.srt.wrapCalls.length).toBe(0);
    result.value.cleanup();
    expect(r.srt.cleanupCalls).toBe(0);
  });

  test("a disabled sandbox returns the plain argv marked disabled", async () => {
    const r = await rig({ settings: { enabled: false } });
    expect(r.service.status().reason).toBe("disabled");
    const result = await r.service.wrapArgv(r.policy(), tool(), NO_CANCEL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sandboxed).toBe(false);
    expect(result.value.unsandboxedBy).toBe("disabled");
    expect(result.value.argv).toEqual(["node", "server.js"]);
    expect(result.value.env).toEqual({});
    expect(r.srt.wrapCalls.length).toBe(0);
  });

  test("allowEscape is refused without escapeRetry and runs plain as escape with it", async () => {
    const r = await rig();
    const refused = await r.service.wrapArgv(r.policy({ allowEscape: true }), tool(), NO_CANCEL);
    expect(!refused.ok && refused.error).toEqual({ kind: "unavailable", reason: undefined });
    expect(r.srt.wrapCalls.length).toBe(0);
    const allowed = await rig({ settings: { escapeRetry: true } });
    const ran = await allowed.service.wrapArgv(
      allowed.policy({ allowEscape: true }),
      tool(),
      NO_CANCEL,
    );
    expect(ran.ok).toBe(true);
    if (!ran.ok) return;
    expect(ran.value.sandboxed).toBe(false);
    expect(ran.value.unsandboxedBy).toBe("escape");
    expect(ran.value.argv).toEqual(["node", "server.js"]);
  });

  test("a non-empty network allow-list is err failed and srt is never called", async () => {
    const r = await rig();
    const result = await r.service.wrapArgv(
      { ...r.policy(), network: { allowedDomains: ["example.com"], deniedDomains: [] } },
      tool(),
      NO_CANCEL,
    );
    expect(!result.ok && result.error).toEqual({
      kind: "failed",
      message: "network allow-list policy is not supported yet",
    });
    expect(r.srt.wrapCalls.length).toBe(0);
  });

  test("the no-write profile gives the process one private empty temp folder, exports it as TMPDIR and removes it on cleanup", async () => {
    const r = await rig();
    const policy = r.service.defaultPolicy({
      workspaceRoots: [],
      tempDir: r.dirs.tmp,
      profile: "no-write",
      readRoots: [r.dirs.workspace],
    });
    const first = await r.service.wrapArgv(
      policy,
      tool({ command: "host", args: ["a b"] }),
      NO_CANCEL,
    );
    const second = await r.service.wrapArgv(policy, tool({ command: "host", args: [] }), NO_CANCEL);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const [one, two] = r.srt.wrapCalls;
    const oneTemp = tempOf(one?.command);
    const twoTemp = tempOf(two?.command);
    expect(oneTemp.startsWith(r.dirs.tmp)).toBe(true);
    expect(oneTemp).not.toBe(twoTemp);
    expect(one?.command).toBe(`export TMPDIR=${oneTemp}; exec host 'a b'`);
    expect(readdirSync(oneTemp)).toEqual([]);
    // 쓸 수 있는 곳은 그 폴더 하나뿐이다
    expect(one?.customConfig.filesystem?.allowWrite).toEqual([oneTemp]);
    expect(one?.binShell).toBe("/bin/bash");
    first.value.cleanup();
    expect(existsSync(oneTemp)).toBe(false);
    expect(existsSync(twoTemp)).toBe(true);
    second.value.cleanup();
    expect(existsSync(twoTemp)).toBe(false);
  });

  test("the no-write profile reads only the allow-list and keeps the network policy of the sandbox", async () => {
    const r = await rig({ settings: { blockedDomains: ["blocked.example"] } });
    const plugin = join(r.dirs.root, "plugin");
    mkdirSync(plugin, { recursive: true });
    const policy = r.service.defaultPolicy({
      workspaceRoots: [],
      tempDir: r.dirs.tmp,
      profile: "no-write",
      readRoots: [plugin],
    });
    expect(policy.profile).toBe("no-write");
    expect(policy.writeRoots).toEqual([]);
    expect(policy.network).toEqual({ allowedDomains: [], deniedDomains: ["blocked.example"] });
    expect(policy.allowEscape).toBe(false);
    expect(policy.readAllow).toContain(plugin);
    expect(policy.readAllow).toContain("/bin/bash");
    const wrapped = await r.service.wrapArgv(policy, tool(), NO_CANCEL);
    expect(wrapped.ok).toBe(true);
    const fs = r.srt.wrapCalls[0]?.customConfig.filesystem;
    expect(fs?.denyRead).toContain("/");
    expect((fs?.allowRead ?? []).map(String)).toContain(plugin);
    // 보호 경로는 읽기 허용 목록에 들어가도 줄지 않는다
    expect((fs?.denyRead ?? []).map(String)).toContain(r.dirs.data);
    expect((fs?.allowRead ?? []).map(String)).not.toContain(r.dirs.data);
    if (wrapped.ok) wrapped.value.cleanup();
  });

  test("a no-write policy whose temp folder cannot be made is refused as a value", async () => {
    const r = await rig();
    const blocker = join(r.dirs.root, "file");
    writeFileSync(blocker, "x");
    const failing = await createSandboxService(
      {
        os: fakeOs({ ...r.dirs, tmp: blocker }),
        settings: () => settingsOf(),
        srt: fakeSrt(),
        platform: linuxPlatform(),
        parentEnv: () => ({}),
      },
      new AbortController().signal,
    );
    const policy = failing.defaultPolicy({
      workspaceRoots: [],
      tempDir: blocker,
      profile: "no-write",
    });
    const result = await failing.wrapArgv(policy, tool(), NO_CANCEL);
    expect(result).toEqual({
      ok: false,
      error: { kind: "failed", message: "no-write sandbox could not prepare its temp folder" },
    });
  });
});
