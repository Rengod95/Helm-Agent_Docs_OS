import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, parseJson, type Result } from "@xeon/contracts";
import type { SecretHandle } from "@xeon/contracts/capabilities";
import type { SecretError, SecretLease } from "@xeon/contracts/services";
import {
  createBackgroundRegistry,
  createMcpProcessPort,
  detectProcessPlatform,
  type BackgroundRegistryController,
  type McpChild,
  type McpProcessPort,
  type McpSandboxSource,
  type McpSecretSource,
  type McpSpawnSpec,
} from "../src/index.ts";
import { manualClock } from "./support/clock.ts";
import { memoryLogger, sequentialLocalIds, type MemoryLogger } from "./support/fakes.ts";
import { realScheduler, waitFor } from "./support/real-time.ts";
import { fakeSandbox } from "./support/sandbox-fake.ts";

// L0.process.spec §4.9, L0.sandbox.spec §4.9, P-15: sandbox:true인 stdio 서버는 wrapArgv가 만든 명령줄로 띄우고,
// 격리할 수 없으면 값으로 막는다. 샌드박스 서비스는 대역(support/sandbox-fake.ts)이다.

const MCP_CHILD = `${import.meta.dir}/fixtures/mcp-child.ts`;
const WRAP_CHILD = `${import.meta.dir}/fixtures/wrap-child.ts`;
const MARKER_CHILD = `${import.meta.dir}/fixtures/marker-child.ts`;
/** 감싸기 전 명령. 실제로 없는 경로라서, 포트가 이 명령을 직접 띄우면 기동이 실패한다 */
const ORIGINAL = "/nonexistent/original-server";

const platform = detectProcessPlatform();
if (!platform.ok) throw new Error("this test needs a supported platform");
const processPlatform = platform.value;

