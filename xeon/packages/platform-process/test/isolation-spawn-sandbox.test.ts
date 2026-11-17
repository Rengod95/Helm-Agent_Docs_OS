import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, parseJson } from "@fresnel/contracts";
import type {
  IsolatedChild,
  IsolationProcessPort,
  IsolationSpawnSpec,
} from "@fresnel/contracts/extensions";
import type { SandboxPolicy } from "@fresnel/contracts/services";
import {
  createBackgroundRegistry,
  createIsolationProcessPort,
  createProcessService,
  detectProcessPlatform,
  type BackgroundRegistryController,
  type IsolationSandboxSource,
} from "../src/index.ts";
import { manualClock } from "./support/clock.ts";
import { realClock, realScheduler, waitFor } from "./support/real-time.ts";
import { memoryLogger, sequentialLocalIds, type MemoryLogger } from "./support/fakes.ts";
import { fakeSandbox } from "./support/sandbox-fake.ts";

// review.m5-drive-isolation §3.1·§3.4, L0.process.spec §4.8: 격리 확장의 플러그인 호스트 프로세스 기동.
// 샌드박스 서비스는 대역(support/sandbox-fake.ts)이다. 띄우는 자식은 짧은 실제 프로세스다(mcp-spawn-sandbox.test.ts와 같다).

const MCP_CHILD = `${import.meta.dir}/fixtures/mcp-child.ts`;
const MARKER_CHILD = `${import.meta.dir}/fixtures/marker-child.ts`;
/** 감싸기 전 명령. 없는 경로라서, 포트가 이 명령을 직접 띄우면 기동이 실패한다 */
const ORIGINAL = "/nonexistent/plugin-host-original";
const LABEL = "ext:fixture:v1";

const platform = detectProcessPlatform();
if (!platform.ok) throw new Error("this test needs a supported platform");
const processPlatform = platform.value;

