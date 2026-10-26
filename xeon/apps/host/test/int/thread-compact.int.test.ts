import { expect, test } from "bun:test";
import { WireError } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { sequencedModels, stallingModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import {
  collectEvents,
  compactWhenIdle,
  HELLO_PARAMS,
  startTurnWhenIdle,
} from "../fixtures/wire-client.ts";

// G2-01 (int): 실제 엔진과 저장소 위의 수동 컴팩션. 긴 대화를 thread.compact로 요약하면 thread.compacted가 커밋되고 응답의 위치가 그 이벤트를 가리킨다.
// 모델은 테이프다: 대화 turn 셋과 요약 호출이 같은 큐에서 차례로 답을 꺼낸다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

/** 한 turn의 입력. 컴팩션이 최근 1024토큰을 남기므로 앞선 turn이 요약 대상이 되도록 길게 쓴다 */
function longInput(topic: string): string {
  return `${topic} ${"이 항목의 배경과 결정 이유를 자세히 정리했다. ".repeat(220)}`;
}

realTest(
  "thread.compact summarizes the conversation, commits thread.compacted at the reported position, and a second call has nothing to do",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, { ...TAPE_SETTINGS, "l1.context.keepRecentTokens": 1024 });
    const summary = "## 목표\n저장소 빌드 속도 조사\n\n## 진행\n캐시 설정을 확인했다";
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: sequencedModels("compact", ["첫째 답", "둘째 답", "셋째 답", summary, summary]),
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
      const result = await compactWhenIdle(connection, {
        threadId: created.threadId,
        instructions: "빌드 속도 조사 위주로",
      });
      expect(result.status).toBe("compacted");
      if (result.status !== "compacted") return;
      expect(result.fromExtension).toBeNull();
      expect(result.tokensBefore).toBeGreaterThan(1024);
      const committed = await collector.waitFor((event) => event.kind === "thread.compacted");
      expect(committed.id).toBe(result.eventId);
      expect(committed.seq).toBeLessThanOrEqual(result.position.seq);
      expect(committed.payload).toMatchObject({ tokensBefore: result.tokensBefore });
      expect(JSON.stringify(committed.payload)).toContain("캐시 설정을 확인했다");
      // 마지막 이벤트가 컴팩션이면 요약할 것이 없다(오류가 아니다)
      expect(await compactWhenIdle(connection, { threadId: created.threadId })).toEqual({
        status: "skipped",
        why: "last_entry_is_compaction",
      });
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);

realTest(
  "a short conversation has nothing to summarize, and a thread that does not exist is thread.notFound",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: sequencedModels("compact-short", ["답"]),
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    try {
      const created = await connection.request("thread.create", {});
      expect(await connection.request("thread.compact", { threadId: created.threadId })).toEqual({
        status: "skipped",
        why: "nothing_to_summarize",
      });
      await connection.request("thread.delete", { threadId: created.threadId });
      const caught = await rejectionOf(
        connection.request("thread.compact", { threadId: created.threadId }),
      );
      expect(caught).toBeInstanceOf(WireError);
      if (caught instanceof WireError) expect(caught.code).toBe(3001);
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  30_000,
);

realTest(
  "while a turn is running thread.compact is turn.busy with that turn's id, and nothing is summarized",
  async () => {
    const home = useEngineHome();
    writeUserSettings(home, TAPE_SETTINGS);
    const host = await startInProcessHost({
      devChecks: true,
      defaultGroups: false,
      buildModels: stallingModels("compact-busy"),
    });
    const connection = createHostConnection(host.client);
    await connection.request("host.hello", HELLO_PARAMS);
    const collector = collectEvents(connection);
    await connection.request("events.subscribe", { from: "head" });
    try {
      const created = await connection.request("thread.create", {});
      const started = await connection.request("turn.start", {
        threadId: created.threadId,
        input: "응답하지 않는 질문",
      });
      await collector.waitFor((event) => event.kind === "turn.started");
      const caught = await rejectionOf(
        connection.request("thread.compact", { threadId: created.threadId }),
      );
      expect(caught).toBeInstanceOf(WireError);
      if (caught instanceof WireError) {
        expect(caught.code).toBe(3003);
        expect(caught.data.details).toEqual({ turnId: started.turnId });
      }
      await connection.request("turn.interrupt", { threadId: created.threadId });
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  30_000,
);
