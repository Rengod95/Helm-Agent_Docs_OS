import { describe, expect, test } from "bun:test";
import { repeatAsync } from "@xeon/contracts";
import { createStubProcessPort } from "../src/testing/stub-process.ts";
import type { McpStartDefinition, McpStartGate, McpStartVerdict } from "../src/ports/start-gate.ts";
import { createTransportFactory } from "../src/transport/factory.ts";
import { DEFAULT_MCP_SETTINGS, sandboxOf } from "../src/settings.ts";
import type { ServerDefinition } from "../src/types.ts";
import type { McpServerDef } from "@xeon/contracts/capabilities";
import { flush } from "./support/flush.ts";
import { fixedClock, manualScheduler } from "./support/time.ts";
import { buildWorld, startWorld } from "./support/world.ts";

// M3-05, M3-REQ-97, L2.mcp.spec §4.3. 비밀 env stdio 서버는 기동 승인 뒤에만 뜨고, 승인 증거와 평문 env, 샌드박스 요청이 spawn에 실린다.

const EVIDENCE = {
  approvalId: "evt_a",
  scope: "per-session",
  grantedAt: 5,
  expiresAt: null,
} as const;

interface FakeGate extends McpStartGate {
  readonly checks: { definition: McpStartDefinition; threadId: string | undefined }[];
  verdict: McpStartVerdict;
  resolve(server: string): void;
}

