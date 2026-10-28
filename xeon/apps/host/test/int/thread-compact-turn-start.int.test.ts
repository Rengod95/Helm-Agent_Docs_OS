import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import {
  collectEvents,
  compactWhenIdle,
  HELLO_PARAMS,
  startTurnWhenIdle,
} from "../fixtures/wire-client.ts";

// HS-77, §10 미결 31 (int): 수동 컴팩션이 요약하는 동안 같은 thread의 turn.start는 컴팩션이 커밋될 때까지 기다린 뒤 turn을 연다.
// 요약 호출을 모델 테이프에서 붙잡아 두고 그 사이에 turn.start를 보낸다. 같은 호스트의 다른 연결이 보내는 turn.start도 어댑터에서는
// 같은 호출이다(처리기가 같은 `TurnPort.submit`을 부른다). 막지 않으면 turn이 요약 도중에 열려 `thread.compacted`보다 먼저 커밋된다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

/** 한 turn의 입력. 컴팩션이 최근 1024토큰을 남기므로 앞선 turn이 요약 대상이 되도록 길게 쓴다 */
function longInput(topic: string): string {
  return `${topic} ${"build cache notes and the reasons behind each decision. ".repeat(200)}`;
}

realTest(
  "a turn.start sent while thread.compact is summarizing waits, and its turn opens after thread.compacted is committed",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, { ...TAPE_SETTINGS, "l1.context.keepRecentTokens": 1024 });
    const summary = "## 목표\n저장소 빌드 속도 조사\n\n## 진행\n캐시 설정을 확인했다";
    // 요청 순서: 대화 turn 셋(0~2), 요약(3, 붙잡는다), 요약 뒤의 turn(4)
    const models = recordingModels(
      "compact-turn-start",
      ["답 하나", "답 둘", "답 셋", summary, "답 넷"],
      { contextWindow: 200_000, holdRequest: 3 },
    );
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
      const converse = async (topic: string): Promise<void> => {
        const started = await startTurnWhenIdle(connection, {
          threadId: created.threadId,
          input: longInput(topic),
        });
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
          20_000,
        );
      };
      await converse("하나");
      await converse("둘");
      await converse("셋");
      const turnsBefore = collector.events.filter((event) => event.kind === "turn.started").length;
      expect(turnsBefore).toBe(3);

      // 컴팩션이 요약 호출에서 멈춘 사이에 turn.start를 보낸다
      const compacting = compactWhenIdle(connection, { threadId: created.threadId });
      await models.reached;
      const starting = connection.request("turn.start", {
        threadId: created.threadId,
        input: "요약이 끝난 뒤의 질문",
      });
      const answered = starting.then(
        () => true,
        () => true,
      );
      // 다른 요청이 오가는 동안에도 turn.start는 응답하지 않고 turn은 열리지 않는다
      await connection.request("thread.list", {});
      await connection.request("thread.list", {});
      expect(await Promise.race([answered, Promise.resolve(false)])).toBe(false);
      expect(collector.events.filter((event) => event.kind === "turn.started")).toHaveLength(
        turnsBefore,
      );
      expect(models.requestTexts()).toHaveLength(4);

      models.release();
      const result = await compacting;
      expect(result.status).toBe("compacted");
      const started = await starting;
      await collector.waitFor(
        (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
        20_000,
      );

      // 값 비교: 컴팩션이 turn보다 먼저 커밋됐고, 새 입력은 요약에 들어가지 않았다
      const compacted = collector.events.find((event) => event.kind === "thread.compacted");
      const opened = collector.events.find(
        (event) => event.kind === "turn.started" && event.turnId === started.turnId,
      );
      expect(compacted).toBeDefined();
      expect(opened).toBeDefined();
      expect(compacted?.seq).toBeLessThan(opened?.seq ?? 0);
      expect(JSON.stringify(compacted?.payload)).not.toContain("요약이 끝난 뒤의 질문");
      // 요약 뒤의 turn은 요약을 보고 답했다
      const requests = models.requestTexts();
      expect(requests).toHaveLength(5);
      expect(requests[4]).toContain("캐시 설정을 확인했다");
      expect(requests[4]).toContain("요약이 끝난 뒤의 질문");
    } finally {
      models.release();
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  90_000,
);
