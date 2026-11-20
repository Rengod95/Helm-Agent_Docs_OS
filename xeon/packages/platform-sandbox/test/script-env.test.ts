import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExecutionError, type SandboxPolicy } from "@fresnel/contracts/services";
import { canonicalizePath } from "../src/paths.ts";
import type { PlatformInput } from "../src/select.ts";
import { createSandboxService, type SandboxServiceHandle } from "../src/service.ts";
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
  type FakeSrt,
  type FakeSrtOptions,
  type TestDirs,
} from "./support/fakes.ts";

// L0.sandbox.spec §4.9 "script-env" 프로필(가져온 훅). 정책 모양, 임시 폴더, 프로필 끝의 읽기 예외와 막기, 거부 경로, 결정 규칙을 값으로 본다.

const WIN32: PlatformInput = { platform: "win32", arch: "x64", env: {}, procVersion: undefined };

/** 스크립트 실행기의 막기 규칙이 붙는지 보는 Seatbelt 프로필 모양(srt가 만든 것과 같은 자리에 `'`가 든다) */
const PROFILE = `(version 1)\n(deny default (with message "it's"))\n(deny file-read* (subpath "/"))\n(allow file-read* (subpath "/usr/bin"))`;

/** 스크립트 실행기가 Mach 서비스 막기에 쓰는 목록(Seatbelt 규칙의 이름 그대로). 경로 존재와 무관하다 */
const DARWIN_MACH_DENY = [
  "com.apple.SecurityServer",
  "com.apple.securityd.xpc",
  "com.apple.coreservices.launchservicesd",
  "com.apple.lsd.mapdb",
  "com.apple.PowerManagement.control",
  "com.apple.distributed_notifications@Uv3",
  "com.apple.audio.systemsoundserver",
];

interface Rig {
  readonly dirs: TestDirs;
  readonly srt: FakeSrt;
  readonly service: SandboxServiceHandle;
  /** 프로젝트 폴더(절대 경로, 존재한다) */
  readonly project: string;
  /** 보호 경로 `~/.claude` 안의 읽기 예외 폴더(존재한다). 안에 `helper.py`가 있다 */
  readonly hooks: string;
}

interface RigOptions {
  readonly srt?: FakeSrtOptions;
  readonly platform?: PlatformInput;
  readonly settings?: Partial<SandboxSettings>;
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
      parentEnv: () => ({}),
    },
    new AbortController().signal,
  );
  const project = join(dirs.root, "project");
  mkdirSync(project, { recursive: true });
  const hooks = join(dirs.home, ".claude", "hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, "helper.py"), "helper");
  writeFileSync(join(dirs.home, ".claude", "secret.json"), "secret");
  return { dirs, srt, service, project, hooks };
}

function scriptPolicy(r: Rig, overrides: Partial<SandboxPolicy> = {}): SandboxPolicy {
  return {
    ...r.service.defaultPolicy({
      workspaceRoots: [r.dirs.workspace],
      tempDir: r.dirs.tmp,
      profile: "script-env",
      projectDir: r.project,
      readCarveOuts: [],
      systemTools: true,
    }),
    ...overrides,
  };
}

const tool = { command: "host", args: ["a b"], cwd: undefined };

/** `export TMPDIR=<폴더>; exec …` 명령에서 임시 폴더를 읽는다 */
function tempOf(command: string | undefined): string {
  const match = /^export TMPDIR=(\S+); exec /.exec(command ?? "");
  return match?.[1] ?? "";
}

