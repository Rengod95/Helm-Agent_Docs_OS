import { expect, test } from "bun:test";
import { createStubServer } from "@xeon/cap-mcp/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { callingModels } from "../fixtures/call-tape.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle, until } from "../fixtures/wire-client.ts";

// HOST.6 cap-mcp (int): 설정에 적은 HTTP MCP 서버에 연결하고(루프백 스텁 서버), 서버가 광고한 도구가 도구 표에 올라
// 모델이 부를 수 있다. stdio 서버는 cap-mcp-stdio.int.test.ts다. 서버 도구는 연결된 다음 turn 시작(단계 경계)에 오른다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "a configured HTTP server connects and its tool is callable in the next turn",
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
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => stub.http(request),
    });
    const home = useEngineHome();
    writeUserSettings(home, {
      ...TAPE_SETTINGS,
      "l2.mcp.servers": {
        fixture: {
          transport: { type: "http", url: `http://127.0.0.1:${String(server.port)}/mcp` },
        },
      },
      // 서버 도구는 기본이 승인을 묻는다. 이 시험은 호출 경로를 본다
      "l2.mcp.approvalMode": "auto",
    });
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: callingModels("mcp", [{ name: "echo_marker", args: {} }], "done.", [
        "warmed up.",
      ]),
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", {});
    // 연결은 세션 시작을 막지 않는다. 서버가 도구 목록을 내준 뒤 한 turn을 돌리면, 연결이 끝난 서버의 도구가 다음 turn 시작(단계 경계)에 오른다
    expect(
      await until(() => stub.requests.some((request) => request.method === "tools/list"), 10_000),
    ).toBe(true);
    await connection.request("turn.start", { threadId: created.threadId, input: "warm up" });
    await collector.waitFor((event) => event.kind === "turn.completed");
    const second = await startTurnWhenIdle(connection, {
      threadId: created.threadId,
      input: "call it",
    });
    await collector.waitFor(
      (event) => event.kind === "turn.completed" && event.turnId === second.turnId,
    );
    expect(toolResultTexts(collector.events).join("\n")).toContain("marker-from-mcp");
    await connection.close();
    await host.close();
    await server.stop(true);
    home.dispose();
  },
  30_000,
);
