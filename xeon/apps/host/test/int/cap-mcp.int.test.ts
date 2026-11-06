import { expect, test } from "bun:test";
import { createStubServer } from "@fresnel/cap-mcp/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import {
  callingModelsAfterTool,
  serveMcpStub,
  warmUntilAdvertised,
} from "../fixtures/mcp-settle.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

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
    const served = serveMcpStub(stub);
    const home = useEngineHome();
    writeUserSettings(home, {
      ...TAPE_SETTINGS,
      "l2.mcp.servers": {
        fixture: { transport: { type: "http", url: served.url } },
      },
      // 서버 도구는 기본이 승인을 묻는다. 이 시험은 호출 경로를 본다
      "l2.mcp.approvalMode": "auto",
    });
    const gated = callingModelsAfterTool("mcp", "echo_marker", [{ name: "echo_marker", args: {} }]);
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: gated.buildModels,
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", {});
    const turnDone = async (input: string): Promise<void> => {
      const started = await startTurnWhenIdle(connection, { threadId: created.threadId, input });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
      );
    };
    // 서버가 tools/list 응답을 낸 뒤, 모델이 받은 요청에 도구가 보일 때까지 turn을 돌리고 도구를 부른다(mcp-settle.ts)
    await warmUntilAdvertised(gated, served.listed, () => turnDone("warm up"));
    await turnDone("call it");
    expect(toolResultTexts(collector.events).join("\n")).toContain("marker-from-mcp");
    await connection.close();
    await host.close();
    await served.stop();
    home.dispose();
  },
  30_000,
);
