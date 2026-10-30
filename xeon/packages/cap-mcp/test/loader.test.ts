import { describe, expect, test } from "bun:test";
import { attempt } from "@xeon/contracts";
import { readSettingsServers } from "../src/settings.ts";
import { normalizeServerName, parseMcpJson } from "../src/servers/loader.ts";
import { looksLikeSecretName } from "../src/servers/values.ts";
import { evaluateServer } from "../src/servers/policy.ts";
import type { ServerDefinition } from "../src/types.ts";
import { flush } from "./support/flush.ts";
import { rejection } from "./support/rejection.ts";
import { layer } from "./support/layers.ts";
import { buildWorld, fakeFiles, fakeTrust, startWorld } from "./support/world.ts";

const ROOT = "/repo";

function mcpJson(servers: Record<string, unknown>): string {
  return JSON.stringify({ mcpServers: servers });
}

const stubTools = [{ name: "t" }];

function projectWorld(options: {
  files: Record<string, string>;
  trusted: boolean;
  user?: Record<string, unknown>;
  extra?: Parameters<typeof buildWorld>[0]["layers"];
  servers?: string[];
}) {
  const servers: Record<string, { stub: { era: "modern"; tools: typeof stubTools } }> = {};
  for (const id of options.servers ?? ["proj", "my-server", "other"]) {
    servers[id] = { stub: { era: "modern", tools: stubTools } };
  }
  const files = fakeFiles(options.files);
  const trust = fakeTrust(options.trusted);
  const world = buildWorld({
    servers,
    user: { servers: {}, ...options.user },
    ...(options.extra === undefined ? {} : { layers: options.extra }),
    overrides: { projectRoot: ROOT, files, trust },
  });
  return { world, files, trust };
}

