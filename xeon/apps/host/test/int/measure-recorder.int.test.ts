import { join } from "node:path";
import { expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import { openMeasureStore } from "../../src/assembly/measure/store.ts";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// T-MEAS-STORE (int): 실제 엔진에서 Turn이 끝나면 측정 저장소(`measure.db`)에 `turn` 한 줄이 쓰이고, `x.operations.trace.enabled`가 꺼져 있으면 쓰이지 않는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

/** 한 Turn을 돌리고 엔진을 닫은 뒤, 측정 DB에서 그 thread의 `turn` 행을 읽는다 */
async function oneTurn(settings: Readonly<Record<string, unknown>>) {
  const home = useEngineHome();
  writeUserSettings(home, { ...TAPE_SETTINGS, ...settings });
  const models = recordingModels("measure", [{ text: "답", inputTokens: 1234 }], {
    contextWindow: 100_000,
  });
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: models.buildModels,
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  const collector = collectEvents(connection);
  await connection.request("events.subscribe", { from: "head" });
  try {
    const created = await connection.request("thread.create", {});
    const started = await startTurnWhenIdle(connection, {
      threadId: created.threadId,
      input: "hello",
    });
    await collector.waitFor(
      (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
      20_000,
    );
    await host.close();
    const opened = openMeasureStore(join(home.dataDir, "measure.db"));
    if (!opened.ok) throw new Bug("the measure database must exist after a turn");
    const rows = opened.value.turn(created.threadId, started.turnId);
    opened.value.close();
    if (!rows.ok) throw new Bug("the measure database must be readable");
    return rows.value;
  } finally {
    home.dispose();
  }
}

realTest("a finished turn leaves one turn row with its token usage and status", async () => {
  const rows = await oneTurn({});
  expect(rows).toHaveLength(1);
  expect(rows[0]?.kind).toBe("turn");
  expect(rows[0]?.tags).toEqual({ status: "completed" });
  expect(rows[0]?.metrics["input"]).toBe(1234);
  expect(rows[0]?.metrics["steps"]).toBe(1);
});

realTest("with x.operations.trace.enabled off no turn row is written", async () => {
  expect(await oneTurn({ "x.operations.trace.enabled": false })).toEqual([]);
});
