import { describe, expect, test } from "bun:test";
import { ok } from "@xeon/contracts";
import { connectMcp } from "../src/adapter.ts";
import type { McpHeaderSecrets } from "../src/ports/secrets.ts";
import { createStubServer, type StubServer } from "../src/testing/stub-server.ts";
import { createTransportFactory } from "../src/transport/factory.ts";
import type { ServerDefinition } from "../src/types.ts";
import { fixedClock, manualScheduler } from "./support/time.ts";
import { captureLogger } from "./support/logger.ts";

const signal = new AbortController().signal;

function definitionFor(
  url: string,
  headers?: Record<string, string>,
  kind: "http" | "sse" = "http",
): ServerDefinition {
  return {
    id: "remote",
    source: "settings:user",
    managed: false,
    requiresTrust: false,
    def: {
      transport:
        kind === "http"
          ? { type: "http", url, ...(headers ? { headers } : {}) }
          : { type: "sse", url },
    },
  };
}

function factoryFor(
  fetchImpl: Parameters<typeof createTransportFactory>[0]["fetch"],
  secrets?: McpHeaderSecrets,
) {
  return createTransportFactory({
    process: undefined,
    secrets,
    scheduler: manualScheduler(fixedClock()),
    stdioGraceMs: 1,
    fetch: fetchImpl,
  });
}

async function listThroughHttp(
  stub: StubServer,
  definition: ServerDefinition,
  negotiation: "auto" | "legacy",
) {
  const factory = factoryFor((url, init) => stub.http(new Request(url, init)));
  const opened = await factory.open(definition, signal);
  if (!opened.ok) throw new Error("open failed");
  const connected = await connectMcp({
    transport: opened.value.transport,
    negotiation,
    connectTimeoutMs: 5000,
    signal,
    client: { name: "xeon-test", version: "0.0.0" },
    logger: captureLogger(),
  });
  if (!connected.ok) throw new Error(`connect failed: ${connected.error.message}`);
  const tools = await connected.value.listTools({ signal, timeoutMs: 5000 });
  const version = connected.value.protocolVersion;
  await connected.value.close();
  return { tools: tools.ok ? tools.value.map((tool) => tool.name) : [], version };
}

describe("http transport", () => {
  test("streamable http works under bun with a fake fetch (2026 and 2025)", async () => {
    const modern = await listThroughHttp(
      createStubServer({ era: "modern", tools: [{ name: "a" }] }),
      definitionFor("https://mcp.example.com/mcp"),
      "auto",
    );
    expect(modern).toEqual({ tools: ["a"], version: "2026-07-28" });
    const legacy = await listThroughHttp(
      createStubServer({ era: "legacy", tools: [{ name: "b" }] }),
      definitionFor("https://mcp.example.com/mcp"),
      "legacy",
    );
    expect(legacy).toEqual({ tools: ["b"], version: "2025-11-25" });
  });

  test("streamable http works under bun over a real loopback socket", async () => {
    const stub = createStubServer({ era: "modern", tools: [{ name: "net" }] });
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => stub.http(request),
    });
    try {
      const result = await listThroughHttp(
        stub,
        definitionFor(`http://127.0.0.1:${server.port}/mcp`),
        "auto",
      );
      expect(result.tools).toEqual(["net"]);
    } finally {
      await server.stop(true);
    }
  });

  test("headers are resolved from secret references for every request", async () => {
    const stub = createStubServer({ era: "modern", tools: [{ name: "a" }] });
    const seen: string[] = [];
    let resolved = 0;
    const secrets: McpHeaderSecrets = {
      resolveHeaders() {
        resolved += 1;
        return Promise.resolve(ok({ Authorization: `Bearer t${resolved}` }));
      },
    };
    const factory = factoryFor((url, init) => {
      seen.push(new Headers(init?.headers).get("authorization") ?? "none");
      return stub.http(new Request(url, init));
    }, secrets);
    const opened = await factory.open(
      definitionFor("https://mcp.example.com/mcp", { Authorization: "secret://auth" }),
      signal,
    );
    if (!opened.ok) throw new Error("open failed");
    const connected = await connectMcp({
      transport: opened.value.transport,
      negotiation: "auto",
      connectTimeoutMs: 5000,
      signal,
      client: { name: "xeon-test", version: "0.0.0" },
      logger: captureLogger(),
    });
    expect(connected.ok).toBe(true);
    if (!connected.ok) return;
    await connected.value.listTools({ signal, timeoutMs: 5000 });
    await connected.value.close();
    // 요청마다 새로 풀어 붙인다(캐시하지 않는다)
    expect(seen.length).toBe(resolved);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.every((header) => header.startsWith("Bearer t"))).toBe(true);
  });

  test("a bad url and a missing secrets port are reported", async () => {
    const bad = await factoryFor(undefined).open(definitionFor("https://"), signal);
    expect(bad).toMatchObject({ ok: false, error: { code: "invalid_url" } });
    const stub = createStubServer({ era: "modern", tools: [] });
    const opened = await factoryFor((url, init) => stub.http(new Request(url, init))).open(
      definitionFor("https://mcp.example.com/mcp", { Authorization: "secret://auth" }),
      signal,
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const connected = await connectMcp({
      transport: opened.value.transport,
      negotiation: "auto",
      connectTimeoutMs: 1000,
      signal,
      client: { name: "xeon-test", version: "0.0.0" },
      logger: captureLogger(),
    });
    expect(connected.ok).toBe(false);
  });

  test("sse definitions create a transport", async () => {
    const opened = await factoryFor(undefined).open(
      definitionFor("https://mcp.example.com/sse", undefined, "sse"),
      signal,
    );
    expect(opened.ok).toBe(true);
  });
});
