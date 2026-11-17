import { describe, expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
import { callingModels } from "../fixtures/call-tape.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { toolResultTexts } from "../fixtures/tool-results.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HOST.6 cap-work (int): task_write가 작업 목록을 모델에 돌려준다. 실제 투영기 등록부 위의 시험이다(시험 대역 등록부는 표 이름 규칙을 보지 않는다).

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

describe("cap-work", () => {
  realTest(
    "task_write records the list and shows it to the model",
    async () => {
      const home = useEngineHome();
      writeUserSettings(home, TAPE_SETTINGS);
      const host = await startInProcessHost({
        devChecks: true,
        defaultGroups: false,
        buildModels: callingModels("work-tasks", [
          {
            name: "task_write",
            args: {
              ops: [
                { op: "create", ref: "a", content: "write the code" },
                { op: "create", content: "test it", blockedBy: ["a"] },
              ],
            },
          },
        ]),
      });
      const connection = createHostConnection(host.client);
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      const created = await connection.request("thread.create", {});
      await connection.request("turn.start", { threadId: created.threadId, input: "plan work" });
      await collector.waitFor((event) => event.kind === "turn.completed");
      const text = toolResultTexts(collector.events).join("\n");
      expect(text).toContain("write the code");
      expect(text).toContain("test it");
      await connection.close();
      await host.close();
      home.dispose();
    },
    30_000,
  );
});
