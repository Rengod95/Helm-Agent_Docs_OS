import { describe, expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import type { ToolRegistration } from "@xeon/contracts/services";
import type { ToolResourceDef, ToolsPort } from "@xeon/contracts/extensions";
import {
  createToolServiceRegistrar,
  createToolsPortRegistrar,
  type DirectToolHost,
} from "../src/index.ts";
import { testThreadId } from "./support/approvals.ts";
import { buildWorld, startWorld } from "./support/world.ts";

const signal = new AbortController().signal;

async function oneTool() {
  const world = buildWorld({
    servers: {
      stub: {
        stub: { era: "modern", tools: [{ name: "peek", annotations: { readOnlyHint: true } }] },
        def: { trustAnnotations: true },
      },
    },
  });
  await startWorld(world);
  await world.runtime.applyBoundary();
  const tool = world.registrar.registered[0];
  if (tool === undefined) throw new Error("tool missing");
  return { world, tool };
}

describe("tool registrars", () => {
  test("ToolService registration carries order key, hints and the MCP server", async () => {
    const { world, tool } = await oneTool();
    const registrations: ToolRegistration[] = [];
    let unregistered = 0;
    const host: DirectToolHost = {
      register: (registration) => {
        registrations.push(registration);
        return ok(() => {
          unregistered += 1;
        });
      },
    };
    const result = createToolServiceRegistrar(host).register(tool);
    expect(result.ok).toBe(true);
    const registration = registrations[0];
    expect(registration?.kind).toBe("direct");
    if (registration?.kind !== "direct") return;
    expect(registration.orderKey).toBe("mcp.stub");
    expect(registration.hints).toEqual({
      readOnly: true,
      destructive: true,
      idempotent: false,
      openWorld: true,
    });
    expect(registration.policy).toEqual({ mcpServer: "stub" });
    expect(registration.tool.replay).toBe("never");
    expect(registration.tool.executionMode).toBe("parallel");
    const executed = await registration.tool.execute("call-1", {}, signal, () => undefined);
    expect(executed.content[0]?.type).toBe("text");
    if (result.ok) result.value();
    expect(unregistered).toBe(1);
    await world.runtime.shutdown();
  });

  test("a name conflict is reported as a value", async () => {
    const { world, tool } = await oneTool();
    const host = { register: () => err({ kind: "name_conflict" as const, toolName: "peek" }) };
    expect(createToolServiceRegistrar(host).register(tool)).toEqual({
      ok: false,
      error: { kind: "name_conflict", toolName: "peek" },
    });
    await world.runtime.shutdown();
  });

  test("ToolsPort registration wraps the tool as a resource definition", async () => {
    const { world, tool } = await oneTool();
    const defs: ToolResourceDef[] = [];
    const port: ToolsPort = {
      register(_owner, def) {
        defs.push(def);
        return ok(() => undefined);
      },
    };
    expect(createToolsPortRegistrar(port, "cap-mcp").register(tool).ok).toBe(true);
    const def = defs[0];
    expect(def).toMatchObject({ name: "peek", replay: "unsafe" });
    const executed = await def?.execute({}, { threadId: testThreadId(), signal });
    expect(executed).toMatchObject({ status: "complete" });
    await world.runtime.shutdown();
  });
});