describe("definition loader", () => {
  test("merges settings and mcp json", async () => {
    const { world } = projectWorld({
      files: {
        [`${ROOT}/.mcp.json`]: mcpJson({
          proj: { command: "proj-server" },
          shared: { command: "from-mcp-json" },
        }),
      },
      trusted: true,
      user: { servers: { shared: { transport: { type: "stdio", command: "from-settings" } } } },
      servers: ["proj", "shared"],
    });
    await startWorld(world);
    const listed = await world.runtime.service.client.listServers({});
    const bySource = Object.fromEntries(
      listed.servers.map((server) => [server.server, server.source]),
    );
    expect(bySource).toEqual({ proj: "mcpjson:project", shared: "settings:user" });
    await world.runtime.shutdown();
  });

  test("normalizes mcp json names", async () => {
    expect(normalizeServerName("My_Server")).toBe("my-server");
    const taken = new Set<string>();
    const parsed = parseMcpJson(
      mcpJson({ My_Server: { command: "a" }, "1bad": { command: "b" }, ok: { command: "c" } }),
      "root",
      taken,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.servers.map((server) => server.id)).toEqual(["my-server", "ok"]);
    expect(parsed.value.diagnostics).toEqual([
      expect.objectContaining({ code: "invalid_name", server: "1bad" }),
    ]);
  });

  test("maps transport types and rejects bad entries", () => {
    const parsed = parseMcpJson(
      mcpJson({
        a: { command: "x", args: ["--flag"], env: { TOKEN: "secret://tok" } },
        b: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "secret://auth" },
        },
        c: { type: "streamable-http", url: "https://example.com/c" },
        d: { type: "sse", url: "https://example.com/sse" },
        e: { type: "websocket", url: "wss://x" },
        f: { type: "http" },
        g: { type: "stdio" },
      }),
      "xeon",
      new Set(),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const transports = Object.fromEntries(
      parsed.value.servers.map((server) => [server.id, server.def.transport.type]),
    );
    expect(transports).toEqual({ a: "stdio", b: "http", c: "http", d: "sse" });
    expect(
      parsed.value.servers.every(
        (server) => server.source === "mcpjson:xeon" && server.requiresTrust,
      ),
    ).toBe(true);
    expect(parsed.value.diagnostics.map((diagnostic) => diagnostic.server)).toEqual([
      "e",
      "f",
      "g",
    ]);
    expect(parseMcpJson("{", "root", new Set())).toEqual({
      ok: false,
      error: { kind: "invalid_json" },
    });
    expect(parseMcpJson("{}", "root", new Set())).toEqual({
      ok: false,
      error: { kind: "no_servers" },
    });
  });

  test("rejects plaintext env", async () => {
    const parsed = parseMcpJson(
      mcpJson({
        leaky: { command: "x", env: { TOKEN: "hunter2hunter2" } },
        leakyHeader: {
          type: "http",
          url: "https://e.com",
          headers: { Authorization: "Bearer abc" },
        },
        fine: { command: "y", env: { TOKEN: "secret://tok" } },
      }),
      "root",
      new Set(),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.servers.map((server) => server.id)).toEqual(["fine"]);
    expect(parsed.value.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "plaintext_secret",
      "plaintext_secret",
    ]);
    // 진단에는 값이 없다
    expect(JSON.stringify(parsed.value.diagnostics)).not.toContain("hunter2hunter2");
    expect(JSON.stringify(parsed.value.diagnostics)).not.toContain("Bearer abc");
  });

  test("untrusted project skips mcp json", async () => {
    const { world, files, trust } = projectWorld({
      files: {
        [`${ROOT}/.mcp.json`]: mcpJson({ proj: { command: "x" } }),
        [`${ROOT}/.xeon/mcp.json`]: mcpJson({ other: { command: "y" } }),
      },
      trusted: false,
      extra: [
        layer("project", {
          "l2.mcp.servers": { "my-server": { transport: { type: "stdio", command: "z" } } },
        }),
      ],
    });
    const loaded = await world.runtime.load(world.controller.signal);
    await world.runtime.settled();
    expect(trust.calls).toBe(1);
    expect(files.reads).toEqual([]);
    expect(loaded.diagnostics.filter((d) => d.code === "untrusted_project")).toHaveLength(2);
    // project 범위 설정 정의는 목록에만 보이고 연결하지 않는다
    const listed = await world.runtime.service.client.listServers({});
    expect(listed.servers).toMatchObject([
      {
        server: "my-server",
        state: "blocked",
        blockedReason: "untrusted_project",
        source: "settings:project",
      },
    ]);
    expect(world.factory.opens).toEqual([]);
    const call = await rejection(
      world.runtime.service.client.callTool({ server: "my-server", tool: "t", arguments: {} }),
    );
    expect(call).toMatchObject({ data: { code: "server_blocked" } });
    await world.runtime.shutdown();
  });

  test("trusted project reads both files and the xeon file wins", async () => {
    const { world, files } = projectWorld({
      files: {
        [`${ROOT}/.mcp.json`]: mcpJson({ proj: { command: "root" } }),
        [`${ROOT}/.xeon/mcp.json`]: mcpJson({ proj: { command: "xeon" }, other: { command: "o" } }),
      },
      trusted: true,
    });
    await startWorld(world);
    expect(files.reads.toSorted()).toEqual([`${ROOT}/.mcp.json`, `${ROOT}/.xeon/mcp.json`]);
    const listed = await world.runtime.service.client.listServers({});
    const bySource = Object.fromEntries(
      listed.servers.map((server) => [server.server, server.source]),
    );
    expect(bySource).toEqual({ proj: "mcpjson:xeon", other: "mcpjson:xeon" });
    await world.runtime.shutdown();
  });

  test("importMcpJson false skips the files", async () => {
    const { world, files, trust } = projectWorld({
      files: { [`${ROOT}/.mcp.json`]: mcpJson({ proj: { command: "x" } }) },
      trusted: true,
      user: { importMcpJson: false },
    });
    await startWorld(world);
    expect(files.reads).toEqual([]);
    expect(trust.calls).toBe(0);
    expect((await world.runtime.service.client.listServers({})).servers).toEqual([]);
    await world.runtime.shutdown();
  });
});

function definition(
  id: string,
  transport: ServerDefinition["def"]["transport"],
  managed = false,
): ServerDefinition {
  return { id, def: { transport }, source: "settings:user", managed, requiresTrust: false };
}

const open = { allowedServers: [], deniedServers: [], managedOnly: false };

function verdict(target: ServerDefinition, denied: string[]) {
  return evaluateServer(target, { ...open, deniedServers: denied }, true);
}

