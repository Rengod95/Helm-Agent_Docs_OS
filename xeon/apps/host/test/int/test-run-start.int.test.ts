import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// M5c §4.8.1 (int, 실제 엔진): `testRun.start { drafts: [] }`로 만든 Test run 대화의 턴은 기록에서 `scope: "test"`로 남고,
// 대화는 기준 프로필을 참조하며 표지에 묶음 id가 실린다. 프로필 기록은 그대로다.
// 기준은 이 시험이 저장한 `work`(설치된 플러그인만 든다)다. 공장 기본 프로필은 이 시험 집에 없는 `helm`을 들어 검증에서 오류가 난다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "a turn in a testRun.start thread is recorded with scope test and the thread carries the base profile and the run group",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const model = recordingModels("test-run-start", ["답."], { contextWindow: 200_000 });
    const host = await startInProcessHost({
      devChecks: true,
      pluginHost: { disabled: true },
      buildModels: model.buildModels,
    });
    const connection = createHostConnection(host.client);
    const collector = collectEvents(connection);
    try {
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("events.subscribe", { from: "head" });
      await connection.request("profile.put", {
        profile: {
          id: "work",
          title: "Work",
          plugins: [{ name: "cap-workspace" }],
          settings: [],
          startDrive: null,
        },
        baseRev: null,
      });
      const stored = await connection.request("profile.get", { id: "work" });
      const started = await connection.request("testRun.start", {
        baseProfileId: "work",
        drafts: [],
        runGroupId: "grp-int",
      });
      expect(started).toEqual({
        threadId: expect.any(String),
        profileId: "work",
        drafts: [],
        runGroupId: "grp-int",
      });
      expect(await connection.request("profile.get", { id: "work" })).toEqual(stored);
      const turn = await startTurnWhenIdle(connection, {
        threadId: started.threadId,
        input: "hello",
      });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === turn.turnId,
      );
      const read = await connection.request("turnRecord.get", {
        threadId: started.threadId,
        turnId: turn.turnId,
      });
      expect(read.record).toMatchObject({ threadId: started.threadId, scope: "test" });
      const listed = await connection.request("thread.list", {});
      expect(
        listed.threads.map((thread) => [thread.threadId, thread.profileId, thread.testRun]),
      ).toEqual([
        [
          started.threadId,
          "work",
          { profileId: "work", target: null, paused: false, runGroupId: "grp-int" },
        ],
      ]);
    } finally {
      await host.close();
      home.dispose();
    }
  },
);
