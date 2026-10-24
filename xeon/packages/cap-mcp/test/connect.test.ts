import { afterEach, describe, expect, test } from "bun:test";
import { wrapUntrustedMcp } from "@xeon/contracts/capabilities";
import { STUB_LEGACY_VERSION, STUB_MODERN_VERSION } from "../src/testing/stub-server.ts";
import { releaseStores, openMcpStore } from "./support/store.ts";
import { rejection } from "./support/rejection.ts";
import { fixedClock } from "./support/time.ts";
import { buildWorld, startWorld, type World } from "./support/world.ts";

const SIGNAL = new AbortController().signal;
const tools = [
  {
    name: "echo",
    description: "Echo text",
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
  },
  { name: "add", description: "Add numbers" },
];

function openWorld(): World {
  return buildWorld({ servers: { stub: { stub: { era: "modern", tools } } } });
}

afterEach(releaseStores);

describe("connection", () => {
  test("connects and lists tools", async () => {
    const world = openWorld();
    await startWorld(world);
    const listed = await world.runtime.service.client.listTools({ server: "stub" });
    expect(listed.tools.map((tool) => tool.name)).toEqual(["echo", "add"]);
    expect(listed.tools.every((tool) => tool.exposed)).toBe(true);
    const status = await world.runtime.service.client.status({ server: "stub" });
    expect(status).toMatchObject({ state: "connected", toolCount: 2, source: "settings:user" });
    await world.runtime.shutdown();
  });

  test("exposes tools at next step boundary", async () => {
    const world = openWorld();
    await startWorld(world);
    // 연결만으로는 도구 표가 바뀌지 않는다
    expect(world.registrar.names()).toEqual([]);
    const report = await world.runtime.applyBoundary();
    expect(world.registrar.names()).toEqual(["add", "echo"]);
    expect(report.toolsAdded.toSorted()).toEqual(["add", "echo"]);
    expect(world.changes).toHaveLength(1);
    expect(world.changes[0]?.servers).toEqual([{ id: "stub", status: "connected" }]);
    const tool = world.registrar.registered[0];
    expect(tool?.orderKey).toBe("mcp.stub");
    // 두 번째 경계는 바뀐 것이 없다
    const again = await world.runtime.applyBoundary();
    expect(again.changed).toBe(false);
    expect(world.changes).toHaveLength(1);
    await world.runtime.shutdown();
  });

  test("deny filter hides tool", async () => {
    const world = buildWorld({
      servers: { stub: { stub: { era: "modern", tools }, def: { tools: { deny: ["add"] } } } },
    });
    await startWorld(world);
    const listed = await world.runtime.service.client.listTools({ server: "stub" });
    expect(listed.tools.find((tool) => tool.name === "add")).toMatchObject({
      exposed: false,
      machineName: null,
      hiddenReason: "denied",
    });
    await world.runtime.applyBoundary();
    expect(world.registrar.names()).toEqual(["echo"]);
    await world.runtime.shutdown();
  });

  test("negotiates 2026 with auto", async () => {
    const world = openWorld();
    await startWorld(world);
    const status = await world.runtime.service.client.status({ server: "stub" });
    expect(status.protocolVersion).toBe(STUB_MODERN_VERSION);
    expect(world.stubs["stub"]?.requests.map((request) => request.method)).toContain(
      "server/discover",
    );
    await world.runtime.shutdown();
  });

  test("falls back to 2025 when the server is old", async () => {
    const world = buildWorld({ servers: { stub: { stub: { era: "legacy", tools } } } });
    await startWorld(world);
    const status = await world.runtime.service.client.status({ server: "stub" });
    expect(status.protocolVersion).toBe(STUB_LEGACY_VERSION);
    expect(status.toolCount).toBe(2);
    await world.runtime.shutdown();
  });

  test("calls tool and converts content", async () => {
    const store = await openMcpStore(fixedClock());
    const png = Buffer.from("not really a png").toString("base64");
    const world = buildWorld({
      servers: {
        stub: {
          stub: {
            era: "modern",
            tools: [
              {
                name: "mixed",
                handle: () => ({
                  kind: "complete",
                  content: [
                    { type: "text", text: "hello" },
                    { type: "image", data: png, mimeType: "image/png" },
                    { type: "resource_link", uri: "file:///a.txt", name: "a" },
                    { type: "audio", data: "AAAA", mimeType: "audio/wav" },
                  ],
                  structuredContent: { ok: true },
                }),
              },
            ],
          },
        },
      },
      overrides: { store: store.service },
    });
    await startWorld(world);
    const output = await world.runtime.service.client.callTool({
      server: "stub",
      tool: "mixed",
      arguments: {},
    });
    expect(output.status).toBe("complete");
    if (output.status !== "complete") return;
    expect(output.content.map((block) => block.type)).toEqual([
      "text",
      "image",
      "resource_link",
      "unsupported",
    ]);
    const image = output.content[1];
    expect(image?.type === "image" ? image.blob.size : 0).toBe("not really a png".length);
    expect(output.structuredContent).toEqual({ ok: true });
    await world.runtime.shutdown();
  });

  test("wraps text as untrusted", async () => {
    const world = openWorld();
    await startWorld(world);
    await world.runtime.applyBoundary();
    const tool = world.registrar.registered.find((candidate) => candidate.wire.name === "echo");
    expect(tool).toBeDefined();
    const result = await tool?.execute({ text: "hi" }, { signal: SIGNAL, requestId: "call-1" });
    const first = result?.content[0];
    expect(first?.type === "text" ? first.text : "").toBe(wrapUntrustedMcp("stub", "ok echo"));
    expect(first?.type === "text" ? first.text : "").toContain(
      '<untrusted_mcp_content server="stub">',
    );
    await world.runtime.shutdown();
  });

  test("server isError maps to tool error", async () => {
    const world = buildWorld({
      servers: {
        stub: {
          stub: {
            era: "modern",
            tools: [
              {
                name: "boom",
                handle: () => ({
                  kind: "complete",
                  content: [{ type: "text", text: "bad" }],
                  isError: true,
                }),
              },
            ],
          },
        },
      },
    });
    await startWorld(world);
    await world.runtime.applyBoundary();
    const result = await world.registrar.registered[0]?.execute(
      {},
      { signal: SIGNAL, requestId: "c" },
    );
    expect(result?.isError).toBe(true);
    expect(result?.status).toBe("complete");
    await world.runtime.shutdown();
  });

  test("result size limit", async () => {
    const long = "x".repeat(5000);
    const world = buildWorld({
      servers: {
        stub: {
          stub: {
            era: "modern",
            tools: [
              {
                name: "long",
                handle: () => ({ kind: "complete", content: [{ type: "text", text: long }] }),
              },
            ],
          },
        },
      },
      user: { "result.maxBytes": 1024 },
    });
    await startWorld(world);
    const output = await world.runtime.service.client.callTool({
      server: "stub",
      tool: "long",
      arguments: {},
    });
    expect(output.status).toBe("complete");
    if (output.status !== "complete") return;
    expect(output.truncated).toEqual({ shownBytes: 1024, totalBytes: 5000 });
    const text = output.content[0];
    expect(text?.type === "text" ? text.text.length : 0).toBe(1024);
    await world.runtime.shutdown();
  });

  test("unknown and blocked servers are rejected with typed errors", async () => {
    const world = buildWorld({
      servers: { stub: { stub: { era: "modern", tools } } },
      user: { deniedServers: ["id:stub"] },
    });
    await startWorld(world);
    expect(await rejection(world.runtime.service.client.status({ server: "nope" }))).toMatchObject({
      data: { code: "server_unknown" },
    });
    const blocked = world.runtime.service.client.callTool({
      server: "stub",
      tool: "echo",
      arguments: {},
    });
    expect(await rejection(blocked)).toMatchObject({ data: { code: "server_blocked" } });
    await world.runtime.shutdown();
  });
});