describe("defaultPolicy script-env", () => {
  test("reads everything but the protected paths and writes only the project, with the script restrictions", async () => {
    const r = await rig({
      platform: darwinPlatform(),
      srt: { seatbeltProfile: PROFILE },
      settings: { blockedDomains: ["blocked.example"] },
    });
    const policy = r.service.defaultPolicy({
      workspaceRoots: [r.dirs.workspace],
      tempDir: r.dirs.tmp,
      profile: "script-env",
      projectDir: r.project,
      readCarveOuts: [r.hooks],
      systemTools: true,
    });
    expect(policy.profile).toBe("script-env");
    expect(policy.readAllow).toBeUndefined();
    expect(policy.readAllowLiteral).toBeUndefined();
    expect(policy.writeRoots).toEqual([canonicalizePath(r.project)]);
    // 자격 폴더는 기본으로 쓰기만 막으므로 읽기 거부 목록에 없다. Fresnel 데이터와 extra 항목만 읽기를 막는다
    expect(policy.readDeny).not.toContain(join(r.dirs.home, ".ssh"));
    expect(policy.readDeny).not.toContain(join(r.dirs.home, ".claude"));
    expect(policy.readDeny).toContain(r.dirs.data);
    expect(policy.writeDeny).toContain(join(r.dirs.home, ".ssh"));
    expect(policy.writeDeny).toContain(join(r.dirs.home, ".claude"));
    expect(policy.writeDeny).toContain(join(r.project, ".git", "hooks"));
    expect(policy.writeDeny).toContain(join(r.project, ".git", "config"));
    expect(policy.network).toEqual({ allowedDomains: [], deniedDomains: ["blocked.example"] });
    expect(policy.allowEscape).toBe(false);
    expect(policy.readCarveOuts).toEqual([r.hooks]);
    expect(policy.machDeny).toEqual(DARWIN_MACH_DENY);
    expect(policy.systemInfoDeny).toBe(true);
    // 도구 막기는 쓰기 없음 프로필에 systemTools를 켰을 때와 같은 값이다
    const noWrite = r.service.defaultPolicy({
      workspaceRoots: [],
      tempDir: r.dirs.tmp,
      profile: "no-write",
      readRoots: [r.project],
      systemTools: true,
    });
    expect(policy.toolDeny).toEqual(noWrite.toolDeny);
    expect(policy.machDeny).toEqual(noWrite.machDeny);
    expect(policy.systemInfoDeny).toEqual(noWrite.systemInfoDeny);
  });

  test("on Linux the script environment has the empty restriction lists and no system-info flag", async () => {
    const r = await rig();
    const policy = scriptPolicy(r);
    expect(policy.toolDeny).toEqual([]);
    expect(policy.machDeny).toEqual([]);
    expect(policy.systemInfoDeny).toBeUndefined();
    expect(policy.readAllow).toBeUndefined();
  });

  test("a relative or missing project folder gives no write root", async () => {
    const r = await rig();
    const relative = r.service.defaultPolicy({
      workspaceRoots: [],
      tempDir: r.dirs.tmp,
      profile: "script-env",
      projectDir: "relative/project",
    });
    const missing = r.service.defaultPolicy({
      workspaceRoots: [],
      tempDir: r.dirs.tmp,
      profile: "script-env",
    });
    expect(relative.writeRoots).toEqual([]);
    expect(missing.writeRoots).toEqual([]);
  });

  test("the setting of extra write roots does not reach the script environment", async () => {
    const extra = join(makeTestDirs().root, "extra");
    mkdirSync(extra, { recursive: true });
    const r = await rig({ settings: { writeRootsExtra: [extra] } });
    expect(scriptPolicy(r).writeRoots).toEqual([canonicalizePath(r.project)]);
    const wrapped = await r.service.wrapArgv(scriptPolicy(r), tool, NO_CANCEL);
    expect(wrapped.ok).toBe(true);
    const allowed = (r.srt.wrapCalls[0]?.customConfig.filesystem?.allowWrite ?? []).map(String);
    expect(allowed).not.toContain(extra);
    if (wrapped.ok) wrapped.value.cleanup();
  });
});

describe("wrapArgv script-env: temp folder and read rules", () => {
  test("the write allow list is the project and this call's temp folder, the read side has no allow list", async () => {
    const r = await rig();
    const wrapped = await r.service.wrapArgv(scriptPolicy(r), tool, NO_CANCEL);
    expect(wrapped.ok).toBe(true);
    const call = r.srt.wrapCalls[0];
    const temp = tempOf(call?.command);
    expect(temp.startsWith(r.dirs.tmp)).toBe(true);
    expect(call?.command).toBe(`export TMPDIR=${temp}; exec host 'a b'`);
    expect(readdirSync(temp)).toEqual([]);
    const fs = call?.customConfig.filesystem;
    expect((fs?.allowWrite ?? []).map(String)).toEqual(
      [canonicalizePath(r.project), temp].toSorted(),
    );
    expect(fs?.allowRead).toBeUndefined();
    expect((fs?.denyRead ?? []).map(String)).not.toContain(join(r.dirs.home, ".ssh"));
    expect((fs?.denyRead ?? []).map(String)).toContain(r.dirs.data);
    expect((fs?.denyRead ?? []).map(String)).not.toContain("/");
    expect((fs?.denyWrite ?? []).map(String)).toContain(canonicalizePath("/tmp/claude"));
    expect(call?.binShell).toBe("bash");
    if (!wrapped.ok) return;
    wrapped.value.cleanup();
    expect(existsSync(temp)).toBe(false);
  });
});

