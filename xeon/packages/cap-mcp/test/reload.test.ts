import { describe, expect, test } from "bun:test";
import type { ScopeStack } from "@xeon/contracts/settings";
import { layer } from "./support/layers.ts";
import { buildWorld, fakeFiles, fakeTrust, startWorld } from "./support/world.ts";

// L2.mcp.spec §4.2·§4.9: 정의 지문이 바뀔 때만 서버를 맞춘다. 설정 변경(nextTurn)과 프로젝트 전환을 따라간다.

const STDIO = { transport: { type: "stdio", command: "stub-server" } };
const TOOLS = [{ name: "t" }];
const stub = { stub: { era: "modern", tools: TOOLS } } as const;

describe("reload", () => {
  test("a changed servers setting connects the new server once, and an unchanged one touches nothing", async () => {
    const world = buildWorld({
      servers: { a: stub, b: stub },
      user: { servers: { a: STDIO } },
    });
    await startWorld(world);
    expect(world.factory.opens).toEqual(["a"]);
    expect(await world.runtime.reload(world.controller.signal)).toBe(false);

    world.settings.set([layer("user", { "l2.mcp.servers": { a: STDIO, b: STDIO } })]);
    expect(await world.runtime.reload(world.controller.signal)).toBe(true);
    await world.runtime.settled();
    expect(world.factory.opens).toEqual(["a", "b"]);
    const listed = await world.runtime.service.client.listServers({});
    expect(listed.servers.map((server) => server.server)).toEqual(["a", "b"]);

    expect(await world.runtime.reload(world.controller.signal)).toBe(false);
    expect(world.factory.opens).toEqual(["a", "b"]);
    await world.runtime.shutdown();
  });

  test("removing a server closes it and the tool leaves at the next boundary", async () => {
    const world = buildWorld({
      servers: { a: stub },
      user: { servers: { a: STDIO } },
    });
    await startWorld(world);
    await world.runtime.applyBoundary();
    expect(world.registrar.names()).toEqual(["t"]);
    world.settings.set([layer("user", { "l2.mcp.servers": {} })]);
    expect(await world.runtime.reload(world.controller.signal)).toBe(true);
    await world.runtime.settled();
    await world.runtime.applyBoundary();
    expect(world.registrar.names()).toEqual([]);
    await world.runtime.shutdown();
  });

  test("a trust decision made later is picked up by the next reload", async () => {
    const files = fakeFiles({
      "/proj/.mcp.json": JSON.stringify({ mcpServers: { proj: { command: "proj-server" } } }),
    });
    let trusted = false;
    const world = buildWorld({
      servers: { proj: stub },
      user: { servers: {} },
      overrides: {
        projectRoot: "/proj",
        files,
        trust: { isTrusted: () => Promise.resolve(trusted) },
      },
    });
    await startWorld(world);
    expect(world.factory.opens).toEqual([]);
    trusted = true;
    expect(await world.runtime.reload(world.controller.signal)).toBe(true);
    await world.runtime.settled();
    expect(world.factory.opens).toEqual(["proj"]);
    await world.runtime.shutdown();
  });

  test("concurrent reloads are serialized: only the first applies the change", async () => {
    const world = buildWorld({
      servers: { a: stub, b: stub },
      user: { servers: { a: STDIO } },
    });
    await startWorld(world);
    world.settings.set([layer("user", { "l2.mcp.servers": { a: STDIO, b: STDIO } })]);
    const results = await Promise.all([
      world.runtime.reload(world.controller.signal),
      world.runtime.reload(world.controller.signal),
    ]);
    expect(results).toEqual([true, false]);
    await world.runtime.shutdown();
  });
});

const mcpFiles = (): ReturnType<typeof fakeFiles> =>
  fakeFiles({
    "/proj-a/.mcp.json": JSON.stringify({ mcpServers: { alpha: { command: "alpha-server" } } }),
    "/proj-b/.mcp.json": JSON.stringify({ mcpServers: { beta: { command: "beta-server" } } }),
    "/engine-cwd/.mcp.json": JSON.stringify({ mcpServers: { home: { command: "home-server" } } }),
  });