describe("server policy", () => {
  test("deny wins over allow", async () => {
    const world = buildWorld({
      servers: { stub: { stub: { era: "modern", tools: stubTools } } },
      user: { allowedServers: ["id:stub"], deniedServers: ["id:stub"] },
    });
    await startWorld(world);
    const status = await world.runtime.service.client.status({ server: "stub" });
    expect(status).toMatchObject({ state: "blocked", blockedReason: "denied_by_policy" });
    await world.runtime.shutdown();
  });

  test("allow list blocks servers that are not listed", async () => {
    const world = buildWorld({
      servers: {
        a: { stub: { era: "modern", tools: stubTools } },
        b: { stub: { era: "modern", tools: stubTools } },
      },
      user: { allowedServers: ["a"] },
    });
    await startWorld(world);
    const listed = await world.runtime.service.client.listServers({});
    expect(
      listed.servers.map((server) => [server.server, server.state, server.blockedReason]),
    ).toEqual([
      ["a", "connected", undefined],
      ["b", "blocked", "not_in_allowlist"],
    ]);
    await world.runtime.shutdown();
  });

  test("managed only", async () => {
    const world = buildWorld({
      servers: {
        mine: { stub: { era: "modern", tools: stubTools } },
        corp: { stub: { era: "modern", tools: stubTools } },
      },
      layers: [
        layer("managed", {
          "l2.mcp.managedOnly": true,
          "l2.mcp.servers": { corp: { transport: { type: "stdio", command: "corp" } } },
        }),
      ],
      user: { servers: { mine: { transport: { type: "stdio", command: "mine" } } } },
    });
    await startWorld(world);
    const listed = await world.runtime.service.client.listServers({});
    expect(
      listed.servers.map((server) => [server.server, server.state, server.blockedReason]),
    ).toEqual([
      ["corp", "connected", undefined],
      ["mine", "blocked", "managed_only"],
    ]);
    await world.runtime.shutdown();
  });

  test("list entries match id, command and url", () => {
    const stdio = definition("a", { type: "stdio", command: "/usr/bin/npx" });
    const remote = definition("b", { type: "http", url: "https://mcp.example.com/v1" });
    expect(verdict(stdio, ["command:npx"])).toEqual({ blocked: true, reason: "denied_by_policy" });
    expect(verdict(stdio, ["command:node"])).toEqual({ blocked: false });
    expect(verdict(remote, ["url:https://mcp.example.com"])).toEqual({
      blocked: true,
      reason: "denied_by_policy",
    });
    expect(verdict(remote, ["url:https://other.example.com"])).toEqual({ blocked: false });
    expect(verdict(stdio, ["url:https://mcp.example.com"])).toEqual({ blocked: false });
    expect(verdict(remote, ["command:npx"])).toEqual({ blocked: false });
    expect(verdict(stdio, ["a"])).toEqual({ blocked: true, reason: "denied_by_policy" });
    expect(verdict(stdio, ["weird:a"])).toEqual({ blocked: false });
  });

  test("tool deny and allow lists are applied to calls too", async () => {
    const world = buildWorld({
      servers: {
        stub: {
          stub: { era: "modern", tools: [{ name: "a" }, { name: "b" }, { name: "c" }] },
          def: { tools: { allow: ["a", "b"], deny: ["b"] } },
        },
      },
    });
    await startWorld(world);
    const listed = await world.runtime.service.client.listTools({ server: "stub" });
    expect(listed.tools.map((tool) => tool.hiddenReason)).toEqual([
      undefined,
      "denied",
      "not_allowed",
    ]);
    const hidden = await rejection(
      world.runtime.service.client.callTool({ server: "stub", tool: "b", arguments: {} }),
    );
    expect(hidden).toMatchObject({ data: { code: "denied" } });
    const missing = await rejection(
      world.runtime.service.client.callTool({ server: "stub", tool: "zzz", arguments: {} }),
    );
    expect(missing).toMatchObject({ data: { code: "tool_unknown" } });
    await world.runtime.shutdown();
  });
});

function thrown(work: () => void): unknown {
  const outcome = attempt(work);
  return outcome.ok ? undefined : outcome.error.cause;
}

