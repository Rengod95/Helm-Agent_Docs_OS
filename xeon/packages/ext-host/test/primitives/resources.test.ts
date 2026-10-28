import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import {
  McpPortKey,
  ModelsPortKey,
  ToolsPortKey,
  type McpPort,
  type ModelsPort,
  type ToolResourceDef,
  type ToolsPort,
} from "@xeon/contracts/extensions";
import { Type } from "typebox";
import {
  hostOf,
  PrimitiveError,
  type ResourcePolicy,
  type ResourceRecord,
} from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeUnit } from "./fixtures/support.ts";

type Host = Awaited<ReturnType<typeof createTestHost>>;

interface Fakes {
  readonly tools: Map<string, ToolResourceDef>;
  readonly providers: Map<string, unknown>;
  readonly servers: Map<string, unknown>;
  readonly log: string[];
}

/** xeon.tools, xeon.models, xeon.mcp 대역을 등록한다 */
async function withPorts(t: Host): Promise<Fakes> {
  const tools = new Map<string, ToolResourceDef>();
  const providers = new Map<string, unknown>();
  const servers = new Map<string, unknown>();
  const log: string[] = [];
  const toolsPort: ToolsPort = {
    register(owner, def) {
      if (tools.has(def.name)) return err({ kind: "name_conflict", toolName: def.name });
      tools.set(def.name, def);
      log.push(`+tool:${def.name}@${owner}`);
      return ok(() => {
        tools.delete(def.name);
        log.push(`-tool:${def.name}`);
      });
    },
  };
  const modelsPort: ModelsPort = {
    registerProvider(_owner, name, config) {
      providers.set(name, config);
      return () => {
        providers.delete(name);
      };
    },
  };
  const mcpPort: McpPort = {
    registerServer(_owner, name, config) {
      servers.set(name, config);
      return () => {
        servers.delete(name);
      };
    },
  };
  await t.host.registerPlatform({
    name: "test-resource-ports",
    setup(ctx) {
      ctx.providePort(ToolsPortKey, toolsPort);
      ctx.providePort(ModelsPortKey, modelsPort);
      ctx.providePort(McpPortKey, mcpPort);
    },
  });
  return { tools, providers, servers, log };
}

function toolDef(name: string): ToolResourceDef {
  return {
    name,
    description: `tool ${name}`,
    parameters: Type.Object({}),
    replay: "safe",
    execute: () => Promise.resolve(`ran ${name}`),
  };
}

function codeOf(run: () => void): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof PrimitiveError ? error.code : "other";
  }
  return undefined;
}

test("resources are registered in the ports and the registry, and released when the scope is off", async () => {
  const t = await createTestHost();
  const fakes = await withPorts(t);
  await t.host.openThread(t.newThread());
  const events: string[] = [];
  t.host.resources.subscribe((change) => {
    events.push(`${change.type}:${change.record.kind}:${change.record.exposed}`);
  });
  await t.host.install(
    makeUnit({ name: "res-all" }, (g) => {
      const host = hostOf(g);
      host.registerTool(toolDef("probe"));
      host.registerCommand("probe", {
        description: "run a probe",
        handler: () => Promise.resolve(),
      });
      host.registerShortcut("ctrl+p", { handler: () => Promise.resolve() });
      host.registerFlag("verbose", { type: "boolean", default: false });
      host.registerProvider("res-model", { api: "x" });
      host.registerMcpServer("res-mcp", { command: "node" });
      host.registerMessageRenderer("x.res-all.note.shown", { module: "./r.ts", export: "render" });
    }),
  );
  expect([...fakes.tools.keys()]).toEqual(["probe"]);
  expect([...fakes.providers.keys()]).toEqual(["res-model"]);
  expect([...fakes.servers.keys()]).toEqual(["res-mcp"]);
  expect(t.host.resources.list().map((record) => `${record.kind}:${record.exposed}`)).toEqual([
    "tool:probe",
    "command:probe",
    "shortcut:ctrl+p",
    "flag:verbose",
    "provider:res-model",
    "mcp_server:res-mcp",
    "message_renderer:x.res-all.note.shown",
  ]);
  expect(t.host.resources.list("command")).toHaveLength(1);
  expect(t.host.resources.list("command")[0]).toMatchObject({
    scopeId: "res-all",
    extension: "res-all",
    builtin: true,
  });
  expect(events).toHaveLength(7);

  t.host.scope("res-all")?.disable();
  await t.settled();
  expect(fakes.tools.size + fakes.providers.size + fakes.servers.size).toBe(0);
  expect(t.host.resources.list()).toEqual([]);
  expect(events.filter((event) => event.startsWith("removed"))).toHaveLength(7);
});

test("flags keep the value L4 sets and fall back to the declared default", async () => {
  const t = await createTestHost();
  const seen: (boolean | string | undefined)[] = [];
  await t.host.install(
    makeUnit({ name: "res-flag", points: ["boundary.settle.after"] }, (g) => {
      const host = hostOf(g);
      host.registerFlag("mode", { type: "string", default: "fast" });
      host.registerFlag("dry", { type: "boolean" });
      g.on("boundary.settle.after", () => {
        seen.push(host.getFlag("mode"), host.getFlag("dry"), host.getFlag("none"));
      });
    }),
  );
  const thread = t.newThread();
  await t.host.openThread(thread);
  const fire = (key: string) =>
    t.host.dispatch(
      "boundary.settle.after",
      { turnId: t.ids.next("trn"), aborted: false },
      { threadId: thread, dispatchKey: key },
    );
  await fire("k1");
  expect(t.host.resources.setFlag("mode", "slow")).toEqual(ok(undefined));
  expect(t.host.resources.setFlag("dry", true)).toEqual(ok(undefined));
  expect(t.host.resources.setFlag("dry", "yes")).toEqual(
    err({ kind: "type_mismatch", name: "dry", expected: "boolean" }),
  );
  expect(t.host.resources.setFlag("nope", true)).toEqual(
    err({ kind: "unknown_flag", name: "nope" }),
  );
  await fire("k2");
  expect(seen).toEqual(["fast", undefined, undefined, "slow", true, undefined]);
});