const children: McpChild[] = [];
const registries: BackgroundRegistryController[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  await Promise.all(registries.splice(0).map((registry) => registry.close({ graceMs: 100 })));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDirOf(): string {
  const dir = mkdtempSync(join(tmpdir(), "xeon-mcp-sb-"));
  dirs.push(dir);
  return dir;
}

interface Opened {
  readonly background: BackgroundRegistryController;
  readonly port: McpProcessPort;
  readonly log: MemoryLogger;
}

function open(
  options: {
    readonly secrets?: McpSecretSource;
    readonly sandbox?: () => McpSandboxSource | undefined;
    readonly tempDir?: string;
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
  const port = createMcpProcessPort({
    platform: processPlatform,
    background,
    secrets: options.secrets,
    sandbox: options.sandbox,
    tempDir: options.tempDir,
    scheduler: realScheduler(),
    parentEnv: { PATH: process.env["PATH"] },
    logger: log,
    drainMs: 300,
  });
  return { background, port, log };
}

function specOf(overrides: Partial<McpSpawnSpec> = {}): McpSpawnSpec {
  return {
    command: process.execPath,
    args: [MCP_CHILD, "echo"],
    cwd: undefined,
    secretEnv: {},
    label: "mcp:fixture",
    server: "fixture",
    sandbox: true,
    ...overrides,
  };
}

async function started(port: McpProcessPort, spec: McpSpawnSpec): Promise<McpChild> {
  const spawned = await port.spawn(spec, new AbortController().signal);
  if (!spawned.ok) throw new Error(`spawn failed: ${JSON.stringify(spawned.error)}`);
  children.push(spawned.value);
  return spawned.value;
}

/** stdout의 첫 줄을 기다려 받는다 */
async function firstLine(child: McpChild): Promise<string> {
  let text = "";
  const lines: string[] = [];
  child.stdout.on("data", (chunk: string | Uint8Array) => {
    text += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    const end = text.indexOf("\n");
    if (end !== -1) lines.push(text.slice(0, end));
  });
  if (!(await waitFor(() => lines.length > 0, 5000))) throw new Error("no output line");
  return lines[0] ?? "";
}

/** 래퍼 대역이 쓴 `{argv, env}` 줄을 값으로 옮긴다 */
function wrapperReportOf(value: unknown): { argv: string[]; env: Record<string, string> } {
  const argv: string[] = [];
  const env: Record<string, string> = {};
  if (typeof value !== "object" || value === null) return { argv, env };
  const entries: readonly (readonly [string, unknown])[] = Object.entries(value);
  for (const [key, item] of entries) {
    if (key === "argv" && Array.isArray(item)) {
      for (const part of item) if (typeof part === "string") argv.push(part);
    }
    if (key === "env" && typeof item === "object" && item !== null) {
      const vars: readonly (readonly [string, unknown])[] = Object.entries(item);
      for (const [name, text] of vars) if (typeof text === "string") env[name] = text;
    }
  }
  return { argv, env };
}

/** 로그에서 사건 이름이 같은 줄만 모은다 */
function eventsOf(log: MemoryLogger, event: string): MemoryLogger["records"] {
  return log.records.filter((record) => record.event === event);
}

/** handle을 받으면 항목 없음으로 거절하고 받은 handle을 기록한다. lease는 만들지 않는다 */
function recordingSecrets(): { readonly source: McpSecretSource; readonly handles: string[] } {
  const handles: string[] = [];
  const source: McpSecretSource = {
    withEnv(handle: SecretHandle): Promise<Result<SecretLease, SecretError>> {
      handles.push(handle);
      return Promise.resolve(err({ kind: "secret_missing", handle, where: "meta" }));
    },
  };
  return { source, handles };
}

const signal = (): AbortSignal => new AbortController().signal;

/** 서비스가 없어 막힌 spawn은 service_missing 값이고, 아무것도 등록되지 않고, 경고를 한 번 남긴다 */
async function expectServiceMissing(opened: Opened, spec: McpSpawnSpec): Promise<void> {
  expect(await opened.port.spawn(spec, signal())).toEqual({
    ok: false,
    error: { kind: "sandbox_unavailable", reason: "service_missing" },
  });
  expect(opened.background.list()).toEqual([]);
  expect(eventsOf(opened.log, "mcp.sandbox_unavailable")).toEqual([
    {
      level: "warn",
      event: "mcp.sandbox_unavailable",
      fields: { server: "fixture", reason: "service_missing" },
    },
  ]);
}

describe("McpProcessPort.spawn with sandbox:true (P-15)", () => {
  test("a sandbox that cannot isolate fails closed before any process or secret starts", async () => {
    const dir = tempDirOf();
    const marker = join(dir, "marker");
    const sandbox = fakeSandbox(err({ kind: "unavailable", reason: "missing_dependency" }));
    const secrets = recordingSecrets();
    const { port, background, log } = open({
      secrets: secrets.source,
      sandbox: () => sandbox.source,
      tempDir: dir,
    });
    const spec = specOf({
      command: process.execPath,
      args: [MARKER_CHILD, marker],
      secretEnv: { GITHUB_TOKEN: "secret://gh-token" },
    });
    expect(await port.spawn(spec, signal())).toEqual({
      ok: false,
      error: { kind: "sandbox_unavailable", reason: "missing_dependency" },
    });
    expect(sandbox.wrapCalls).toHaveLength(1);
    expect(background.list()).toEqual([]);
    expect(secrets.handles).toEqual([]);
    expect(eventsOf(log, "mcp.sandbox_unavailable")).toEqual([
      {
        level: "warn",
        event: "mcp.sandbox_unavailable",
        fields: { server: "fixture", reason: "missing_dependency" },
      },
    ]);
    // 표식 대역이 돌았다면 표식을 남겼다. 막힌 뒤에는 남지 않아야 한다
    expect(existsSync(marker)).toBe(false);

    // 대조: 같은 명령을 격리 없이 띄우면 표식을 남긴다
    const control = open();
    const unsandboxed = await control.port.spawn(
      specOf({ args: [MARKER_CHILD, marker], sandbox: false }),
      signal(),
    );
    if (!unsandboxed.ok)
      throw new Error(`control spawn failed: ${JSON.stringify(unsandboxed.error)}`);
    children.push(unsandboxed.value);
    expect(await unsandboxed.value.exited).toEqual({ code: 0, signal: null });
    expect(existsSync(marker)).toBe(true);
  });

  test("without a sandbox service, or without a temp dir, sandbox:true fails closed as service_missing", async () => {
    const dir = tempDirOf();
    const marker = join(dir, "marker");
    const spec = specOf({ command: process.execPath, args: [MARKER_CHILD, marker] });
    await expectServiceMissing(open({ tempDir: dir }), spec);
    await expectServiceMissing(open({ sandbox: () => undefined, tempDir: dir }), spec);
    // 서비스는 있지만 임시 디렉터리가 없으면 정책을 만들 수 없으므로 막는다
    const noTempDir = fakeSandbox(ok({ argv: [process.execPath, MARKER_CHILD, marker] }));
    const { port } = open({ sandbox: () => noTempDir.source });
    expect(await port.spawn(spec, signal())).toEqual({
      ok: false,
      error: { kind: "sandbox_unavailable", reason: "service_missing" },
    });
    expect(noTempDir.wrapCalls).toHaveLength(0);
  });

  test("sandbox:false never asks the sandbox service, even when one is present", async () => {
    const dir = tempDirOf();
    const sandbox = fakeSandbox(err({ kind: "aborted" }));
    const { port, log } = open({ sandbox: () => sandbox.source, tempDir: dir });
    await started(port, specOf({ sandbox: false }));
    expect(sandbox.wrapCalls).toHaveLength(0);
    expect(sandbox.policyInputs).toHaveLength(0);
    expect(log.records.filter((record) => record.event.startsWith("mcp.sandbox"))).toEqual([]);
    // 서비스 getter가 없어도 sandbox:false는 기동한다
    const bare = open();
    await started(bare.port, specOf({ sandbox: false }));
  });

  test("the process run is the wrapped command line, with its env over the definition env, and the policy is rooted at cwd and tempDir", async () => {
    const dir = tempDirOf();
    const workDir = join(dir, "work");
    mkdirSync(workDir);
    const tempDir = join(dir, "tmp");
    const sandbox = fakeSandbox(
      ok({
        argv: [process.execPath, WRAP_CHILD, "sandbox-stub"],
        env: { SANDBOX_PROXY: "from-wrapper", XEON_SANDBOX_MARK: "1" },
        sandboxed: true,
      }),
    );
    const { port, background } = open({ sandbox: () => sandbox.source, tempDir });
    const child = await started(
      port,
      specOf({
        command: ORIGINAL,
        args: ["--stdio"],
        cwd: `${workDir}/.`,
        env: { SANDBOX_PROXY: "from-definition", PLAIN: "kept" },
      }),
    );
    // 원래 명령은 없는 경로라서, 줄이 오면 실제로 감싼 명령줄이 돌았다
    const parsed = parseJson(await firstLine(child));
    const report = wrapperReportOf(parsed.ok ? parsed.value : undefined);
    expect(report.argv).toEqual(["sandbox-stub"]);
    expect(report.env["SANDBOX_PROXY"]).toBe("from-wrapper");
    expect(report.env["XEON_SANDBOX_MARK"]).toBe("1");
    expect(report.env["PLAIN"]).toBe("kept");
    expect(background.list({ kind: "mcp" })).toHaveLength(1);

    expect(sandbox.policyInputs).toEqual([{ workspaceRoots: [workDir], tempDir }]);
    expect(sandbox.wrapCalls).toHaveLength(1);
    expect(sandbox.wrapCalls[0]?.request).toEqual({
      command: ORIGINAL,
      args: ["--stdio"],
      cwd: workDir,
    });
    expect(sandbox.wrapCalls[0]?.policy.writeRoots).toEqual([workDir, tempDir]);

    // 프로세스가 끝나면 cleanup을 정확히 한 번 부른다
    child.stdin.end();
    expect(await child.exited).toEqual({ code: 0, signal: null });
    expect(sandbox.cleanups()).toBe(1);
  });

  test("cleanup runs once when the spawn fails and once when the secret lease fails", async () => {
    const dir = tempDirOf();
    const failedSpawn = fakeSandbox(ok({ argv: [join(dir, "does-not-exist")] }));
    const spawnPort = open({ sandbox: () => failedSpawn.source, tempDir: dir });
    expect(await spawnPort.port.spawn(specOf(), signal())).toMatchObject({
      ok: false,
      error: { kind: "spawn_failed", code: "ENOENT" },
    });
    expect(failedSpawn.cleanups()).toBe(1);
    expect(spawnPort.background.list()).toEqual([]);

    const leaseFailure = fakeSandbox(ok({ argv: [process.execPath, MCP_CHILD, "echo"] }));
    const secrets = recordingSecrets();
    const leasePort = open({
      secrets: secrets.source,
      sandbox: () => leaseFailure.source,
      tempDir: dir,
    });
    expect(
      await leasePort.port.spawn(
        specOf({ secretEnv: { GITHUB_TOKEN: "secret://gh-token" } }),
        signal(),
      ),
    ).toEqual({ ok: false, error: { kind: "secret_missing", ref: "secret://gh-token" } });
    expect(secrets.handles).toHaveLength(1);
    expect(leaseFailure.wrapCalls).toHaveLength(1);
    expect(leaseFailure.cleanups()).toBe(1);
    expect(leasePort.background.list()).toEqual([]);
  });

  test("a wrapper that fails or is aborted is a spawn_failed value and nothing starts", async () => {
    const dir = tempDirOf();
    const marker = join(dir, "marker");
    const spec = specOf({ command: process.execPath, args: [MARKER_CHILD, marker] });
    const failed = fakeSandbox(err({ kind: "failed", message: "policy translation failed" }));
    const failedPort = open({ sandbox: () => failed.source, tempDir: dir });
    expect(await failedPort.port.spawn(spec, signal())).toEqual({
      ok: false,
      error: { kind: "spawn_failed", code: "sandbox_failed", message: "policy translation failed" },
    });

    const aborted = fakeSandbox(err({ kind: "aborted" }));
    const abortedPort = open({ sandbox: () => aborted.source, tempDir: dir });
    expect(await abortedPort.port.spawn(spec, signal())).toEqual({
      ok: false,
      error: { kind: "spawn_failed", code: "aborted", message: "aborted" },
    });

    // 격리 불가 사유가 없으면 unknown이다
    const unknownReason = fakeSandbox(err({ kind: "unavailable", reason: undefined }));
    const unknownPort = open({ sandbox: () => unknownReason.source, tempDir: dir });
    expect(await unknownPort.port.spawn(spec, signal())).toEqual({
      ok: false,
      error: { kind: "sandbox_unavailable", reason: "unknown" },
    });

    expect(eventsOf(unknownPort.log, "mcp.sandbox_unavailable")).toEqual([
      {
        level: "warn",
        event: "mcp.sandbox_unavailable",
        fields: { server: "fixture", reason: "unknown" },
      },
    ]);
    for (const { background } of [failedPort, abortedPort, unknownPort]) {
      expect(background.list()).toEqual([]);
    }
    // 감싼 명령줄이 없으므로 정리할 것도 없고 표식도 남지 않는다
    expect(failed.cleanups() + aborted.cleanups() + unknownReason.cleanups()).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });
});
