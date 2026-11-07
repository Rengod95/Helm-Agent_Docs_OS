import { expect, test } from "bun:test";
import type { McpToolInfo, McpServerStatus } from "@fresnel/contracts/capabilities";
import type { ScopeStack } from "@fresnel/contracts/settings";
import type { WireMethodName } from "@fresnel/contracts/wire";
import {
  createExtReadPort,
  type ExtReadSources,
  type McpClientPort,
} from "../../src/assembly/m4/ext-read-port.ts";
import { createExtReadHandlers } from "../../src/handlers/m4/ext-read.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { recordingEnv, type RecordingEnv } from "../fixtures/hook-order-env.ts";
import { createRecordedSources } from "../fixtures/ext-read-sources.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// W-15 `mcp.servers`·`mcp.serverAction`(확장 읽기 묶음). 원천은 `mcp.client` 대역과 설정 층 대역이다.
// 설정 쓰기는 `recordingEnv`가 기록하고, 층 대역은 그 저장값을 다시 읽게 해서 쓴 뒤의 행을 시험한다.

const SERVERS = {
  fixture: {
    transport: {
      type: "stdio",
      command: "npx",
      args: ["-y", "fixture-server"],
      env: { TOKEN: "secret://token" },
    },
    enabled: true,
  },
};

const NAMES: readonly WireMethodName[] = ["mcp.servers", "mcp.serverAction"];

function statusOf(server: string, extra: Partial<McpServerStatus>): McpServerStatus {
  return {
    server,
    source: "settings:user",
    state: "connected",
    transport: "stdio",
    toolCount: 0,
    promptCount: 0,
    ...extra,
  };
}

const STATUSES: readonly McpServerStatus[] = [
  statusOf("remote", {
    source: "mcpjson:project",
    state: "blocked",
    blockedReason: "approval_required",
    lastError: { code: "approval_required", message: "waiting for approval", at: 1762473600000 },
    stderrTail: ["starting"],
  }),
  statusOf("fixture", {
    toolCount: 1,
    hiddenTools: [{ name: "dup", reason: "name_conflict" }],
  }),
  statusOf("alpha", { source: "ext:team" }),
  statusOf("zeta", { source: "weird:src", state: "disabled" }),
];

const TOOLS: Readonly<Record<string, readonly McpToolInfo[]>> = {
  fixture: [
    {
      server: "fixture",
      name: "echo",
      machineName: "mcp__fixture__echo",
      inputSchema: {},
      annotations: { readOnlyHint: true },
      exposed: true,
    },
    {
      server: "fixture",
      name: "dup",
      machineName: null,
      inputSchema: {},
      exposed: false,
      hiddenReason: "name_conflict",
    },
  ],
};

interface FakeClient extends McpClientPort {
  readonly reconnects: string[];
  readonly listedTools: string[];
}

/** `mcp.client`의 세 메서드 대역. 재연결은 기록만 하고 같은 상태를 돌려준다 */
function fakeClient(statuses: readonly McpServerStatus[]): FakeClient {
  const reconnects: string[] = [];
  const listedTools: string[] = [];
  return {
    reconnects,
    listedTools,
    listServers: () => Promise.resolve({ servers: [...statuses] }),
    listTools: ({ server }) => {
      listedTools.push(server);
      return Promise.resolve({ tools: [...(TOOLS[server] ?? [])] });
    },
    reconnect: ({ server }) => {
      reconnects.push(server);
      const status = statuses.find((entry) => entry.server === server);
      if (status === undefined) return Promise.reject(new Error("unknown"));
      return Promise.resolve(status);
    },
  };
}

/** 사용자 범위 층: 서버 정의는 고정이고, 차단 목록은 기록된 쓰기 값을 따른다 */
function userLayers(env: RecordingEnv, denied: readonly string[]): ScopeStack {
  return [
    {
      scope: "user",
      values: new Map<string, unknown>([
        ["l2.mcp.servers", SERVERS],
        ["l2.mcp.deniedServers", [...denied]],
        ...env.values.entries(),
      ]),
    },
  ];
}

function connect(sources: ExtReadSources, env: RecordingEnv) {
  const port = createExtReadPort({ traceRead: EMPTY_TRACE, env: env.env }, sources);
  const host = createFakeHost({
    override: (table) => ({ ...table, ...createExtReadHandlers(port) }),
  });
  return host.connect().connection;
}

const EMPTY_TRACE = {
  enabled: () => false,
  turn: () => undefined,
  timings: () => ({ traceEnabled: false, timings: [] }),
};

async function failureOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function sourcesWith(client: FakeClient | undefined, env: RecordingEnv, denied: readonly string[]) {
  return createRecordedSources({
    mcpClient: () => client,
    settings: { catalog: new Map(), layers: () => userLayers(env, denied) },
  }).sources;
}

test("host.hello lists mcp.servers and mcp.serverAction as implemented", async () => {
  const env = recordingEnv();
  const connection = connect(sourcesWith(undefined, env, []), env);
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const featured = new Set(hello.features.map((feature) => feature.name));
  expect(NAMES.map((name) => [name, featured.has(name)])).toEqual(
    NAMES.map((name) => [name, true]),
  );
  await connection.close();
});

