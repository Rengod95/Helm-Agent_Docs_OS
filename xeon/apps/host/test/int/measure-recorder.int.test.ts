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

/** 마지막 `oneTurn`이 wire(`measure.turn`)로 읽은 결과 */
let lastWire:
  | { readonly enabled: boolean; readonly rows: readonly { readonly kind: string }[] }
  | undefined;

/** 한 Turn을 돌리고 엔진을 닫은 뒤, 측정 DB에서 그 thread의 `turn` 행을 읽는다 */
async function oneTurn(settings: Readonly<Record<string, unknown>>) {
  let wire:
    | { readonly enabled: boolean; readonly rows: readonly { readonly kind: string }[] }
    | undefined;
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
    wire = await connection.request("measure.turn", {
      threadId: created.threadId,
      turnId: started.turnId,
    });
    await host.close();
    const opened = openMeasureStore(join(home.dataDir, "measure.db"));
    if (!opened.ok) throw new Bug("the measure database must exist after a turn");
    const rows = opened.value.turn(created.threadId, started.turnId);
    opened.value.close();
    if (!rows.ok) throw new Bug("the measure database must be readable");
    lastWire = wire;
    return rows.value;
  } finally {
    home.dispose();
  }
}

realTest("a finished turn leaves one turn row with its token usage and status", async () => {
  const rows = (await oneTurn({})).filter((row) => row.kind === "turn");
  expect(rows).toHaveLength(1);
  expect(rows[0]?.tags).toEqual({ status: "completed" });
  expect(rows[0]?.metrics["input"]).toBe(1234);
  expect(rows[0]?.metrics["steps"]).toBe(1);
});

realTest(
  "the same turn also leaves its model call, request composition and handler rows",
  async () => {
    const rows = await oneTurn({});
    const calls = rows.filter((row) => row.kind === "call");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tags["role"]).toBe("main");
    expect(calls[0]?.metrics["input"]).toBe(1234);
    expect(typeof calls[0]?.metrics["durationMs"]).toBe("number");
    const contexts = rows.filter((row) => row.kind === "ctx");
    expect(contexts).toHaveLength(1);
    const parts = contexts[0]?.metrics ?? {};
    const sections = Object.entries(parts)
      .filter(([name]) => name.startsWith("section."))
      .reduce((sum, [, tokens]) => sum + tokens, 0);
    expect(
      (parts["system"] ?? 0) +
        sections +
        (parts["injected"] ?? 0) +
        (parts["volatile"] ?? 0) +
        (parts["history"] ?? 0),
    ).toBe(parts["total"] ?? -1);
    // 요청 본문은 어떤 행에도 없다
    for (const row of rows) expect(JSON.stringify(row)).not.toContain("hello");
  },
);

realTest("with x.operations.trace.enabled off no turn row is written", async () => {
  expect(await oneTurn({ "x.operations.trace.enabled": false })).toEqual([]);
});

realTest(
  "measure.turn over the wire returns the same kinds the store holds, and is off-aware",
  async () => {
    const rows = await oneTurn({});
    expect(lastWire?.enabled).toBe(true);
    expect(lastWire?.rows.map((row) => row.kind)).toEqual(rows.map((row) => row.kind));
    await oneTurn({ "x.operations.trace.enabled": false });
    expect(lastWire).toEqual({ enabled: false, rows: [] });
  },
);

realTest("with storeRequestBody on the final request body of the call is stored", async () => {
  const rows = await oneTurn({ "x.operations.trace.storeRequestBody": true });
  const bodies = rows.filter((row) => row.kind === "body");
  expect(bodies).toHaveLength(1);
  expect(bodies[0]?.metrics["step"]).toBe(1);
  expect(bodies[0]?.tags["body"]).toContain("hello");
});
