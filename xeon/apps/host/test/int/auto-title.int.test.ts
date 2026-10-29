import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M3-REQ-83 (int, 실제 조립): 테이프 제공자에는 자격 증명 참조가 없어 제목 모델을 쓸 수 없다. 자동 제목은 건너뛰고,
// 첫 입력 제목이 남으며, 턴은 모델 요청을 한 번만 낸다(턴의 답). 제목을 모델로 바꾸는 경로는 `auto-title.test.ts`가 가짜 모델로 본다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "without a credential for the title model the thread keeps its first-input title and the turn makes one model request",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const models = recordingModels("auto-title-skip", ["답변이다."], { contextWindow: 200_000 });
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
      const input = "빌드가 왜 느린지 알려 줘";
      const created = await connection.request("thread.create", {});
      await connection.request("turn.start", { threadId: created.threadId, input });
      await collector.waitFor((event) => event.kind === "turn.completed");
      await Bun.sleep(300);
      const listed = await connection.request("thread.list", {});
      expect(listed.threads.find((row) => row.threadId === created.threadId)?.title).toBe(input);
      expect(models.requestTexts()).toHaveLength(1);
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  30_000,
);