function fakeGate(verdict: McpStartVerdict): FakeGate {
  const listeners = new Set<(server: string) => void>();
  const gate: FakeGate = {
    checks: [],
    verdict,
    check(definition, context) {
      gate.checks.push({ definition, threadId: context.threadId });
      return Promise.resolve(gate.verdict);
    },
    onResolved(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resolve(server) {
      for (const listener of listeners) listener(server);
    },
  };
  return gate;
}

const SECRET_DEF: McpServerDef = {
  transport: {
    type: "stdio",
    command: "gh-mcp",
    args: ["--stdio"],
    env: { LOG_LEVEL: "info", GITHUB_TOKEN: "secret://gh-token" },
  },
};

function setup(verdict: McpStartVerdict, extra: { def?: Partial<McpServerDef> } = {}) {
  const gate = fakeGate(verdict);
  let process: ReturnType<typeof createStubProcessPort> | undefined;
  const world = buildWorld({
    servers: {
      gh: { def: { ...SECRET_DEF, ...extra.def }, stub: { era: "modern", tools: [{ name: "t" }] } },
    },
    overrides: { startGate: gate },
    transportsFor: (stubs) => {
      const stub = stubs["gh"];
      if (stub === undefined) throw new Error("stub missing");
      process = createStubProcessPort(stub);
      return createTransportFactory({
        process: process.port,
        secrets: undefined,
        scheduler: manualScheduler(fixedClock()),
        stdioGraceMs: 10,
        fetch: undefined,
        startGate: gate,
      });
    },
  });
  const spawned = () => process?.spawned ?? [];
  return { gate, world, spawned };
}

describe("secret env start approval", () => {
  test("a pending approval blocks the server without spawning, then an approval starts it with the evidence", async () => {
    const { gate, world, spawned } = setup({ kind: "pending" });
    await startWorld(world);
    const waiting = await world.runtime.service.client.listServers({});
    expect(waiting.servers).toMatchObject([
      { server: "gh", state: "blocked", blockedReason: "approval_required" },
    ]);
    expect(spawned()).toEqual([]);
    // 정의는 평문 env와 비밀 참조로 나뉘어 게이트에 간다. 값은 없다
    expect(gate.checks[0]?.definition).toEqual({
      server: "gh",
      source: "settings:user",
      command: "gh-mcp",
      args: ["--stdio"],
      cwd: null,
      env: { LOG_LEVEL: "info" },
      secretEnv: { GITHUB_TOKEN: "secret://gh-token" },
    });

    gate.verdict = { kind: "approved", evidence: EVIDENCE };
    gate.resolve("gh");
    // 승인 응답은 연결을 비동기로 다시 시작한다. 연결될 때까지 기다린다
    await repeatAsync(async () => {
      await flush();
      await world.runtime.settled();
      const listed = await world.runtime.service.client.listServers({});
      return listed.servers[0]?.state === "connected" ? { value: undefined } : undefined;
    });
    const started = await world.runtime.service.client.listServers({});
    expect(started.servers[0]?.state).toBe("connected");
    expect(spawned()).toHaveLength(1);
    expect(spawned()[0]).toMatchObject({
      command: "gh-mcp",
      env: { LOG_LEVEL: "info" },
      secretEnv: { GITHUB_TOKEN: "secret://gh-token" },
      approval: EVIDENCE,
      sandbox: false,
    });
    await world.runtime.shutdown();
  });

  test("a denial spawns nothing and reports secret_denied", async () => {
    const { world, spawned } = setup({ kind: "denied", reason: "the user denied" });
    await startWorld(world);
    const listed = await world.runtime.service.client.listServers({});
    expect(listed.servers[0]?.lastError?.code).toBe("secret_denied");
    expect(spawned()).toEqual([]);
    await world.runtime.shutdown();
  });

  test("a server without secret env never asks the gate", async () => {
    const { gate, world, spawned } = setup(
      { kind: "pending" },
      { def: { transport: { type: "stdio", command: "plain", env: { LOG_LEVEL: "info" } } } },
    );
    await startWorld(world);
    expect(gate.checks).toEqual([]);
    expect(spawned()[0]).toMatchObject({
      env: { LOG_LEVEL: "info" },
      secretEnv: {},
      approval: null,
    });
    await world.runtime.shutdown();
  });

  test("the thread that read the definitions is the one asked", async () => {
    const { gate, world } = setup({ kind: "pending" });
    await startWorld(world);
    expect(gate.checks[0]?.threadId).toBeUndefined();
    await world.runtime.reload(world.controller.signal, { threadId: "thr_one" });
    await world.runtime.settled();
    expect(gate.checks.at(-1)?.threadId).toBe("thr_one");
    await world.runtime.shutdown();
  });
});

describe("per-source sandbox keys", () => {
  const plain: McpServerDef = { transport: { type: "stdio", command: "srv" } };

  const server = (source: string, def: McpServerDef = plain): ServerDefinition => ({
    id: "s",
    source,
    managed: false,
    requiresTrust: false,
    def,
  });

  test("a user-settings server is not sandboxed by default; every other source is", () => {
    for (const [source, expected] of [
      ["settings:user", false],
      ["settings:project", true],
      ["settings:local", true],
      ["mcpjson:project", true],
      ["mcpjson:xeon", true],
      ["ext:helm", true],
      ["something-new", true],
    ] as const) {
      expect([source, sandboxOf(server(source), DEFAULT_MCP_SETTINGS)]).toEqual([source, expected]);
    }
  });

  test("the source keys turn the defaults around and the per-server value beats both", () => {
    const flipped = {
      ...DEFAULT_MCP_SETTINGS,
      sandboxUserSource: true,
      sandboxProjectSource: false,
    };
    expect(sandboxOf(server("settings:user"), flipped)).toBe(true);
    expect(sandboxOf(server("mcpjson:project"), flipped)).toBe(false);
    expect(sandboxOf(server("settings:user", { ...plain, sandbox: false }), flipped)).toBe(false);
    expect(sandboxOf(server("mcpjson:project", { ...plain, sandbox: true }), flipped)).toBe(true);
  });

  test("a user-settings server reaches the process port with sandbox false and a server value with true", async () => {
    const user = setup({ kind: "pending" }, { def: plain });
    await startWorld(user.world);
    expect(user.spawned()[0]?.sandbox).toBe(false);
    await user.world.runtime.shutdown();
  });

  test("the per-server sandbox value beats the source default in both directions", async () => {
    const on = setup({ kind: "pending" }, { def: { ...plain, sandbox: true } });
    await startWorld(on.world);
    expect(on.spawned()[0]?.sandbox).toBe(true);
    await on.world.runtime.shutdown();

    const keyOn = buildWorld({
      servers: { gh: { def: plain, stub: { era: "modern", tools: [{ name: "t" }] } } },
      user: { "sandbox.userSource": true },
    });
    await startWorld(keyOn);
    const status = await keyOn.runtime.service.client.listServers({});
    expect(status.servers[0]?.state).toBe("connected");
    await keyOn.runtime.shutdown();
  });
});