describe("extension servers", () => {
  const def = { transport: { type: "stdio", command: "ext-server" } };

  test("registerServer shows an ext source and unsubscribe removes the server", async () => {
    const world = buildWorld({
      servers: { stub: { stub: { era: "modern", tools: stubTools } } },
      user: { servers: {} },
    });
    await startWorld(world);
    // 확장이 등록할 서버의 스텁은 buildWorld가 이미 서버 id로 만들어 두었다
    const unsubscribe = world.runtime.service.registerServer("helm/keeper", "stub", def);
    await world.runtime.settled();
    const listed = await world.runtime.service.client.listServers({});
    expect(listed.servers).toMatchObject([
      { server: "stub", source: "ext:helm", state: "connected" },
    ]);
    await world.runtime.applyBoundary();
    expect(world.registrar.names()).toEqual(["t"]);

    unsubscribe();
    await flush();
    const removed = await world.runtime.applyBoundary();
    expect(removed.toolsRemoved).toEqual(["t"]);
    expect(world.changes.at(-1)?.servers).toEqual([{ id: "stub", status: "disabled" }]);
    expect((await world.runtime.service.client.listServers({})).servers).toEqual([]);
    await world.runtime.shutdown();
  });

  test("registerServer validates the name and definition and rejects duplicates", async () => {
    const world = buildWorld({ servers: { stub: { stub: { era: "modern", tools: stubTools } } } });
    await startWorld(world);
    expect(
      thrown(() => world.runtime.service.registerServer("helm", "Bad_Name", def)),
    ).toMatchObject({
      data: { code: "invalid_input" },
    });
    expect(
      thrown(() => world.runtime.service.registerServer("helm", "ext-one", { nope: true })),
    ).toMatchObject({
      data: { code: "invalid_input" },
    });
    // 설정에 있는 id와 겹치면 거부된다
    expect(thrown(() => world.runtime.service.registerServer("helm", "stub", def))).toMatchObject({
      data: { code: "invalid_input" },
    });
    world.runtime.service.registerServer("helm", "ext-one", def);
    expect(
      thrown(() => world.runtime.service.registerServer("other", "ext-one", def)),
    ).toMatchObject({
      data: { code: "invalid_input" },
    });
    await world.runtime.shutdown();
  });
});

describe("plaintext env and headers (M3-REQ-97)", () => {
  test("a plaintext value under a non-secret name is accepted next to a secret reference", () => {
    const parsed = parseMcpJson(
      mcpJson({
        mixed: {
          command: "x",
          env: { LOG_LEVEL: "debug", MAX_TOKENS: "4096", API_TOKEN: "secret://tok" },
        },
        web: { type: "http", url: "https://e.com", headers: { "X-Region": "eu" } },
      }),
      "root",
      new Set(),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.diagnostics).toEqual([]);
    expect(parsed.value.servers.map((server) => server.id).toSorted()).toEqual(["mixed", "web"]);
  });

  test("secret-like names are rejected in every spelling and a malformed secret:// value is not sent as plaintext", () => {
    const names = [
      "API_KEY",
      "apiKey",
      "GITHUB_TOKEN",
      "DB_PASSWORD",
      "client-secret",
      "Authorization",
    ];
    for (const name of names) {
      expect(looksLikeSecretName(name)).toBe(true);
    }
    for (const name of ["LOG_LEVEL", "MAX_TOKENS", "KEYBOARD", "HOME", "X-Region"]) {
      expect(looksLikeSecretName(name)).toBe(false);
    }
    const parsed = parseMcpJson(
      mcpJson({
        typo: { command: "x", env: { REGION: "secret://Bad_Name" } },
        leaky: { command: "y", env: { DB_PASSWORD: "hunter2hunter2" } },
      }),
      "root",
      new Set(),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.servers).toEqual([]);
    expect(parsed.value.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "invalid_definition",
      "plaintext_secret",
    ]);
  });

  test("the settings path applies the same rules", () => {
    const read = readSettingsServers([
      layer("user", {
        "l2.mcp.servers": {
          ok: { transport: { type: "stdio", command: "x", env: { LOG_LEVEL: "1" } } },
          bad: { transport: { type: "stdio", command: "x", env: { GITHUB_TOKEN: "plain" } } },
        },
      }),
    ]);
    expect(read.servers.map((server) => server.id)).toEqual(["ok"]);
    expect(read.diagnostics).toMatchObject([{ code: "plaintext_secret", server: "bad" }]);
    expect(JSON.stringify(read.diagnostics)).not.toContain('plain"');
  });
});
