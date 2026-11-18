import { expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// 턴 기록의 훅이 `turnHooks`와 `steps[0].hooks`에 한 번씩만 들어 `flags.modified`가 두 배로 세지 않는지 실제 엔진에서 본다
// (`turn-record-metrics.md` §3.2: 턴 수준 훅은 `turnHooks`에만 든다).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

/** 훅 실행 한 줄 */
function brief(run: { hook: string; plugin: string; result: string }): string {
  return `${run.hook}:${run.plugin}:${run.result}`;
}

realTest(
  "a turn's pre-step hooks are in turnHooks only: steps[0].hooks does not repeat them and flags.modified counts each modifying run once",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, { ...TAPE_SETTINGS });
    const models = recordingModels("turn-hooks", [{ text: "답", inputTokens: 100 }], {
      contextWindow: 100_000,
    });
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: models.buildModels,
    });
    try {
      const connection = createHostConnection(host.client);
      const collector = collectEvents(connection);
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      const created = await connection.request("thread.create", {});
      const started = await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: "hi",
      });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
        20_000,
      );
      const read = await connection.request("turnRecord.get", {
        threadId: created.threadId,
        turnId: started.turnId,
      });
      const record = read.record;
      if (record === null) throw new Bug("a finished turn must have a record");

      expect(record.turnHooks.map(brief)).toEqual([
        "thread.start:cap-artifacts:passed",
        "thread.start:cap-knowledge:passed",
        "thread.start:cap-artifacts:passed",
        "thread.start:cap-knowledge:passed",
        "input.user.before:cap-dialog:passed",
        "input.user.before:cap-web:passed",
        "input.agent.before:cap-dialog:modified",
        "input.agent.before:cap-work:passed",
        "input.agent.before:cap-knowledge:modified",
      ]);
      // 첫 단계 기록은 턴 수준 훅을 되풀이하지 않는다
      expect(record.steps.map((step) => step.hooks.map(brief))).toEqual([[]]);
      // 고친 실행은 둘이다(input.agent.before의 cap-dialog와 cap-knowledge). 두 배로 4가 아니다
      expect(record.flags.modified).toBe(2);
    } finally {
      await host.close();
      home.dispose();
    }
  },
  60_000,
);
