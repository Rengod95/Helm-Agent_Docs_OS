import { expect, test } from "bun:test";
import { t, tape, tapeBuildModels, tapePlayer, tapeProvider } from "@fresnel/core-models/testing";
import { smokeOrchestration } from "@fresnel/orchestration-sdk/testing";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/command-run.ts";
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
    // driveTurns 0인 스모크 그룹은 turn을 내지 않고 사용자 메시지를 처리하지 않는다: 첫 메시지를 첫 단계가 받고, 3단계 안에 처리하지 않아 코어 루프가 돌려받은 입력의 turn을 낸다
    const group = smokeOrchestration({ followUps: 0, driveTurns: 0 });
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
      // 대화를 열 때 프로필의 시작 Drive가 주도 시작 요청을 낸다(drive-isolation.md 2.2)
      const name = group.manifest.name;
      await connection.request("profile.put", {
        profile: {
          id: "drive-start",
          title: "Drive start",
          plugins: [{ name }],
          settings: [],
          startDrive: name,
        },
        baseRev: null,
      });
      const created = await connection.request("thread.create", { profileId: "drive-start" });
      // 프로필의 시작 주도는 사용자의 첫 메시지를 첫 단계의 입력으로 받는다(AGE-47): 메시지가 오기 전에는 turn이 없다
      expect(collector.events.filter((event) => event.kind === "turn.started")).toEqual([]);

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
          collector.events.filter((seen) => seen.kind === "turn.completed").length >= 1,
        20_000,
      );
      const items = JSON.stringify(
        collector.events.filter((event) => event.kind === "item.recorded").map((e) => e.payload),
      );
      expect(items).toContain("user answered.");
      // 메시지는 한 번만 전달되어 turn이 하나다(돌려받은 입력의 turn)
      expect(collector.events.filter((event) => event.kind === "turn.started")).toHaveLength(1);
    } finally {
      await host.close();
      home.dispose();
    }
  },
  60_000,
);
