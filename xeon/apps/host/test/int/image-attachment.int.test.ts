import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startTurnWhenIdle } from "../fixtures/wire-client.ts";

// scB-S6 (int): 이미지 첨부 턴이 모델 요청에 자리표시(`blob:sha256:`)가 아니라 올린 바이트 그대로의 base64를 싣고,
// 같은 대화의 다음 턴도 막히지 않는다(L1.context.spec §4.1 이미지 자리표시 풀기, L2.dialog.spec §4.5).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

/** 1x1 PNG */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

realTest(
  "an image attachment reaches the model as the uploaded base64 and the next turn on the same thread still works",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const models = recordingModels("image-attachment", ["본 것 같다", "이어서 답한다"], {
      contextWindow: 200_000,
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
      const added = await connection.request("attachments.add", {
        threadId: created.threadId,
        source: { kind: "data", data: PNG_BASE64, mime: "image/png", name: "dot.png" },
      });
      expect(added.attachment.kind).toBe("image");
      const first = await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: [...added.parts, { type: "text", text: "이 그림은?" }],
      });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === first.turnId,
        20_000,
      );
      const second = await startTurnWhenIdle(connection, {
        threadId: created.threadId,
        input: "다시 한 번",
      });
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === second.turnId,
        20_000,
      );
      const requests = models.requestTexts();
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(request).not.toContain("blob:sha256:");
        expect(request).toContain(PNG_BASE64);
      }
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);
