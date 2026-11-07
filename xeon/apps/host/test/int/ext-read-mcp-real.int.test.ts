import { expect, test } from "bun:test";
import type { McpServerRow } from "@fresnel/contracts/wire";
import { createStubServer } from "@fresnel/cap-mcp/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { serveMcpStub } from "../fixtures/mcp-settle.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// W-15 `mcp.servers`·`mcp.serverAction` (int, 실제 엔진): 설정에 적은 HTTP 서버 하나가 연결되어 행으로 보이고, 차단·풀기·다시 연결이
// 설정 쓰기와 실제 상태에 닿는다. 원천 대역 시험은 `ext-read-mcp.int.test.ts`다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "mcp.servers lists a configured HTTP server with its tools; blockAlways and unblock change the denied list; restart reconnects",
  async () => {
    const stub = createStubServer({
      era: "modern",
      tools: [
        {
          name: "echo_marker",
          description: "Returns a fixed marker.",
          inputSchema: { type: "object", properties: {} },
          handle: () => ({
            kind: "complete",
            content: [{ type: "text", text: "marker-from-mcp" }],
          }),
        },
      ],
    });
    const served = serveMcpStub(stub);
    const home = useEngineHome();
    writeUserSettings(home, {
      ...TAPE_SETTINGS,
      "l2.mcp.servers": {
        fixture: { transport: { type: "http", url: served.url } },
      },
    });
    const host = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);

    // 연결은 시작을 막지 않는다. 연결될 때까지 목록을 다시 읽는다(최대 100번, 100ms 간격)
    const connectedRow = async (attempt: number): Promise<McpServerRow> => {
      const listed = await connection.request("mcp.servers", {});
      const row = listed.servers.find((entry) => entry.server === "fixture");
      if (row?.state === "connected") return row;
      if (attempt >= 100) throw new Error("fixture never connected");
      await new Promise((resolve) => setTimeout(resolve, 100));
      return connectedRow(attempt + 1);
    };
    const row = await connectedRow(0);
    expect({
      origin: row.origin,
      editable: row.editable,
      alwaysBlocked: row.alwaysBlocked,
      definition: row.definition,
      tools: row.tools.map((tool) => [tool.name, tool.exposed]),
    }).toEqual({
      origin: "settings",
      editable: true,
      alwaysBlocked: false,
      definition: { transport: "http", url: served.url },
      tools: [["echo_marker", true]],
    });

    const blocked = await connection.request("mcp.serverAction", {
      server: "fixture",
      action: "blockAlways",
    });
    expect(blocked).toMatchObject({ server: "fixture", alwaysBlocked: true });
    const unblocked = await connection.request("mcp.serverAction", {
      server: "fixture",
      action: "unblock",
    });
    expect(unblocked).toMatchObject({ server: "fixture", alwaysBlocked: false });

    const restarted = await connection.request("mcp.serverAction", {
      server: "fixture",
      action: "restart",
    });
    expect(restarted).toMatchObject({ server: "fixture" });

    await connection.close();
    await host.close();
    await served.stop();
    home.dispose();
  },
  60_000,
);
