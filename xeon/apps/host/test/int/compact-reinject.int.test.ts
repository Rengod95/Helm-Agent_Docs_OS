import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost } from "../../src/main.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { recordingModels } from "../fixtures/recording-tape.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import {
  collectEvents,
  compactWhenIdle,
  HELLO_PARAMS,
  startTurnWhenIdle,
} from "../fixtures/wire-client.ts";

// M2 마감 재검토 결함 2 (int): 컴팩션 뒤 스킬 색인과 메모리 블록이 모델 요청에 한 번만 들어간다. 실제 엔진이 자동으로 컴팩션하고(요청 전 임계 검사),
// 그 뒤 turn이 이어진다(T4 partial). 모델 요청 본문을 값으로 세어 견준다.
// 임계가 넘는 시점은 도구 정의 크기에 매이지 않는다. 엔진은 마지막 응답의 usage(테이프가 보고하는 입력 토큰 수)로 컨텍스트를 추정하므로,
// 시험이 답마다 보고 값을 정해 임계와의 관계를 직접 정한다. 첫 요청 추정만 도구 정의를 글자 수로 세는데, 창이 그보다 훨씬 커서 도구가 늘어도 넘지 않는다.
// 조립: L1.context.spec §4.9a(접힌 범위의 블록을 요약 바로 뒤에 다시 놓는다), L2.knowledge.spec §4.2.8.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

const SKILL_BLOCK = "<available_skills>";
/** 메모리 블록에서 사용자 저장소 항목 하나. 블록이 한 번 들어가면 이 줄도 한 번 나온다 */
const MEMORY_BLOCK = "user prefers short answers";
/** 첫 시험의 창. 임계는 창 - reserveTokens(1024)다 */
const CONTEXT_WINDOW = 100_000;

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/**
 * 한 turn의 입력. 임계를 정하는 값은 응답이 보고하는 usage이고, 입력 길이는 그 뒤 추정에 더해지는 몫이다.
 * 첫 turn 요청 전 추정은 글자 수로 세므로(도구 정의를 포함한다) 첫 turn은 임계보다 훨씬 아래에 있어야 한다.
 */
function bigInput(topic: string): string {
  return `${topic} ${"build cache notes and the reasons behind each decision. ".repeat(200)}`;
}

/** 사용자 스킬 하나와 사용자 메모리 항목 하나를 둔 엔진 홈 */
function homeWithKnowledge(settings: Readonly<Record<string, unknown>>): EngineHome {
  const home = useEngineHome();
  writeUserSettings(home, { ...TAPE_SETTINGS, ...settings });
  mkdirSync(join(home.dataDir, "skills", "reinject-probe"), { recursive: true, mode: 0o700 });
  writeFileSync(
    join(home.dataDir, "skills", "reinject-probe", "SKILL.md"),
    "---\nname: reinject-probe\ndescription: Use when the test asks for reinject-probe.\n---\nbody\n",
  );
  mkdirSync(join(home.dataDir, "memory"), { recursive: true, mode: 0o700 });
  writeFileSync(join(home.dataDir, "memory", "USER.md"), "user prefers short answers\n");
  return home;
}

realTest(
  "after an automatic compaction the conversation continues, and the skill index and the memory block are in each model request exactly once",
  async () => {
    const home = homeWithKnowledge({
      "l1.context.reserveTokens": 1024,
      "l1.context.keepRecentTokens": 1024,
    });
    const summary = "## 목표\n저장소 빌드 속도 조사\n\n## 진행\n캐시 설정을 확인했다";
    // 임계는 창 - 1024 = 98976. 첫 응답 뒤 추정(5만 + 입력 한 개)은 임계 아래라 둘째 turn 요청 전에 컴팩션하지 않는다.
    // 둘째 응답 뒤 추정(9만 9천 + 입력 한 개)은 임계를 넘어 셋째 turn 요청 전에 컴팩션한다(요약 호출이 세 번째 요청).
    // 컴팩션 뒤 셋째 응답의 추정(6만 + 입력 한 개)은 임계 아래라 두 번째 컴팩션은 없다.
    const models = recordingModels(
      "reinject",
      [
        { text: "답 하나", inputTokens: 50_000 },
        { text: "답 둘", inputTokens: 99_000 },
        summary,
        { text: "답 셋", inputTokens: 60_000 },
        "답 넷",
      ],
      { contextWindow: CONTEXT_WINDOW },
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
          input: bigInput(topic),
        });
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
          20_000,
        );
      };
      await converse("하나");
      await converse("둘");
      expect(collector.events.filter((event) => event.kind === "thread.compacted")).toHaveLength(0);
      await converse("셋");
      await converse("넷");

      // 자동 컴팩션이 한 번 일어났고, 요약이 뒤 turn의 요청에 들어갔다
      expect(collector.events.filter((event) => event.kind === "thread.compacted")).toHaveLength(1);
      const requests = models.requestTexts();
      // 요청 순서: 하나, 둘, 요약, 셋, 넷
      expect(requests).toHaveLength(5);
      const [first, second, summarizing, third, fourth] = requests;
      expect(first).toBeDefined();
      // 컴팩션 전에는 첫 turn에 한 번 들어간 블록이 그대로 한 번이다
      for (const before of [first, second]) {
        expect(countOf(before ?? "", SKILL_BLOCK)).toBe(1);
        expect(countOf(before ?? "", MEMORY_BLOCK)).toBe(1);
      }
      expect(summarizing).toBeDefined();
      // 컴팩션 뒤 두 turn은 요약을 보고, 블록은 하나씩만 보인다(두 번 들어가지 않는다)
      for (const after of [third, fourth]) {
        expect(after).toContain("캐시 설정을 확인했다");
        expect(countOf(after ?? "", SKILL_BLOCK)).toBe(1);
        expect(countOf(after ?? "", MEMORY_BLOCK)).toBe(1);
      }
      expect(fourth).toContain("답 셋");
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  90_000,
);

realTest(
  "after a manual thread.compact the next turn has the skill index and the memory block exactly once as well",
  async () => {
    const home = homeWithKnowledge({ "l1.context.keepRecentTokens": 1024 });
    const summary = "## 목표\n저장소 빌드 속도 조사\n\n## 진행\n캐시 설정을 확인했다";
    const models = recordingModels("reinject-manual", ["답 하나", "답 둘", summary, "답 셋"], {
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
      const converse = async (topic: string): Promise<void> => {
        const started = await startTurnWhenIdle(connection, {
          threadId: created.threadId,
          input: bigInput(topic),
        });
        await collector.waitFor(
          (event) => event.kind === "turn.completed" && event.turnId === started.turnId,
          20_000,
        );
      };
      await converse("하나");
      await converse("둘");
      const result = await compactWhenIdle(connection, { threadId: created.threadId });
      expect(result.status).toBe("compacted");
      await converse("셋");

      const requests = models.requestTexts();
      // 요청 순서: 하나, 둘, 요약, 셋
      expect(requests).toHaveLength(4);
      const after = requests[3] ?? "";
      expect(after).toContain("캐시 설정을 확인했다");
      expect(countOf(after, SKILL_BLOCK)).toBe(1);
      expect(countOf(after, MEMORY_BLOCK)).toBe(1);
    } finally {
      await connection.close();
      await host.close();
      home.dispose();
    }
  },
  60_000,
);