const children: IsolatedChild[] = [];
const registries: BackgroundRegistryController[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  await Promise.all(registries.splice(0).map((registry) => registry.close({ graceMs: 100 })));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDirOf(): string {
  const dir = mkdtempSync(join(tmpdir(), "fresnel-isolation-"));
  dirs.push(dir);
  return dir;
}

interface Opened {
  readonly background: BackgroundRegistryController;
  readonly port: IsolationProcessPort;
  readonly log: MemoryLogger;
}

function open(
  options: {
    readonly sandbox?: () => IsolationSandboxSource | undefined;
    readonly parentEnv?: Readonly<Record<string, string | undefined>>;
  } = {},
): Opened {
  const background = createBackgroundRegistry({
    clock: manualClock(),
    scheduler: realScheduler(),
    ids: sequentialLocalIds(),
    logger: memoryLogger(),
  });
  registries.push(background);
  const log = memoryLogger();
  const port = createIsolationProcessPort({
    platform: processPlatform,
    background,
    sandbox: options.sandbox ?? ((): undefined => undefined),
    parentEnv: options.parentEnv ?? { PATH: process.env["PATH"] },
    scheduler: realScheduler(),
    logger: log,
    drainMs: 300,
    stdinCloseMs: 100,
  });
  return { background, port, log };
}

function specOf(overrides: Partial<IsolationSpawnSpec> = {}): IsolationSpawnSpec {
  return {
    command: ORIGINAL,
    args: ["--stdio"],
    readRoot: tempDirOf(),
    env: {},
    label: LABEL,
    ...overrides,
  };
}

async function started(
  port: IsolationProcessPort,
  spec: IsolationSpawnSpec,
): Promise<IsolatedChild> {
  const spawned = await port.spawn(spec);
  if (!spawned.ok) throw new Error(`spawn failed: ${JSON.stringify(spawned.error)}`);
  children.push(spawned.value);
  return spawned.value;
}

type FakeSandbox = ReturnType<typeof fakeSandbox>;

/** 시험 대역이 받은 wrapArgv 호출이 정확히 하나일 때 그 호출을 돌려준다 */
function onlyWrapCall(sandbox: FakeSandbox): FakeSandbox["wrapCalls"][number] {
  const [call] = sandbox.wrapCalls;
  if (call === undefined || sandbox.wrapCalls.length !== 1) {
    throw new Error("expected exactly one wrapArgv call");
  }
  return call;
}

/** 로그에서 사건 이름이 같은 줄만 모은다 */
function eventsOf(log: MemoryLogger, event: string): MemoryLogger["records"] {
  return log.records.filter((record) => record.event === event);
}

/** stdout 줄을 계속 모은다. 돌려준 배열은 줄이 올 때마다 늘어난다 */
function collectLines(child: IsolatedChild): string[] {
  const lines: string[] = [];
  let pending = "";
  child.stdout.on("data", (chunk: string | Uint8Array) => {
    pending += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    const parts = pending.split("\n");
    pending = parts.pop() ?? "";
    lines.push(...parts);
  });
  return lines;
}

describe("IsolationProcessPort.spawn with the plugin-host sandbox profile", () => {
  test("the policy is the no-write profile with a read allow-list, no allow-listed network and no escape", async () => {
    const dir = tempDirOf();
    const sandbox = fakeSandbox(ok({ argv: [process.execPath, MCP_CHILD, "echo"] }));
    const { port, background } = open({ sandbox: () => sandbox.source });
    const child = await started(port, specOf({ readRoot: dir, args: [MCP_CHILD, "echo"] }));

    const call = onlyWrapCall(sandbox);
    expect(sandbox.policyInputs).toEqual([
      { workspaceRoots: [], tempDir: dir, profile: "no-write", readRoots: [dir, ORIGINAL] },
    ]);
    expect(call.request).toEqual({ command: ORIGINAL, args: [MCP_CHILD, "echo"], cwd: dir });
    expect(call.policy.writeRoots).toEqual([]);
    // 쓰기 거부 `/` 우회책은 없다: 쓰기 없음은 프로필이다
    expect(call.policy.writeDeny).not.toContain("/");
    expect(call.policy.readAllow).toEqual([dir, ORIGINAL]);
    expect(call.policy.network.allowedDomains).toEqual([]);
    expect(call.policy.allowEscape).toBe(false);
    expect(call.policy.profile).toBe("no-write");
    expect(background.list({ kind: "plugin-host" })).toHaveLength(1);

    child.stdin.end();
    expect(await child.exited).toEqual({ code: 0, signal: null });
  });

  test("the runtime read roots of the launch are added to the read allow-list", async () => {
    const dir = tempDirOf();
    const sandbox = fakeSandbox(ok({ argv: [process.execPath, MCP_CHILD, "echo"] }));
    const { port } = open({ sandbox: () => sandbox.source });
    const child = await started(
      port,
      specOf({ readRoot: dir, args: [MCP_CHILD, "echo"], runtimeReadRoots: ["/work/source"] }),
    );
    expect(sandbox.policyInputs).toEqual([
      {
        workspaceRoots: [],
        tempDir: dir,
        profile: "no-write",
        readRoots: [dir, ORIGINAL, "/work/source"],
      },
    ]);
    child.stdin.end();
    await child.exited;
  });

  test("the policy of the sandbox is handed to wrapArgv unchanged: protected defaults and blocked domains stay", async () => {
    const seen: SandboxPolicy[] = [];
    const given: SandboxPolicy = {
      writeRoots: [],
      readDeny: ["/home/user/.ssh"],
      writeDeny: ["/home/user/.ssh", "/home/user/.config/fresnel"],
      network: { allowedDomains: [], deniedDomains: ["blocked.example"] },
      allowEscape: false,
      profile: "no-write",
      readAllow: ["/plugin"],
    };
    const source: IsolationSandboxSource = {
      defaultPolicy: () => given,
      wrapArgv: (policy) => {
        seen.push(policy);
        return Promise.resolve(
          ok({
            argv: [process.execPath, MCP_CHILD, "echo"],
            env: {},
            sandboxed: true,
            cleanup() {},
          }),
        );
      },
    };
    const { port } = open({ sandbox: () => source });
    const child = await started(port, specOf({ args: [MCP_CHILD, "echo"] }));
    expect(seen).toEqual([given]);
    child.stdin.end();
    await child.exited;
  });

  test("the child runs the wrapped command line in the read root", async () => {
    const dir = tempDirOf();
    const marker = "marker";
    const sandbox = fakeSandbox(ok({ argv: [process.execPath, MARKER_CHILD, marker] }));
    const { port } = open({ sandbox: () => sandbox.source });
    const child = await started(port, specOf({ readRoot: dir, args: [MARKER_CHILD, marker] }));
    expect(await child.exited).toEqual({ code: 0, signal: null });
    // 표식 파일은 작업 디렉터리(readRoot) 기준 상대 경로에 생긴다
    expect(existsSync(join(dir, marker))).toBe(true);
    expect(onlyWrapCall(sandbox).request.cwd).toBe(dir);
    expect(sandbox.cleanups()).toBe(1);
  });

  test("without a sandbox service nothing starts and the refusal is a value", async () => {
    const dir = tempDirOf();
    const marker = join(dir, "marker");
    const { port, background, log } = open();
    expect(await port.spawn(specOf({ args: [MARKER_CHILD, marker] }))).toEqual({
      ok: false,
      error: { kind: "sandbox_unavailable", reason: "service_missing" },
    });
    expect(background.list()).toEqual([]);
    expect(existsSync(marker)).toBe(false);
    expect(eventsOf(log, "isolation.sandbox_unavailable")).toEqual([
      {
        level: "warn",
        event: "isolation.sandbox_unavailable",
        fields: { label: LABEL, reason: "service_missing" },
      },
    ]);
  });

  test("a sandbox that cannot isolate fails closed and starts nothing", async () => {
    const dir = tempDirOf();
    const marker = join(dir, "marker");
    const sandbox = fakeSandbox(err({ kind: "unavailable", reason: "missing_dependency" }));
    const { port, background, log } = open({ sandbox: () => sandbox.source });
    expect(await port.spawn(specOf({ args: [MARKER_CHILD, marker] }))).toEqual({
      ok: false,
      error: { kind: "sandbox_unavailable", reason: "missing_dependency" },
    });
    expect(sandbox.wrapCalls).toHaveLength(1);
    expect(background.list()).toEqual([]);
    expect(existsSync(marker)).toBe(false);
    expect(eventsOf(log, "isolation.sandbox_unavailable")).toEqual([
      {
        level: "warn",
        event: "isolation.sandbox_unavailable",
        fields: { label: LABEL, reason: "missing_dependency" },
      },
    ]);

    // 사유가 없으면 unknown이다
    const unknownReason = fakeSandbox(err({ kind: "unavailable", reason: undefined }));
    const unknownPort = open({ sandbox: () => unknownReason.source });
    expect(await unknownPort.port.spawn(specOf({ args: [MARKER_CHILD, marker] }))).toEqual({
      ok: false,
      error: { kind: "sandbox_unavailable", reason: "unknown" },
    });
  });

  test("a wrapper that fails or is aborted is a spawn_failed value", async () => {
    const dir = tempDirOf();
    const marker = join(dir, "marker");
    const failed = fakeSandbox(err({ kind: "failed", message: "policy translation failed" }));
    expect(
      await open({ sandbox: () => failed.source }).port.spawn(
        specOf({ args: [MARKER_CHILD, marker] }),
      ),
    ).toEqual({
      ok: false,
      error: { kind: "spawn_failed", code: "sandbox_failed", message: "policy translation failed" },
    });
    const aborted = fakeSandbox(err({ kind: "aborted" }));
    expect(
      await open({ sandbox: () => aborted.source }).port.spawn(
        specOf({ args: [MARKER_CHILD, marker] }),
      ),
    ).toEqual({ ok: false, error: { kind: "spawn_failed", code: "aborted", message: "aborted" } });
    expect(existsSync(marker)).toBe(false);
  });

  test("sandbox off or run_unsandboxed starts the plain command line and logs isolation.sandbox_not_enforced", async () => {
    const dir = tempDirOf();
    const marker = join(dir, "marker");
    const sandbox = fakeSandbox(
      ok({
        argv: [process.execPath, MARKER_CHILD, marker],
        sandboxed: false,
        unsandboxedBy: "run_unsandboxed",
      }),
    );
    const { port, log } = open({ sandbox: () => sandbox.source });
    const child = await started(port, specOf({ args: [MARKER_CHILD, marker] }));
    expect(await child.exited).toEqual({ code: 0, signal: null });
    expect(existsSync(marker)).toBe(true);
    expect(eventsOf(log, "isolation.sandbox_not_enforced")).toEqual([
      {
        level: "warn",
        event: "isolation.sandbox_not_enforced",
        fields: { label: LABEL, by: "run_unsandboxed" },
      },
    ]);
  });

  test("a spawn that cannot start is a spawn_failed value with the errno code, and the wrapper is cleaned up", async () => {
    const sandbox = fakeSandbox(ok({ argv: ["/nonexistent/plugin-host-binary"] }));
    const { port, background } = open({ sandbox: () => sandbox.source });
    expect(await port.spawn(specOf())).toEqual({
      ok: false,
      error: {
        kind: "spawn_failed",
        code: "ENOENT",
        message: "cannot start ext:fixture:v1",
      },
    });
    expect(sandbox.cleanups()).toBe(1);
    expect(background.list()).toEqual([]);
  });

  test("kill sends the signal to the process tree and exited reports it", async () => {
    const sandbox = fakeSandbox(ok({ argv: [process.execPath, MCP_CHILD, "echo"] }));
    const { port } = open({ sandbox: () => sandbox.source });
    const killed = await started(port, specOf({ args: [MCP_CHILD, "echo"] }));
    killed.kill("SIGTERM");
    expect(await killed.exited).toEqual({ code: null, signal: "SIGTERM" });

    const forced = await started(port, specOf({ args: [MCP_CHILD, "echo"] }));
    forced.kill("SIGKILL");
    expect(await forced.exited).toEqual({ code: null, signal: "SIGKILL" });
    expect(sandbox.cleanups()).toBe(2);
  });

  test("the child is registered as plugin-host, and a stop closes stdin, then SIGTERM, then SIGKILL", async () => {
    const sandbox = fakeSandbox(ok({ argv: [process.execPath, MCP_CHILD, "stubborn"] }));
    const { port, background } = open({ sandbox: () => sandbox.source });
    const child = await started(port, specOf({ args: [MCP_CHILD, "stubborn"] }));
    const lines = collectLines(child);
    expect(await waitFor(() => lines.includes("ready"), 5000)).toBe(true);

    const [entry] = background.list({ kind: "plugin-host" });
    expect(entry).toMatchObject({
      label: LABEL,
      owner: { kind: "plugin-host", threadId: null, ref: LABEL },
      pid: child.pid,
      state: "running",
    });
    if (entry === undefined) throw new Error("the plugin host is not registered");

    // 자식은 stdin 닫힘과 SIGTERM을 받아도 살아 있으므로 SIGKILL까지 간다
    expect(await background.stop(entry.id, { graceMs: 300 })).toEqual({
      ok: true,
      value: "killed",
    });
    expect(lines).toEqual(["ready", "stdin-closed", "sigterm"]);
    expect(await child.exited).toEqual({ code: null, signal: "SIGKILL" });
    expect(sandbox.cleanups()).toBe(1);
  });

  test("the child environment has only the allow-listed parent names, the spec env, and the sandbox env on top", async () => {
    const sandbox = fakeSandbox(
      ok({
        argv: [process.execPath, MCP_CHILD, "env"],
        env: { SANDBOX_PROXY: "from-sandbox" },
      }),
    );
    const parentEnv = {
      PATH: process.env["PATH"],
      HOME: "/home/user",
      // 허용 목록 밖이고 시크릿 이름 패턴이다. 자식에게 가면 안 된다
      GITHUB_TOKEN: "fixture-token-not-real",
      ANTHROPIC_API_KEY: "fixture-key-not-real",
      UNLISTED_NAME: "not-passed",
    };
    const { port } = open({ sandbox: () => sandbox.source, parentEnv });
    const child = await started(
      port,
      specOf({
        args: [MCP_CHILD, "env"],
        env: { PLAIN: "kept", SANDBOX_PROXY: "from-spec" },
      }),
    );
    const lines = collectLines(child);
    expect(await waitFor(() => lines.length > 0, 5000)).toBe(true);
    const parsed = parseJson(lines[0] ?? "");
    if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) {
      throw new Error("the child did not print its environment");
    }
    const env: Record<string, unknown> = { ...parsed.value };
    expect(env["PATH"]).toBe(process.env["PATH"]);
    expect(env["HOME"]).toBe("/home/user");
    expect(env["PLAIN"]).toBe("kept");
    // 샌드박스 값이 정의 값을 이긴다
    expect(env["SANDBOX_PROXY"]).toBe("from-sandbox");
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("UNLISTED_NAME");
    child.stdin.end();
    await child.exited;
  });

  test("a bad env name or a relative read root is refused before the sandbox is asked", async () => {
    const sandbox = fakeSandbox(ok({ argv: [process.execPath, MCP_CHILD, "echo"] }));
    const { port } = open({ sandbox: () => sandbox.source });
    expect(await port.spawn(specOf({ env: { "BAD-NAME": "x" } }))).toEqual({
      ok: false,
      error: {
        kind: "spawn_failed",
        code: "env_denied",
        message: "Invalid environment variable name: BAD-NAME",
      },
    });
    expect(await port.spawn(specOf({ readRoot: "relative/root" }))).toEqual({
      ok: false,
      error: { kind: "spawn_failed", code: "EINVAL", message: "readRoot must be an absolute path" },
    });
    expect(sandbox.wrapCalls).toHaveLength(0);
  });

  test("without a process platform every spawn fails as unsupported_platform", async () => {
    const sandbox = fakeSandbox(ok({ argv: [process.execPath, MCP_CHILD, "echo"] }));
    const port = createIsolationProcessPort({
      platform: undefined,
      background: createBackgroundRegistry({
        clock: manualClock(),
        scheduler: realScheduler(),
        ids: sequentialLocalIds(),
        logger: memoryLogger(),
      }),
      sandbox: () => sandbox.source,
      parentEnv: {},
      scheduler: realScheduler(),
      logger: memoryLogger(),
    });
    expect(await port.spawn(specOf())).toEqual({
      ok: false,
      error: {
        kind: "spawn_failed",
        code: "unsupported_platform",
        message: "process trees cannot be stopped on this OS",
      },
    });
    expect(sandbox.wrapCalls).toHaveLength(0);
  });
});