describe("wrapArgv script-env: profile tail with read carve-outs", () => {
  test("the carve-out allows come first in the tail, then the tool denies, and the tail is applied once", async () => {
    const r = await rig({ platform: darwinPlatform(), srt: { seatbeltProfile: PROFILE } });
    const helper = join(r.hooks, "helper.py");
    const base = scriptPolicy(r, {
      readCarveOuts: [helper, r.hooks],
      toolDeny: ["/bin/launchctl"],
      machDeny: [],
      systemInfoDeny: false,
    });
    const result = await r.service.wrapArgv(base, tool, NO_CANCEL);
    expect(result.ok).toBe(true);
    const command = result.ok ? (result.value.argv[2] ?? "") : "";
    expect(command.split("; script tools").length).toBe(2);
    const tail = command.slice(
      command.indexOf("; script tools"),
      command.indexOf("' /bin/bash -c '"),
    );
    expect(tail).toBe(
      [
        "; script tools",
        `(allow file-read* (literal "${helper}"))`,
        `(allow file-read* (subpath "${r.hooks}"))`,
        '(deny file-read* (literal "/bin/launchctl"))',
        '(deny process-exec (literal "/bin/launchctl"))',
        "",
      ].join("\n"),
    );
    if (result.ok) result.value.cleanup();
  });

  test("a carve-out under the protected folder is accepted and the protected sibling stays out of the tail", async () => {
    const r = await rig({ platform: darwinPlatform(), srt: { seatbeltProfile: PROFILE } });
    const result = await r.service.wrapArgv(
      scriptPolicy(r, {
        readCarveOuts: [r.hooks],
        toolDeny: [],
        machDeny: [],
        systemInfoDeny: false,
      }),
      tool,
      NO_CANCEL,
    );
    expect(result.ok).toBe(true);
    const command = result.ok ? (result.value.argv[2] ?? "") : "";
    expect(command).toContain(`(allow file-read* (subpath "${r.hooks}"))`);
    expect(command).not.toContain(join(r.dirs.home, ".claude", "secret.json"));
    if (result.ok) result.value.cleanup();
  });

  const refusals: readonly {
    readonly name: string;
    readonly carveOut: (r: Rig) => string;
    readonly message: string;
  }[] = [
    {
      name: "the Fresnel data folder itself (read-denied)",
      carveOut: (r) => r.dirs.data,
      message: "sandbox profile tail rejected a read carve-out that contains a protected path",
    },
    {
      name: "the home folder, an ancestor of protected paths",
      carveOut: (r) => r.dirs.home,
      message: "sandbox profile tail rejected a read carve-out that contains a protected path",
    },
    {
      name: "the root folder",
      carveOut: () => "/",
      message: "sandbox profile tail rejected a read carve-out that contains a protected path",
    },
    {
      name: "a relative path",
      carveOut: () => "relative/hooks",
      message: "sandbox profile tail rejected an unsafe path or service name",
    },
    {
      name: "a missing path",
      carveOut: (r) => join(r.dirs.home, "missing"),
      message: "sandbox profile tail rejected an unsafe path or service name",
    },
    {
      name: "a path with a quote character",
      carveOut: (r) => join(r.hooks, 'a"b'),
      message: "sandbox profile tail rejected an unsafe path or service name",
    },
  ];
  for (const refusal of refusals) {
    test(`a read carve-out of ${refusal.name} is refused as a value, before srt and temp folder`, async () => {
      const r = await rig({ platform: darwinPlatform(), srt: { seatbeltProfile: PROFILE } });
      mkdirSync(r.dirs.data, { recursive: true });
      const result = await r.service.wrapArgv(
        scriptPolicy(r, { readCarveOuts: [refusal.carveOut(r)] }),
        tool,
        NO_CANCEL,
      );
      expect(result).toEqual({ ok: false, error: { kind: "failed", message: refusal.message } });
      expect(r.srt.wrapCalls.length).toBe(0);
      expect(readdirSync(r.dirs.tmp)).toEqual([]);
    });
  }

  test("a read carve-out of a folder listed in protectedPaths.extra is refused as a value", async () => {
    // 설정 목록은 같은 배열을 가리키므로 폴더를 만든 뒤에 넣어도 된다
    const listed: string[] = [];
    const r = await rig({
      platform: darwinPlatform(),
      srt: { seatbeltProfile: PROFILE },
      settings: { protectedPathsExtra: listed },
    });
    const vault = join(r.dirs.root, "vault");
    mkdirSync(vault, { recursive: true });
    listed.push(vault);
    const result = await r.service.wrapArgv(
      scriptPolicy(r, { readCarveOuts: [vault] }),
      tool,
      NO_CANCEL,
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "failed",
        message: "sandbox profile tail rejected a read carve-out that contains a protected path",
      },
    });
    expect(r.srt.wrapCalls.length).toBe(0);
  });

  test("a read carve-out of a file named like a write-only protected name (.env in the project) is accepted, since reads of it are not denied by default", async () => {
    const r = await rig({ platform: darwinPlatform(), srt: { seatbeltProfile: PROFILE } });
    const envPath = join(r.project, ".env");
    writeFileSync(envPath, "A=1");
    const result = await r.service.wrapArgv(
      scriptPolicy(r, { readCarveOuts: [envPath] }),
      tool,
      NO_CANCEL,
    );
    expect(result.ok).toBe(true);
    const command = result.ok ? (result.value.argv[2] ?? "") : "";
    expect(command).toContain(`(allow file-read* (literal "${envPath}"))`);
    if (result.ok) result.value.cleanup();
  });
});

