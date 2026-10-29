import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attempt, err, ok, parseJson, type Result } from "@xeon/contracts";
import { parseSecretRef, type SecretHandle } from "@xeon/contracts/capabilities";
import type { SecretError, SecretLease, UseCtx } from "@xeon/contracts/services";
import {
  createBackgroundRegistry,
  createMcpProcessPort,
  detectProcessPlatform,
  spawnPiped,
  type BackgroundRegistryController,
  type McpChild,
  type McpProcessPort,
  type McpSecretSource,
  type McpSpawnSpec,
} from "../src/index.ts";
import { manualClock } from "./support/clock.ts";
import { memoryLogger, sequentialLocalIds } from "./support/fakes.ts";
import { realScheduler, waitFor } from "./support/real-time.ts";

// L0.process.plan PR-23, spec §4.9: 실제 자식 프로세스로 McpProcessPort.spawn과 spawnPiped를 확인한다(사용자 권한 실행, 비밀 주입, 그룹 종료).

const MCP_CHILD = `${import.meta.dir}/fixtures/mcp-child.ts`;
const TREE_CHILD = `${import.meta.dir}/fixtures/hook-child.ts`;
const SECRET_VALUE = "s3cr3t-value-for-test-0123";

const platform = detectProcessPlatform();
if (!platform.ok) throw new Error("this test needs a supported platform");
const processPlatform = platform.value;

function handleOf(ref: string): SecretHandle {
  const parsed = parseSecretRef(ref);
  if (!parsed.ok) throw new Error(`bad ref ${ref}`);
  return parsed.value.handle;
}

function isAlive(pid: number): boolean {
  return attempt(() => process.kill(pid, 0)).ok;
}

/** JSON 객체의 문자열 값만 옮긴다 */
function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof value !== "object" || value === null) return out;
  for (const [name, item] of Object.entries(value)) {
    if (typeof item === "string") out[name] = item;
  }
  return out;
}

interface Opened {
  readonly background: BackgroundRegistryController;
  readonly port: McpProcessPort;
  readonly log: ReturnType<typeof memoryLogger>;
}

const children: McpChild[] = [];
const registries: BackgroundRegistryController[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  await Promise.all(registries.splice(0).map((registry) => registry.close({ graceMs: 100 })));
});

function open(
  secrets?: McpSecretSource,
  parentEnv: Record<string, string | undefined> = {},
  stdinCloseMs?: number,
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
    secrets,
    scheduler: realScheduler(),
    parentEnv,
    logger: log,
    drainMs: 300,
    ...(stdinCloseMs === undefined ? {} : { stdinCloseMs }),
  });
  return { background, port, log };
}

function specOf(mode: string, overrides: Partial<McpSpawnSpec> = {}): McpSpawnSpec {
  return {
    command: process.execPath,
    args: [MCP_CHILD, mode],
    cwd: undefined,
    secretEnv: {},
    label: "mcp:fixture",
    server: "fixture",
    ...overrides,
  };
}

async function started(
  port: McpProcessPort,
  spec: McpSpawnSpec,
  signal: AbortSignal = new AbortController().signal,
): Promise<McpChild> {
  const spawned = await port.spawn(spec, signal);
  if (!spawned.ok) throw new Error(`spawn failed: ${JSON.stringify(spawned.error)}`);
  children.push(spawned.value);
  return spawned.value;
}

/** stdout 줄을 모은다 */
function collectLines(child: McpChild): { readonly lines: string[] } {
  const lines: string[] = [];
  let text = "";
  child.stdout.on("data", (chunk: string | Uint8Array) => {
    text += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    for (let end = text.indexOf("\n"); end !== -1; end = text.indexOf("\n")) {
      lines.push(text.slice(0, end));
      text = text.slice(end + 1);
    }
  });
  return { lines };
}

/** stdout에서 줄 하나를 읽는다 */
async function firstLine(child: McpChild): Promise<string> {
  const { lines } = collectLines(child);
  if (!(await waitFor(() => lines.length > 0, 5000))) throw new Error("no output line");
  return lines[0] ?? "";
}

interface FakeSecrets {
  readonly source: McpSecretSource;
  readonly calls: { readonly handle: string; readonly ctx: Omit<UseCtx, "mode"> }[];
  readonly disposed: () => number;
}

