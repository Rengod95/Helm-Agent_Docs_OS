import { expect, test } from "bun:test";
import type { LoopPort } from "@xeon/contracts/extensions";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { EXPLORER } from "../fixtures/agent-tape.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import {
  childModels,
  childReport,
  loopPortProbe,
  SPAWN_CHILD_COUNT,
  spawnGroup,
} from "../fixtures/spawn-group.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// L1.loop.spec §4.8 loop.spawn (int): 실제 엔진에서 drive의 loop.spawn이 core-agents로 이어져 자식이 돌고, 같은 requestId는 효과 한 번이다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "loop.spawn with the same requestId twice runs one child and the second call is a replay",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const captured: { port: LoopPort | undefined } = { port: undefined };
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      // 테이프에는 자식 보고가 하나뿐이다. 둘째 호출이 자식을 또 띄우면 테이프가 바닥나 실패한다
      buildModels: childModels("loop-spawn-replay", 1),
      agentDefinitions: [EXPLORER],
      extraPlugins: [loopPortProbe(captured)],
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", {});
    const port = captured.port;
    if (port === undefined) throw new Error("xeon.loop was not captured");
    const request = {
      threadId: created.threadId,
      scopeId: "probe-scope",
      leaseId: "lease-1",
      leaseEpoch: 1,
      requestId: "probe:child:0",
      spec: { agent: "explorer", task: "look at it" },
      signal: new AbortController().signal,
    };

    const first = await port.spawn(request);
    const second = await port.spawn(request);

    expect(first.replayed).toBe(false);
    expect(first.outcome.status).toBe("completed");
    expect(first.outcome.answer).toContain(childReport(0));
    expect(second.replayed).toBe(true);
    expect(second.outcome).toEqual(first.outcome);
    // 자식 thread는 하나, 부모에 남은 agent.spawned도 하나다
    const spawned = collector.events.filter((event) => event.kind === "agent.spawned");
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.payload).toMatchObject({ childThreadId: first.outcome.childThreadId });
    const listed = await connection.request("thread.list", {});
    expect(listed.threads.length).toBe(2);
    await connection.close();
    await host.close();
    home.dispose();
  },
  30_000,
);

realTest(
  "a group drive spawns N children with loop.spawn and gets each result",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const group = spawnGroup(SPAWN_CHILD_COUNT);
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: childModels("loop-spawn-drive", SPAWN_CHILD_COUNT),
      agentDefinitions: [EXPLORER],
      extraPlugins: [group.module],
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    const created = await connection.request("thread.create", {});
    // 사용자 입력 없이 임대가 부여되고 drive가 자식을 띄운다
    await group.probe.committed;

    expect(group.probe.outcomes.map((outcome) => outcome.status)).toEqual(
      Array.from({ length: SPAWN_CHILD_COUNT }, () => "completed"),
    );
    group.probe.outcomes.forEach((outcome, index) => {
      expect(outcome.answer).toContain(childReport(index));
    });
    const childIds = group.probe.outcomes.map((outcome) => outcome.childThreadId);
    expect(new Set(childIds).size).toBe(SPAWN_CHILD_COUNT);
    expect(collector.events.filter((event) => event.kind === "agent.spawned")).toHaveLength(
      SPAWN_CHILD_COUNT,
    );
    const listed = await connection.request("thread.list", {});
    expect(listed.threads.length).toBe(SPAWN_CHILD_COUNT + 1);
    expect(created.threadId).toBeDefined();
    await connection.close();
    await host.close();
    home.dispose();
  },
  30_000,
);