test("mcp.servers: rows sorted by id, origin by source prefix, tools only for connected servers, definition only for user settings", async () => {
  const env = recordingEnv();
  const client = fakeClient(STATUSES);
  const connection = connect(sourcesWith(client, env, []), env);
  await connection.request("host.hello", HELLO_PARAMS);
  const listed = await connection.request("mcp.servers", {});
  expect(listed.servers).toEqual([
    {
      server: "alpha",
      source: "ext:team",
      origin: "extension",
      state: "connected",
      transport: "stdio",
      toolCount: 0,
      tools: [],
      alwaysBlocked: false,
      editable: false,
    },
    {
      server: "fixture",
      source: "settings:user",
      origin: "settings",
      state: "connected",
      transport: "stdio",
      toolCount: 1,
      hiddenTools: [{ name: "dup", reason: "name_conflict" }],
      tools: [
        { name: "echo", exposed: true, declared: { readOnlyHint: true } },
        { name: "dup", exposed: false, hiddenReason: "name_conflict" },
      ],
      alwaysBlocked: false,
      editable: true,
      definition: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "fixture-server"],
        env: { TOKEN: "secret://token" },
        enabled: true,
      },
    },
    {
      server: "remote",
      source: "mcpjson:project",
      origin: "mcpjson",
      state: "blocked",
      blockedReason: "approval_required",
      transport: "stdio",
      toolCount: 0,
      lastError: { code: "approval_required", message: "waiting for approval", at: 1762473600000 },
      stderrTail: ["starting"],
      tools: [],
      alwaysBlocked: false,
      editable: false,
    },
    {
      server: "zeta",
      source: "weird:src",
      origin: "extension",
      state: "disabled",
      transport: "stdio",
      toolCount: 0,
      tools: [],
      alwaysBlocked: false,
      editable: false,
    },
  ]);
  // 연결된 서버(fixture, alpha)만 도구 목록을 읽는다. 연결되지 않은 remote와 zeta는 읽지 않는다
  expect(client.listedTools).toEqual(["fixture", "alpha"]);
  await connection.close();
});

test("mcp.servers: alwaysBlocked reads the denied list of every scope, threadId only checks the thread", async () => {
  const env = recordingEnv();
  const connection = connect(sourcesWith(fakeClient(STATUSES), env, ["remote", "id:zeta"]), env);
  await connection.request("host.hello", HELLO_PARAMS);
  const listed = await connection.request("mcp.servers", {});
  expect(listed.servers.map((row) => [row.server, row.alwaysBlocked])).toEqual([
    ["alpha", false],
    ["fixture", false],
    ["remote", true],
    ["zeta", true],
  ]);
  const missing = await failureOf(connection.request("mcp.servers", { threadId: "thr_missing" }));
  expect(missing).toMatchObject({ code: 3001, data: { details: { threadId: "thr_missing" } } });
  await connection.close();
});

test("mcp.servers answers an empty list when the MCP client is not running", async () => {
  const env = recordingEnv();
  const connection = connect(sourcesWith(undefined, env, []), env);
  await connection.request("host.hello", HELLO_PARAMS);
  expect(await connection.request("mcp.servers", {})).toEqual({ servers: [] });
  await connection.close();
});

test("mcp.serverAction blockAlways and unblock write the user denied list once and answer the row", async () => {
  const env = recordingEnv();
  env.values.set("l2.mcp.deniedServers", ["remote"]);
  const client = fakeClient(STATUSES);
  const connection = connect(sourcesWith(client, env, ["remote"]), env);
  await connection.request("host.hello", HELLO_PARAMS);

  const blocked = await connection.request("mcp.serverAction", {
    server: "fixture",
    action: "blockAlways",
  });
  expect(blocked).toMatchObject({ server: "fixture", alwaysBlocked: true });
  expect(env.calls).toEqual([
    {
      op: "write",
      scope: "user",
      key: "l2.mcp.deniedServers",
      value: ["remote", "fixture"],
      threadId: undefined,
    },
  ]);

  // 이미 든 서버를 다시 막아도 쓰지 않는다
  await connection.request("mcp.serverAction", { server: "remote", action: "blockAlways" });
  expect(env.calls).toHaveLength(1);

  const unblocked = await connection.request("mcp.serverAction", {
    server: "fixture",
    action: "unblock",
  });
  expect(unblocked).toMatchObject({ server: "fixture", alwaysBlocked: false });
  expect(env.calls.at(-1)).toEqual({
    op: "write",
    scope: "user",
    key: "l2.mcp.deniedServers",
    value: ["remote"],
    threadId: undefined,
  });

  // 목록이 비면 설정을 지운다(기본값)
  await connection.request("mcp.serverAction", { server: "remote", action: "unblock" });
  expect(env.calls.at(-1)).toEqual({
    op: "reset",
    scope: "user",
    key: "l2.mcp.deniedServers",
    value: undefined,
    threadId: undefined,
  });
  await connection.close();
});

test("mcp.serverAction restart reconnects the server and answers its row", async () => {
  const env = recordingEnv();
  const client = fakeClient(STATUSES);
  const connection = connect(sourcesWith(client, env, []), env);
  await connection.request("host.hello", HELLO_PARAMS);
  const row = await connection.request("mcp.serverAction", { server: "remote", action: "restart" });
  expect(client.reconnects).toEqual(["remote"]);
  expect(env.calls).toEqual([]);
  expect(row).toMatchObject({
    server: "remote",
    state: "blocked",
    blockedReason: "approval_required",
  });
  await connection.close();
});

test("mcp.serverAction refuses an unknown server with mcp.serverNotFound and writes nothing", async () => {
  const env = recordingEnv();
  const connection = connect(sourcesWith(fakeClient(STATUSES), env, []), env);
  await connection.request("host.hello", HELLO_PARAMS);
  const unknown = await failureOf(
    connection.request("mcp.serverAction", { server: "ghost", action: "blockAlways" }),
  );
  expect(unknown).toMatchObject({
    code: 3406,
    data: { kind: "mcp.serverNotFound", details: { server: "ghost" } },
  });
  expect(env.calls).toEqual([]);
  await connection.close();
});