// G2-02: 프로젝트 자원의 기준 폴더는 대화의 작업 폴더다. 엔진 cwd(deps.projectRoot)는 대화를 지정하지 않는 읽기에만 쓴다.
describe("the thread workspace is the project root", () => {
  const workspaces: Readonly<Record<string, string>> = { "thr-a": "/proj-a", "thr-b": "/proj-b" };
  const servers = { alpha: stub, beta: stub, home: stub };

  function worldWith(files = mcpFiles()) {
    return buildWorld({
      servers,
      user: { servers: {} },
      overrides: {
        projectRoot: "/engine-cwd",
        workspaceOf: (threadId) => workspaces[threadId],
        files,
        trust: fakeTrust(true),
      },
    });
  }

  async function listed(world: ReturnType<typeof worldWith>): Promise<string[]> {
    const all = await world.runtime.service.client.listServers({});
    return all.servers.map((server) => server.server);
  }

  test("a reload for a thread reads the .mcp.json of that thread's workspace, not the engine cwd", async () => {
    const world = worldWith();
    // 엔진을 열 때는 대화가 없으므로 기본 루트를 읽는다
    await startWorld(world);
    expect(await listed(world)).toEqual(["home"]);

    expect(await world.runtime.reload(world.controller.signal, { threadId: "thr-a" })).toBe(true);
    await world.runtime.settled();
    expect(await listed(world)).toEqual(["alpha"]);

    expect(await world.runtime.reload(world.controller.signal, { threadId: "thr-b" })).toBe(true);
    await world.runtime.settled();
    expect(await listed(world)).toEqual(["beta"]);
    expect(world.factory.opens).toEqual(["home", "alpha", "beta"]);
    await world.runtime.shutdown();
  });

  test("a thread without a workspace gets no project servers and the engine cwd is not a stand-in", async () => {
    const files = mcpFiles();
    const world = worldWith(files);
    await startWorld(world);
    expect(await world.runtime.reload(world.controller.signal, { threadId: "thr-none" })).toBe(
      true,
    );
    await world.runtime.settled();
    expect(await listed(world)).toEqual([]);
    // 기본 루트는 엔진을 열 때 한 번만 읽었다. 이 대화의 읽기는 어느 .mcp.json도 읽지 않았다
    expect(files.reads.filter((path) => path === "/engine-cwd/.mcp.json")).toHaveLength(1);
    await world.runtime.shutdown();
  });

  test("trust is asked for the workspace of the thread", async () => {
    const asked: string[] = [];
    const world = buildWorld({
      servers,
      user: { servers: {} },
      overrides: {
        projectRoot: "/engine-cwd",
        workspaceOf: (threadId) => workspaces[threadId],
        files: mcpFiles(),
        trust: {
          isTrusted: (root) => {
            asked.push(root);
            return Promise.resolve(root === "/proj-b");
          },
        },
      },
    });
    await startWorld(world);
    asked.length = 0;
    await world.runtime.reload(world.controller.signal, { threadId: "thr-a" });
    await world.runtime.reload(world.controller.signal, { threadId: "thr-b" });
    await world.runtime.settled();
    expect(asked).toEqual(["/proj-a", "/proj-b"]);
    expect(await listed(world)).toEqual(["beta"]);
    await world.runtime.shutdown();
  });

  test("settings are read with the layers of the thread, so a project layer server shows up for that thread only", async () => {
    let base: ScopeStack = [];
    const source = {
      layers: (threadId: string | undefined): ScopeStack =>
        threadId === "thr-a"
          ? [...base, layer("project", { "l2.mcp.servers": { alpha: STDIO } })]
          : base,
    };
    const world = buildWorld({
      servers: { alpha: stub },
      user: { servers: {} },
      overrides: { settings: source },
    });
    base = world.settings.layers(undefined);
    await startWorld(world);
    expect(await listed(world)).toEqual([]);
    expect(await world.runtime.reload(world.controller.signal, { threadId: "thr-a" })).toBe(true);
    await world.runtime.settled();
    expect(await listed(world)).toEqual(["alpha"]);
    await world.runtime.shutdown();
  });
});