describe("createProcessService wiring of the isolation port", () => {
  test("ProcessService.spawn uses the sandbox getter and the service registry, and shutdown stops the child", async () => {
    const sandbox = fakeSandbox(ok({ argv: [process.execPath, MCP_CHILD, "echo"] }));
    const handle = createProcessService({
      clock: realClock(),
      scheduler: realScheduler(),
      ids: sequentialLocalIds(),
      logger: memoryLogger(),
      settings: { shutdownTimeoutMs: 3000 },
      exit: () => {
        throw new Error("exit is not expected in this test");
      },
      sandbox: () => sandbox.source,
      parentEnv: { PATH: process.env["PATH"] },
    });
    const spawned = await handle.service.spawn(specOf({ args: [MCP_CHILD, "echo"] }));
    if (!spawned.ok) throw new Error(`spawn failed: ${JSON.stringify(spawned.error)}`);
    children.push(spawned.value);
    expect(handle.service.background.list({ kind: "plugin-host" })).toHaveLength(1);

    // 종료 협조의 레지스트리 참여자가 부르는 close가 격리 자식을 멈춘다. stdin이 닫히면 echo 자식은 스스로 끝난다
    expect(await handle.background.close({ graceMs: 200 })).toBe(1);
    expect(await spawned.value.exited).toEqual({ code: 0, signal: null });
  });
});
