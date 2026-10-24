import { afterEach, describe, expect, test } from "bun:test";
import { ok, err } from "@xeon/contracts";
import { createTransportFactory } from "../src/transport/factory.ts";
import type { McpHeaderRequest, McpHeaderSecrets } from "../src/ports/secrets.ts";
import { createStubProcessPort } from "../src/testing/stub-process.ts";
import { rejection } from "./support/rejection.ts";
import { releaseStores, openMcpStore } from "./support/store.ts";
import { fixedClock, manualScheduler } from "./support/time.ts";
import { buildWorld, startWorld } from "./support/world.ts";

const SECRET = "SUPERSECRET-9f2c41d7";
const tools = [{ name: "echo" }];

afterEach(releaseStores);

function headerSecrets(): McpHeaderSecrets & { readonly requests: McpHeaderRequest[] } {
  const requests: McpHeaderRequest[] = [];
  return {
    requests,
    resolveHeaders(request) {
      requests.push(request);
      const resolved: Record<string, string> = {};
      for (const [header, ref] of Object.entries(request.refs)) {
        if (ref === "secret://missing")
          return Promise.resolve(err({ kind: "secret_missing", ref }));
        resolved[header] = `Bearer ${SECRET}`;
      }
      return Promise.resolve(ok(resolved));
    },
  };
}

describe("secrets", () => {
  test("secret values never persisted", async () => {
    const store = await openMcpStore(fixedClock());
    const secrets = headerSecrets();
    const seenHeaders: string[] = [];
    const clock = fixedClock();
    const world = buildWorld({
      servers: {
        local: {
          stub: { era: "modern", tools },
          def: { transport: { type: "stdio", command: "srv", env: { API_TOKEN: "secret://tok" } } },
        },
        remote: {
          stub: { era: "modern", tools: [{ name: "other" }] },
          def: {
            transport: {
              type: "http",
              url: "https://mcp.example.com/mcp",
              headers: { Authorization: "secret://auth" },
            },
          },
        },
      },
      secrets: [SECRET],
      overrides: { store: store.service },
      transportsFor: (stubs) => {
        const local = stubs["local"];
        const remote = stubs["remote"];
        if (local === undefined || remote === undefined) throw new Error("stubs missing");
        return createTransportFactory({
          process: createStubProcessPort(local).port,
          secrets,
          scheduler: manualScheduler(clock),
          stdioGraceMs: 10,
          fetch: (url, init) => {
            seenHeaders.push(new Headers(init?.headers).get("authorization") ?? "");
            return remote.http(new Request(url, init));
          },
        });
      },
    });
    await startWorld(world);
    await world.runtime.applyBoundary();
    expect((await world.runtime.service.client.status({ server: "local" })).state).toBe(
      "connected",
    );
    expect((await world.runtime.service.client.status({ server: "remote" })).state).toBe(
      "connected",
    );
    // 값은 요청 헤더로만 나갔다
    expect(seenHeaders.length).toBeGreaterThan(0);
    expect(seenHeaders.every((header) => header === `Bearer ${SECRET}`)).toBe(true);
    expect(secrets.requests[0]?.target).toEqual({ host: "mcp.example.com", port: null });

    const called = await world.runtime.service.client.callTool({
      server: "remote",
      tool: "other",
      arguments: {},
    });
    await world.runtime.shutdown();

    const rows = await store.rowCounts();
    expect(rows["cap_mcp_servers"]).toBe(2);
    const everything = JSON.stringify([
      called,
      world.logger.events,
      world.changes,
      world.rules,
      store.root.read((tx) => tx.all("SELECT * FROM cap_mcp_servers")),
      await world.runtime.service.client.listServers({}),
    ]);
    expect(everything).not.toContain(SECRET);
  });

  test("stdio env is handed to the process port as references only", async () => {
    const clock = fixedClock();
    let spawned: readonly { secretEnv: Readonly<Record<string, string>> }[] = [];
    const world = buildWorld({
      servers: {
        local: {
          stub: { era: "modern", tools },
          def: {
            transport: {
              type: "stdio",
              command: "srv",
              args: ["--x"],
              env: { API_TOKEN: "secret://tok" },
            },
          },
        },
      },
      transportsFor: (stubs) => {
        const local = stubs["local"];
        if (local === undefined) throw new Error("stub missing");
        const process = createStubProcessPort(local);
        spawned = process.spawned;
        return createTransportFactory({
          process: process.port,
          secrets: undefined,
          scheduler: manualScheduler(clock),
          stdioGraceMs: 10,
          fetch: undefined,
        });
      },
    });
    await startWorld(world);
    expect(spawned).toEqual([
      expect.objectContaining({
        command: "srv",
        args: ["--x"],
        secretEnv: { API_TOKEN: "secret://tok" },
        server: "local",
      }),
    ]);
    await world.runtime.shutdown();
  });

  test("stderr masked in lastError", async () => {
    const world = buildWorld({
      servers: {
        local: {
          stub: { era: "modern", tools },
          def: { transport: { type: "stdio", command: "srv" } },
        },
      },
      secrets: [SECRET],
      user: { "reconnect.maxAttempts": 1 },
      transportsFor: (stubs) => {
        const local = stubs["local"];
        if (local === undefined) throw new Error("stub missing");
        const process = createStubProcessPort(local);
        process.failNext({
          kind: "spawn_failed",
          code: "EACCES",
          message: `cannot run with token ${SECRET}`,
        });
        return createTransportFactory({
          process: process.port,
          secrets: undefined,
          scheduler: manualScheduler(fixedClock()),
          stdioGraceMs: 10,
          fetch: undefined,
        });
      },
    });
    await startWorld(world);
    const status = await world.runtime.service.client.status({ server: "local" });
    expect(status.state).toBe("failed");
    expect(status.lastError?.message).toContain("[REDACTED]");
    expect(JSON.stringify(status)).not.toContain(SECRET);
    await world.runtime.shutdown();
  });

  test("a missing header secret fails the connection without leaking anything", async () => {
    const secrets = headerSecrets();
    const world = buildWorld({
      servers: {
        remote: {
          stub: { era: "modern", tools },
          def: {
            transport: {
              type: "http",
              url: "https://mcp.example.com/mcp",
              headers: { Authorization: "secret://missing" },
            },
          },
        },
      },
      user: { "reconnect.maxAttempts": 1 },
      transportsFor: (stubs) => {
        const remote = stubs["remote"];
        if (remote === undefined) throw new Error("stub missing");
        return createTransportFactory({
          process: undefined,
          secrets,
          scheduler: manualScheduler(fixedClock()),
          stdioGraceMs: 10,
          fetch: (url, init) => remote.http(new Request(url, init)),
        });
      },
    });
    await startWorld(world);
    const status = await world.runtime.service.client.status({ server: "remote" });
    expect(status.state).toBe("failed");
    expect(status.lastError?.message).toContain("secret://missing");
    const blocked = await rejection(
      world.runtime.service.client.callTool({ server: "remote", tool: "echo", arguments: {} }),
    );
    expect(blocked).toMatchObject({ data: { code: "server_disconnected" } });
    await world.runtime.shutdown();
  });
});
