import { expect, test } from "bun:test";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { smokeGroup } from "@fresnel/group-sdk/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { realTapeClock } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS, startInputWhenIdle } from "../fixtures/wire-client.ts";

// 주도 중인 플러그인이 있을 때의 turn.start (F wire turn.start, X.drive-isolation §2.4): 오류 없이 접수하고(`delivered`),
// 플러그인이 처리하지 않으면 코어 루프로 돌아와 turn이 된다. 같은 requestId의 재제출은 입력을 다시 넘기지 않는다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

realTest(
  "turn.start while a plugin drives is accepted as delivered, handed back to the loop, and a resubmission is not delivered twice",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    // 스모크 그룹은 사용자 메시지를 처리하지 않는다: 첫 turn은 그룹의 drive turn, 둘째 turn은 돌려받은 사용자 입력이다
    const group = smokeGroup({ followUps: 0, driveTurns: 1 });
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      extraPlugins: [{ manifest: group.manifest, extension: group.entry }],
      buildModels: tapeBuildModels(
        tapeProvider(
          tapePlayer(
            tape("turn-start-drive", [
              {
                role: "main",
                label: "the group's drive turn",
                response: {
                  type: "message",
                  content: [t.text("drive answered.")],
                  stopReason: "stop",
                },
              },
              {
                role: "main",
                label: "the handed-back user input",
                response: {
                  type: "message",
                  content: [t.text("user answered.")],
                  stopReason: "stop",
                },
              },
            ]),
            { clock: realTapeClock() },
          ),
        ),
      ),
    });
    try {
      const connection = createHostConnection(host.client);
      await connection.request("host.hello", HELLO_PARAMS);
      const collector = collectEvents(connection);
      await connection.request("events.subscribe", { from: "head" });
      const created = await connection.request("thread.create", {});
      await collector.waitFor((event) => event.kind === "turn.completed", 20_000);

      const first = await startInputWhenIdle(connection, {
        threadId: created.threadId,
        input: "hello there",
        requestId: "req-delivered-1",
      });
      expect(first).toEqual({ delivered: true });
      const again = await startInputWhenIdle(connection, {
        threadId: created.threadId,
        input: "hello there",
        requestId: "req-delivered-1",
      });
      expect(again).toEqual({ delivered: true });

      // 돌려받은 입력의 turn이 시작되어 끝난다
      await collector.waitFor(
        (event) =>
          event.kind === "turn.completed" &&
          collector.events.filter((seen) => seen.kind === "turn.completed").length >= 2,
        20_000,
      );
      const items = JSON.stringify(
        collector.events.filter((event) => event.kind === "item.recorded").map((e) => e.payload),
      );
      expect(items).toContain("user answered.");
      // 메시지는 한 번만 전달되어 turn이 모두 둘이다(drive turn, 돌려받은 입력의 turn)
      expect(collector.events.filter((event) => event.kind === "turn.started")).toHaveLength(2);
    } finally {
      await host.close();
      home.dispose();
    }
  },
  60_000,
);
