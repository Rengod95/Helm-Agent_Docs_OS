import { describe, expect, test } from "bun:test";
import type { McpServerDef } from "@fresnel/contracts/capabilities";
import type { ContributedServer } from "../src/servers/loader.ts";
import { buildWorld } from "./support/world.ts";

// M5c §4.5.10: 대화의 켜짐 플러그인이 낸 MCP 서버는 그 대화의 정의에 실린다. 서버 id는 `<플러그인>-<이름>`[제안]이다.
// 설정이 먼저 id를 쥐고, 프로필에서 플러그인이 빠지면 그 대화의 다음 읽기에서 사라진다.

const STUB = { stub: { era: "modern", tools: [{ name: "lookup" }] } } as const;
/** 검토본 `mcp.json`의 항목 모양 */
const DOCS_ENTRY = { command: "docs-server", args: ["--stdio"] };
/** 같은 항목을 바꾼 서버 정의 */
const DOCS_CONFIG: McpServerDef = {
  transport: { type: "stdio", command: "docs-server", args: ["--stdio"] },
};
const DOCS: ContributedServer = { plugin: "mat-kit", name: "docs", config: DOCS_ENTRY };

/** 대화마다 켜진 플러그인의 서버를 정하는 값. 테스트가 바꾼다 */
function worldWith(contributedOf: Record<string, readonly ContributedServer[]>) {
  return buildWorld({
    // 스텁은 `mat-kit-docs`에 둔다. 설정 항목은 `user`에서 비워 두어 플러그인 서버만 남는다
    servers: { "mat-kit-docs": STUB, "settings-only": STUB },
    user: { servers: {} },
    overrides: {
      contributed: (threadId) => contributedOf[threadId] ?? [],
    },
  });
}

describe("plugin-contributed MCP servers", () => {
  test("an enabled plugin's server is in its thread's definitions with the reviewed definition", async () => {
    const world = worldWith({ "thr-a": [DOCS] });
    const loaded = await world.runtime.load(world.controller.signal, { threadId: "thr-a" });
    expect(loaded.servers).toEqual([
      {
        id: "mat-kit-docs",
        def: DOCS_CONFIG,
        source: "ext:mat-kit",
        managed: false,
        requiresTrust: false,
      },
    ]);
    expect(loaded.diagnostics).toEqual([]);
    await world.runtime.settled();
    const listed = await world.runtime.service.client.listServers({});
    expect(listed.servers.map((row) => [row.server, row.source, row.state])).toEqual([
      ["mat-kit-docs", "ext:mat-kit", "connected"],
    ]);
    await world.runtime.shutdown();
  });

  test("a plugin server leaves the thread's definitions once the plugin is out of its profile", async () => {
    const contributed: Record<string, readonly ContributedServer[]> = { "thr-a": [DOCS] };
    const world = worldWith(contributed);
    await world.runtime.load(world.controller.signal, { threadId: "thr-a" });
    await world.runtime.settled();
    expect(
      (await world.runtime.service.client.listServers({})).servers.map((s) => s.server),
    ).toEqual(["mat-kit-docs"]);

    contributed["thr-a"] = [];
    expect(await world.runtime.reload(world.controller.signal, { threadId: "thr-a" })).toBe(true);
    await world.runtime.settled();
    expect(
      (await world.runtime.service.client.listServers({})).servers.map((s) => s.server),
    ).toEqual([]);
    expect(world.factory.opens).toEqual(["mat-kit-docs"]);
    await world.runtime.shutdown();
  });

  test("the plugin server is offered only to the thread whose profile enables the plugin", async () => {
    const world = worldWith({ "thr-a": [DOCS] });
    // 플러그인을 켜지 않은 대화와 대화 없는 읽기에는 플러그인 서버가 없다
    expect(
      (await world.runtime.load(world.controller.signal, { threadId: "thr-b" })).servers,
    ).toEqual([]);
    expect((await world.runtime.load(world.controller.signal)).servers).toEqual([]);
    expect(world.factory.opens).toEqual([]);
    // 켠 대화는 그 대화의 읽기에서 실린다
    const own = await world.runtime.load(world.controller.signal, { threadId: "thr-a" });
    expect(own.servers.map((server) => server.id)).toEqual(["mat-kit-docs"]);
    await world.runtime.shutdown();
  });

  test("a settings server with the same id wins and the plugin's entry is skipped with a diagnostic", async () => {
    const world = buildWorld({
      servers: { "mat-kit-docs": STUB },
      user: {
        servers: { "mat-kit-docs": { transport: { type: "stdio", command: "settings-server" } } },
      },
      overrides: { contributed: () => [DOCS] },
    });
    const loaded = await world.runtime.load(world.controller.signal, { threadId: "thr-a" });
    expect(loaded.servers.map((server) => [server.id, server.source])).toEqual([
      ["mat-kit-docs", "settings:user"],
    ]);
    expect(loaded.diagnostics).toEqual([
      {
        code: "duplicate_name",
        source: "ext:mat-kit",
        server: "mat-kit-docs",
        message: "id is already defined",
      },
    ]);
    await world.runtime.shutdown();
  });

  test("the plugin server obeys the denied-server policy like any other server", async () => {
    const world = buildWorld({
      servers: { "mat-kit-docs": STUB },
      user: { servers: {}, deniedServers: ["mat-kit-docs"] },
      overrides: { contributed: () => [DOCS] },
    });
    await world.runtime.load(world.controller.signal, { threadId: "thr-a" });
    await world.runtime.settled();
    const listed = await world.runtime.service.client.listServers({});
    expect(listed.servers.map((row) => [row.server, row.state, row.blockedReason])).toEqual([
      ["mat-kit-docs", "blocked", "denied_by_policy"],
    ]);
    expect(world.factory.opens).toEqual([]);
    await world.runtime.shutdown();
  });

  test("a plugin entry that fails the definition checks is skipped with its diagnostic", async () => {
    const world = buildWorld({
      servers: { "mat-kit-docs": STUB },
      user: { servers: {} },
      overrides: {
        contributed: () => [
          { plugin: "mat-kit", name: "broken", config: { type: "stdio" } },
          {
            plugin: "mat-kit",
            name: "leaky",
            config: { command: "leaky-server", env: { API_KEY: "plain-value" } },
          },
          { plugin: "mat-kit", name: "a".repeat(40), config: DOCS_ENTRY },
        ],
      },
    });
    const loaded = await world.runtime.load(world.controller.signal, { threadId: "thr-a" });
    expect(loaded.servers).toEqual([]);
    expect(loaded.diagnostics.map((d) => [d.code, d.server])).toEqual([
      ["invalid_definition", "mat-kit-broken"],
      ["plaintext_secret", "mat-kit-leaky"],
      ["invalid_name", "a".repeat(40)],
    ]);
    await world.runtime.shutdown();
  });
});