describe("wrapArgv script-env: provider and profile guards", () => {
  test("a read carve-out on bwrap is refused as a value (unsupported on this provider)", async () => {
    const r = await rig();
    const result = await r.service.wrapArgv(
      scriptPolicy(r, { readCarveOuts: [r.hooks] }),
      tool,
      NO_CANCEL,
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "failed",
        message: "read carve-outs are not supported on this sandbox provider",
      },
    });
    expect(r.srt.wrapCalls.length).toBe(0);
  });

  test("without carve-outs bwrap runs the script environment with the read-deny list only", async () => {
    const r = await rig();
    const result = await r.service.wrapArgv(scriptPolicy(r), tool, NO_CANCEL);
    expect(result.ok).toBe(true);
    expect(r.srt.wrapCalls[0]?.customConfig.filesystem?.allowRead).toBeUndefined();
    if (result.ok) {
      expect(result.value.sandboxed).toBe(true);
      result.value.cleanup();
    }
  });

  test("read carve-outs are refused for a profile other than script-env", async () => {
    const r = await rig();
    const result = await r.service.wrapArgv(
      {
        ...r.service.defaultPolicy({
          workspaceRoots: [],
          tempDir: r.dirs.tmp,
          profile: "no-write",
          readRoots: [r.project],
        }),
        readCarveOuts: [r.hooks],
      },
      tool,
      NO_CANCEL,
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "failed", message: "read carve-outs need the script-env profile" },
    });
  });

  test("an unavailable sandbox refuses the script environment even with run_unsandboxed", async () => {
    const r = await rig({ platform: WIN32, settings: { onUnavailable: "run_unsandboxed" } });
    const result = await r.service.wrapArgv(scriptPolicy(r), tool, NO_CANCEL);
    expect(result).toEqual({ ok: false, error: { kind: "unavailable", reason: "unsupported_os" } });
    expect(r.srt.wrapCalls.length).toBe(0);
  });

  test("an unavailable sandbox refuses the script environment with disable_execute too", async () => {
    const r = await rig({ platform: WIN32, settings: { onUnavailable: "disable_execute" } });
    const result = await r.service.wrapArgv(scriptPolicy(r), tool, NO_CANCEL);
    expect(result).toEqual({ ok: false, error: { kind: "unavailable", reason: "unsupported_os" } });
    expect(r.srt.wrapCalls.length).toBe(0);
  });

  test("a disabled sandbox runs the script environment plain, marked disabled, as for no-write", async () => {
    const r = await rig({ settings: { enabled: false } });
    const result = await r.service.wrapArgv(scriptPolicy(r), tool, NO_CANCEL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sandboxed).toBe(false);
    expect(result.value.unsandboxedBy).toBe("disabled");
    expect(result.value.argv).toEqual(["host", "a b"]);
    expect(r.srt.wrapCalls.length).toBe(0);
  });

  test("allowEscape is refused for the script environment even with escapeRetry on", async () => {
    const r = await rig({ settings: { escapeRetry: true } });
    const result = await r.service.wrapArgv(
      scriptPolicy(r, { allowEscape: true }),
      tool,
      NO_CANCEL,
    );
    expect(result).toEqual({ ok: false, error: { kind: "unavailable", reason: undefined } });
    expect(r.srt.wrapCalls.length).toBe(0);
  });

  test("wrapShell refuses the script environment, since only wrapArgv adds the temp folder and the script restrictions", async () => {
    const r = await rig();
    const shell = recordingShell();
    const result = await r.service
      .wrapShell(shell, scriptPolicy(r))
      .exec("true", { cwd: r.project }, NO_CANCEL);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ExecutionError);
    expect(result.error.code).toBe("sandbox_failed");
    expect(result.error.message).toBe("script-env profile runs only through wrapArgv");
    expect(shell.calls.length).toBe(0);
  });
});