test("registration errors: conflicts, invalid names, missing ports", async () => {
  const t = await createTestHost();
  const codes: Record<string, string | undefined> = {};
  await t.host.install(
    makeUnit({ name: "res-err-a" }, (g) => {
      const host = hostOf(g);
      codes.noToolsPort = codeOf(() => {
        host.registerTool(toolDef("x"));
      });
      codes.noModelsPort = codeOf(() => {
        host.registerProvider("p", null);
      });
      host.registerCommand("same", { handler: () => Promise.resolve() });
      codes.duplicateInScope = codeOf(() => {
        host.registerCommand("same", { handler: () => Promise.resolve() });
      });
      codes.emptyName = codeOf(() => {
        host.registerCommand("", { handler: () => Promise.resolve() });
      });
      codes.spaced = codeOf(() => {
        host.registerCommand("a b", { handler: () => Promise.resolve() });
      });
      codes.longName = codeOf(() => {
        host.registerFlag("x".repeat(65), { type: "boolean" });
      });
    }),
  );
  await t.host.install(
    makeUnit({ name: "res-err-b", loadIndex: 1 }, (g) => {
      codes.otherScope = codeOf(() => {
        hostOf(g).registerCommand("same", { handler: () => Promise.resolve() });
      });
    }),
  );
  expect(codes).toEqual({
    noToolsPort: "port_unavailable",
    noModelsPort: "port_unavailable",
    duplicateInScope: "resource_conflict",
    emptyName: "resource_name_invalid",
    spaced: "resource_name_invalid",
    longName: "resource_name_invalid",
    otherScope: "resource_conflict",
  });
});

test("a tool name rejected by the tool port is a resource_conflict", async () => {
  const t = await createTestHost();
  const fakes = await withPorts(t);
  fakes.tools.set("taken", toolDef("taken"));
  const codes: (string | undefined)[] = [];
  await t.host.install(
    makeUnit({ name: "res-tool" }, (g) => {
      codes.push(
        codeOf(() => {
          hostOf(g).registerTool(toolDef("taken"));
        }),
      );
      codes.push(
        codeOf(() => {
          hostOf(g).registerTool(toolDef("bad name"));
        }),
      );
    }),
  );
  expect(codes).toEqual(["resource_conflict", "resource_name_invalid"]);
  expect(t.host.resources.list()).toEqual([]);
});

test("a ResourcePolicy decides a clash: rename, replace or reject", async () => {
  const seen: string[] = [];
  const policy = (action: "rename" | "replace" | "reject"): ResourcePolicy => ({
    resolve(incoming: ResourceRecord, existing: ResourceRecord) {
      seen.push(`${incoming.scopeId}>${existing.scopeId}`);
      if (action === "rename") return { action, name: `${incoming.extension}:${incoming.name}` };
      return { action };
    },
  });
  const run = async (action: "rename" | "replace" | "reject") => {
    const t = await createTestHost({ resourcePolicy: policy(action) });
    const results: (string | undefined)[] = [];
    await t.host.install(
      makeUnit({ name: "res-pol-a" }, (g) => {
        hostOf(g).registerCommand("go", { handler: () => Promise.resolve() });
      }),
    );
    await t.host.install(
      makeUnit({ name: "res-pol-b", loadIndex: 1 }, (g) => {
        results.push(
          codeOf(() => {
            hostOf(g).registerCommand("go", { handler: () => Promise.resolve() });
          }),
        );
      }),
    );
    return {
      results,
      names: t.host.resources.list("command").map((r) => `${r.scopeId}=${r.exposed}`),
    };
  };
  expect(await run("rename")).toEqual({
    results: [undefined],
    names: ["res-pol-a=go", "res-pol-b=res-pol-b:go"],
  });
  expect(await run("replace")).toEqual({ results: [undefined], names: ["res-pol-b=go"] });
  expect(await run("reject")).toEqual({
    results: ["resource_conflict"],
    names: ["res-pol-a=go"],
  });
  expect(seen).toEqual(["res-pol-b>res-pol-a", "res-pol-b>res-pol-a", "res-pol-b>res-pol-a"]);
});

test("a throwing registry listener does not stop the others", async () => {
  const t = await createTestHost();
  const seen: string[] = [];
  t.host.resources.subscribe(() => {
    throw new Error("listener failure");
  });
  const off = t.host.resources.subscribe((change) => {
    seen.push(change.record.exposed);
  });
  await t.host.install(
    makeUnit({ name: "res-listen" }, (g) => {
      hostOf(g).registerCommand("one", { handler: () => Promise.resolve() });
    }),
  );
  off();
  t.host.scope("res-listen")?.disable();
  await t.settled();
  expect(seen).toEqual(["one"]);
  expect(t.diagnostics.some((d) => d.message.includes("ResourceRegistry listener"))).toBe(true);
});
