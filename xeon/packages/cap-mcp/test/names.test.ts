import { describe, expect, test } from "bun:test";
import type { JsonObject } from "@xeon/contracts/conversation";
import { orderedOf } from "../src/client/dynamic-tools.ts";
import { buildWorld, startWorld } from "./support/world.ts";

function nested(depth: number): JsonObject {
  let schema: JsonObject = { type: "string" };
  for (let level = 0; level < depth; level += 1) {
    schema = { type: "object", properties: { next: schema } };
  }
  return schema;
}

describe("tool names", () => {
  test("name conflict hides later tool", async () => {
    const world = buildWorld({
      servers: {
        beta: { stub: { era: "modern", tools: [{ name: "search" }, { name: "only-beta" }] } },
        alpha: { stub: { era: "modern", tools: [{ name: "search" }] } },
      },
    });
    await startWorld(world);
    const alpha = await world.runtime.service.client.listTools({ server: "alpha" });
    const beta = await world.runtime.service.client.listTools({ server: "beta" });
    expect(alpha.tools[0]).toMatchObject({ exposed: true, machineName: "search" });
    // 서버 id 바이트 순으로 뒤쪽(beta)이 숨는다
    expect(beta.tools.find((tool) => tool.name === "search")).toMatchObject({
      exposed: false,
      machineName: null,
      hiddenReason: "name_conflict",
    });
    await world.runtime.applyBoundary();
    expect(world.registrar.names()).toEqual(["only-beta", "search"]);
    expect(world.registrar.registered.find((tool) => tool.wire.name === "search")?.server).toBe(
      "alpha",
    );
    await world.runtime.shutdown();
  });

  test("built-in tool names are reserved", async () => {
    const world = buildWorld({
      servers: { stub: { stub: { era: "modern", tools: [{ name: "read" }, { name: "extra" }] } } },
      reserved: ["read"],
    });
    await startWorld(world);
    const listed = await world.runtime.service.client.listTools({ server: "stub" });
    expect(listed.tools.find((tool) => tool.name === "read")?.hiddenReason).toBe("name_conflict");
    expect(listed.tools.find((tool) => tool.name === "extra")?.exposed).toBe(true);
    await world.runtime.shutdown();
  });

  test("invalid name hidden", async () => {
    const world = buildWorld({
      servers: {
        stub: {
          stub: {
            era: "modern",
            tools: [{ name: "bad name!" }, { name: "x".repeat(65) }, { name: "ok_name-1" }],
          },
        },
      },
    });
    await startWorld(world);
    const listed = await world.runtime.service.client.listTools({ server: "stub" });
    expect(listed.tools.map((tool) => tool.hiddenReason)).toEqual([
      "name_invalid",
      "name_invalid",
      undefined,
    ]);
    // 문자를 임의로 바꾸지 않는다
    expect(listed.tools.map((tool) => tool.machineName)).toEqual([null, null, "ok_name-1"]);
    await world.runtime.shutdown();
  });

  test("schema over limit hidden", async () => {
    const world = buildWorld({
      servers: {
        stub: {
          stub: {
            era: "modern",
            tools: [
              { name: "deep", inputSchema: nested(13) },
              { name: "shallow", inputSchema: nested(3) },
              {
                name: "external",
                inputSchema: {
                  type: "object",
                  properties: { a: { $ref: "https://example.com/s.json" } },
                },
              },
            ],
          },
        },
      },
    });
    await startWorld(world);
    const listed = await world.runtime.service.client.listTools({ server: "stub" });
    const reasons = Object.fromEntries(
      listed.tools.map((tool) => [tool.name, tool.hiddenReason ?? "exposed"]),
    );
    expect(reasons).toEqual({
      deep: "schema_invalid",
      shallow: "exposed",
      external: "schema_invalid",
    });
    await world.runtime.shutdown();
  });

  test("order key is mcp server", async () => {
    const world = buildWorld({
      servers: {
        zed: { stub: { era: "modern", tools: [{ name: "b" }, { name: "a" }] } },
        alpha: { stub: { era: "modern", tools: [{ name: "c" }] } },
      },
    });
    await startWorld(world);
    await world.runtime.applyBoundary();
    const ordered = orderedOf(world.registrar.registered);
    expect(ordered.map((tool) => `${tool.capability}/${tool.name}`)).toEqual([
      "mcp.alpha/c",
      "mcp.zed/a",
      "mcp.zed/b",
    ]);
    await world.runtime.shutdown();
  });

  test("a registrar conflict keeps the tool out and is logged", async () => {
    const world = buildWorld({
      servers: { stub: { stub: { era: "modern", tools: [{ name: "a" }, { name: "b" }] } } },
    });
    world.registrar.reject("a");
    await startWorld(world);
    const report = await world.runtime.applyBoundary();
    expect(report.toolsAdded).toEqual(["b"]);
    expect(world.logger.events.some((event) => event.event === "mcp.tool_name_conflict")).toBe(
      true,
    );
    await world.runtime.shutdown();
  });

  test("a tool definition change re-registers the tool", async () => {
    const world = buildWorld({
      servers: { stub: { stub: { era: "modern", tools: [{ name: "a", description: "one" }] } } },
    });
    await startWorld(world);
    await world.runtime.applyBoundary();
    world.stubs["stub"]?.setTools([{ name: "a", description: "two" }]);
    await world.runtime.service.client.reconnect({ server: "stub" });
    const report = await world.runtime.applyBoundary();
    expect(report.toolsAdded).toEqual(["a"]);
    expect(report.toolsRemoved).toEqual([]);
    expect(world.registrar.unregistered).toEqual(["a"]);
    expect(world.registrar.registered.at(-1)?.wire.description).toBe("two");
    await world.runtime.shutdown();
  });

  test("a tool whose schema is not an object makes the SDK reject the whole listing", async () => {
    const world = buildWorld({
      servers: {
        stub: {
          stub: {
            era: "modern",
            tools: [{ name: "ok" }, { name: "bad", inputSchema: { type: "string" } }],
          },
        },
      },
      user: { "reconnect.maxAttempts": 1 },
    });
    await startWorld(world);
    const status = await world.runtime.service.client.status({ server: "stub" });
    expect(status).toMatchObject({ state: "failed", lastError: { code: "protocol_error" } });
    await world.runtime.shutdown();
  });
});