/** handle → 값 또는 오류. 값은 lease.use 안에서만 주고 dispose 횟수를 센다 */
function fakeSecrets(table: Record<string, string | SecretError>): FakeSecrets {
  const calls: { handle: string; ctx: Omit<UseCtx, "mode"> }[] = [];
  let disposed = 0;
  const source: McpSecretSource = {
    withEnv(handle, ctx): Promise<Result<SecretLease, SecretError>> {
      calls.push({ handle, ctx });
      const entry = table[handle];
      if (entry === undefined) {
        return Promise.resolve(err({ kind: "secret_missing", handle, where: "meta" }));
      }
      if (typeof entry !== "string") return Promise.resolve(err(entry));
      const lease: SecretLease = {
        leaseId: "sls_00000000000000000000000001",
        handle,
        mode: "env",
        expiresAt: Number.MAX_SAFE_INTEGER,
        usesLeft: 1,
        use: async (fn) =>
          ok(await fn({ bytes: new TextEncoder().encode(entry), text: () => entry })),
        dispose: () => {
          disposed += 1;
        },
        toJSON: () => "[SecretLease]",
      };
      return Promise.resolve(ok(lease));
    },
  };
  return { source, calls, disposed: () => disposed };
}

describe("McpProcessPort.spawn", () => {
  test("streams newline JSON both ways and registers the server as an mcp background process", async () => {
    const { port, background } = open();
    const child = await started(port, specOf("echo"));
    expect(isAlive(child.pid)).toBe(true);
    const listed = background.list({ kind: "mcp" });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      label: "mcp:fixture",
      owner: { kind: "mcp", threadId: null, ref: "fixture" },
      pid: child.pid,
      state: "running",
    });
    const reply = firstLine(child);
    child.stdin.write('{"jsonrpc":"2.0"}\n');
    expect(await reply).toBe('echo:{"jsonrpc":"2.0"}');
    // stdin을 닫으면 서버가 정상 종료하고 레지스트리가 exited로 본다
    child.stdin.end();
    expect(await child.exited).toEqual({ code: 0, signal: null });
    expect(await waitFor(() => background.list({ kind: "mcp" })[0]?.state === "exited", 3000)).toBe(
      true,
    );
  });

  test("reads the output a server writes right before exiting", async () => {
    const { port } = open();
    const child = await started(port, specOf("last-words"));
    const line = firstLine(child);
    expect(await child.exited).toEqual({ code: 3, signal: null });
    expect(await line).toBe("last");
  });

  test("the child env is the allow list plus injected secrets, not the parent env", async () => {
    const secrets = fakeSecrets({ "secret://gh-token": SECRET_VALUE });
    const { port } = open(secrets.source, {
      PATH: process.env["PATH"],
      HOME: "/home/test",
      ANTHROPIC_API_KEY: "parent-provider-key",
      XEON_INTERNAL: "1",
      UNLISTED: "x",
    });
    const child = await started(
      port,
      specOf("env", { secretEnv: { GITHUB_TOKEN: "secret://gh-token" } }),
    );
    const parsed = parseJson(await firstLine(child));
    expect(parsed.ok).toBe(true);
    const env = stringRecord(parsed.ok ? parsed.value : undefined);
    expect(env["GITHUB_TOKEN"]).toBe(SECRET_VALUE);
    expect(env["HOME"]).toBe("/home/test");
    expect(env["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(env["XEON_INTERNAL"]).toBeUndefined();
    expect(env["UNLISTED"]).toBeUndefined();
    // lease는 spawn이 끝나면 닫힌다. 정책 맥락은 서버 id와 명령줄을 싣는다
    expect(secrets.disposed()).toBe(1);
    expect(secrets.calls[0]?.handle).toBe("secret://gh-token");
    expect(secrets.calls[0]?.ctx).toMatchObject({
      purpose: "mcp.start:fixture",
      actor: "runtime",
      threadId: null,
      approval: null,
      target: { kind: "command", argv0: process.execPath, commandLine: "mcp:fixture" },
    });
  });

  test("the start approval evidence reaches the secret use context unchanged", async () => {
    const secrets = fakeSecrets({ "secret://gh-token": SECRET_VALUE });
    const { port } = open(secrets.source, { PATH: process.env["PATH"] });
    const approval = {
      approvalId: "apr_1",
      scope: "per-session",
      grantedAt: 1_000,
      expiresAt: null,
    } as const;
    await started(
      port,
      specOf("env", { secretEnv: { GITHUB_TOKEN: "secret://gh-token" }, approval }),
    );
    expect(secrets.calls[0]?.ctx.approval).toEqual(approval);
  });

  test("plaintext env reaches the child next to injected secrets and a secret wins a name clash", async () => {
    const secrets = fakeSecrets({ "secret://gh-token": SECRET_VALUE });
    const { port } = open(secrets.source, { PATH: process.env["PATH"], HOME: "/home/test" });
    const child = await started(
      port,
      specOf("env", {
        env: { LOG_LEVEL: "debug", GITHUB_TOKEN: "plain-should-lose" },
        secretEnv: { GITHUB_TOKEN: "secret://gh-token" },
      }),
    );
    const parsed = parseJson(await firstLine(child));
    const env = stringRecord(parsed.ok ? parsed.value : undefined);
    expect(env["LOG_LEVEL"]).toBe("debug");
    expect(env["GITHUB_TOKEN"]).toBe(SECRET_VALUE);
  });

  test("a sandbox request is not enforced yet: the server still starts and the gap is logged", async () => {
    const { port, log } = open(undefined, { PATH: process.env["PATH"] });
    await started(port, specOf("echo", { sandbox: true }));
    expect(log.records.filter((record) => record.event === "mcp.sandbox_not_enforced")).toEqual([
      { level: "warn", event: "mcp.sandbox_not_enforced", fields: { server: "fixture" } },
    ]);
    const quiet = open(undefined, { PATH: process.env["PATH"] });
    await started(quiet.port, specOf("echo", { sandbox: false }));
    expect(quiet.log.records.some((record) => record.event === "mcp.sandbox_not_enforced")).toBe(
      false,
    );
  });

  test("a plaintext env name that is not a valid variable name fails before anything starts", async () => {
    const { port, background } = open();
    const result = await port.spawn(
      specOf("echo", { env: { "BAD-NAME": "x" } }),
      new AbortController().signal,
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "spawn_failed",
        code: "env_denied",
        message: "Invalid environment variable name: BAD-NAME",
      },
    });
    expect(background.list()).toEqual([]);
  });

  test("two env names for one handle both resolve", async () => {
    const secrets = fakeSecrets({ "secret://gh-token": SECRET_VALUE });
    const { port } = open(secrets.source);
    const child = await started(
      port,
      specOf("env", {
        secretEnv: { GH_ONE: "secret://gh-token", GH_TWO: "secret://gh-token" },
      }),
    );
    const parsed = parseJson(await firstLine(child));
    const env = stringRecord(parsed.ok ? parsed.value : undefined);
    expect(env["GH_ONE"]).toBe(SECRET_VALUE);
    expect(env["GH_TWO"]).toBe(SECRET_VALUE);
    expect(secrets.disposed()).toBe(2);
  });

  test("secret failures map to the port error kinds and leave nothing running", async () => {
    const secrets = fakeSecrets({
      "secret://ok": SECRET_VALUE,
      "secret://nope": {
        kind: "denied",
        handle: handleOf("secret://nope"),
        reason: "approval_missing",
      },
    });
    const { port, background } = open(secrets.source);
    const missing = await port.spawn(
      specOf("echo", { secretEnv: { A_ONE: "secret://ok", B_TWO: "secret://absent" } }),
      new AbortController().signal,
    );
    expect(missing).toEqual({
      ok: false,
      error: { kind: "secret_missing", ref: "secret://absent" },
    });
    const denied = await port.spawn(
      specOf("echo", { secretEnv: { A_ONE: "secret://nope" } }),
      new AbortController().signal,
    );
    expect(denied).toEqual({ ok: false, error: { kind: "secret_denied", ref: "secret://nope" } });
    const plain = await port.spawn(
      specOf("echo", { secretEnv: { A_ONE: "not-a-ref" } }),
      new AbortController().signal,
    );
    expect(plain).toEqual({ ok: false, error: { kind: "secret_missing", ref: "not-a-ref" } });
    expect(background.list()).toHaveLength(0);
    // 앞에서 연 lease는 모두 닫혔다
    expect(secrets.disposed()).toBe(1);
    const unavailable = await open().port.spawn(
      specOf("echo", { secretEnv: { A_ONE: "secret://ok" } }),
      new AbortController().signal,
    );
    expect(unavailable).toMatchObject({
      ok: false,
      error: { kind: "spawn_failed", code: "secret_unavailable" },
    });
  });

  test("a command that cannot start is spawn_failed with the errno code", async () => {
    const { port, background } = open();
    const result = await port.spawn(
      specOf("echo", { command: `${import.meta.dir}/fixtures/does-not-exist` }),
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: false, error: { kind: "spawn_failed", code: "ENOENT" } });
    expect(background.list()).toHaveLength(0);
    const aborted = new AbortController();
    aborted.abort();
    expect(await port.spawn(specOf("echo"), aborted.signal)).toMatchObject({
      ok: false,
      error: { kind: "spawn_failed", code: "aborted" },
    });
  });

  test("registry close stops the whole process group, including a grandchild that ignores SIGTERM", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xeon-mcp-"));
    const marker = join(dir, "pids.json");
    const { port, background } = open(undefined, {}, 50);
    const child = await started(
      port,
      specOf("tree", { command: process.execPath, args: [TREE_CHILD, "tree", marker] }),
    );
    expect(await waitFor(() => existsSync(marker), 5000)).toBe(true);
    const pids = parseJson(readFileSync(marker, "utf8"));
    const leaf = pids.ok ? stringRecordNumber(pids.value, "leaf") : undefined;
    if (leaf === undefined) throw new Error("leaf pid missing");
    expect(isAlive(leaf)).toBe(true);
    // 엔진 종료 협조: 레지스트리를 닫으면 graceful 뒤 force로 트리 전체가 사라진다(손자는 SIGTERM을 무시한다)
    expect(await background.close({ graceMs: 300 })).toBe(1);
    await child.exited;
    expect(await waitFor(() => !isAlive(child.pid) && !isAlive(leaf), 5000)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("a graceful stop closes stdin first, then sends SIGTERM, then SIGKILL", async () => {
    const { port, background } = open(undefined, {}, 200);
    const child = await started(port, specOf("stubborn"));
    const output = collectLines(child);
    expect(await waitFor(() => output.lines.includes("ready"), 5000)).toBe(true);
    const id = background.list({ kind: "mcp" })[0]?.id;
    if (id === undefined) throw new Error("server is not registered");
    const stopped = await background.stop(id, { graceMs: 300 });
    expect(stopped).toEqual({ ok: true, value: "killed" });
    // 순서가 곧 값이다: stdin 닫힘이 SIGTERM보다 먼저 서버에 닿는다
    expect(output.lines).toEqual(["ready", "stdin-closed", "sigterm"]);
    expect(await child.exited).toEqual({ code: null, signal: "SIGKILL" });
  });

  test("a server that exits when stdin closes is stopped without any signal", async () => {
    const { port, background } = open(undefined, {}, 2000);
    const child = await started(port, specOf("echo"));
    const id = background.list({ kind: "mcp" })[0]?.id;
    if (id === undefined) throw new Error("server is not registered");
    expect(await background.stop(id, { graceMs: 3000 })).toEqual({ ok: true, value: "exited" });
    expect(await child.exited).toEqual({ code: 0, signal: null });
  });

  test("kill sends the signal to the server and exited reports it", async () => {
    const { port } = open();
    const child = await started(port, specOf("stderr"));
    child.kill("SIGTERM");
    const exit = await child.exited;
    expect(exit).toEqual({ code: null, signal: "SIGTERM" });
    expect(isAlive(child.pid)).toBe(false);
  });
});

describe("spawnPiped", () => {
  test("returns spawn_failed with the errno code when the program does not exist", async () => {
    const result = await spawnPiped(
      {
        command: `${import.meta.dir}/fixtures/does-not-exist`,
        args: [],
        cwd: undefined,
        env: {},
        label: "missing",
      },
      {
        platform: processPlatform,
        scheduler: realScheduler(),
        logger: memoryLogger(),
        drainMs: 100,
      },
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "spawn_failed", code: "ENOENT", message: "cannot start missing" },
    });
  });
});

function stringRecordNumber(value: unknown, name: string): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  for (const [key, item] of Object.entries(value)) {
    if (key === name && typeof item === "number") return item;
  }
  return undefined;
}
