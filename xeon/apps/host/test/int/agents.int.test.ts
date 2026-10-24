import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { CHILD_REPORT, delegatingModels, EXPLORER } from "../fixtures/agent-tape.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HOST.6 core-agents (int): agent 도구가 자식 thread를 만들고 호스트가 그 thread를 ExtHost로 열어 자식 turn이 끝까지 돈다.
// 실제 엔진과 모델 테이프. 자식 thread의 쓰기 소유는 부모와 같은 holder다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "a delegated task runs in a child thread, the report comes back, and the parent finishes",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: delegatingModels("agents"),
      agentDefinitions: [EXPLORER],
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", {});
    await connection.request("turn.start", { threadId: created.threadId, input: "delegate it" });
    const asked = await collector
      .waitFor((event) => event.kind === "approval.requested" || event.kind === "turn.completed")
      .then((event) => event);
    if (asked.kind === "approval.requested") {
      await connection.request("approval.respond", { approvalId: asked.id, decision: "allow" });
    }
    const done = await collector.waitFor(
      (event) => event.kind === "turn.completed" && event.threadId === created.threadId,
    );
    expect(done.payload).toMatchObject({ status: "completed" });
    const spawned = collector.events.find((event) => event.kind === "agent.spawned");
    expect(spawned).toBeDefined();
    const settled = collector.events.find((event) => event.kind === "agent.settled");
    expect(settled?.payload).toMatchObject({ status: "completed" });
    expect(JSON.stringify(settled?.payload)).toContain(CHILD_REPORT);
    // 자식 thread의 turn도 같은 저장소에 기록됐다
    const listed = await connection.request("thread.list", {});
    expect(listed.threads.length).toBe(2);
    await connection.close();
    await host.close();
    home.dispose();
  },
  30_000,
);
