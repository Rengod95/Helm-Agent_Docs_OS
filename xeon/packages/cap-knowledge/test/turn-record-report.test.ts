import { afterEach, expect, test } from "bun:test";
import type { TurnBlockEvent, TurnRecordSink } from "@fresnel/contracts/extensions";
import { asHost } from "./support/helpers.ts";
import {
  closeWorlds,
  createWorld,
  putSkill,
  USER_SKILLS,
  userLayer,
  type World,
} from "./support/world.ts";
import { createTurnContext } from "../src/turn-context.ts";

// 첫 turn 블록의 턴 기록 알림(정본 turn-record-metrics.md §8 cap-knowledge 행, §4.5 규칙 29). 알림은 요청 본문을 바꾸지 않는다.

afterEach(closeWorlds);

const THREAD = "thr_1";
/** 설명은 `indexDescriptionChars`(기본 160)에서 잘린다. 색인 예산을 1000자로 줄이면 열 개 가운데 세 개만 실린다 */
const LONG = "a".repeat(300);
const NAMES = [
  "skill-01",
  "skill-02",
  "skill-03",
  "skill-04",
  "skill-05",
  "skill-06",
  "skill-07",
  "skill-08",
  "skill-09",
  "skill-10",
];

function recordingSink(events: TurnBlockEvent[]): TurnRecordSink {
  return {
    record: (event) => {
      events.push(event);
    },
  };
}

function contextOf(world: World, turnRecord?: TurnRecordSink) {
  return createTurnContext({
    skills: world.runtime.skills,
    memory: world.runtime.memory,
    logger: world.deps.logger,
    ...(turnRecord === undefined ? {} : { turnRecord }),
  });
}

test("the_index_report_names_the_listed_skills_the_omitted_count_and_the_block_tokens", async () => {
  const world = await createWorld();
  // 기억을 끈다: 기억이 켜져 있으면 빈 기억 블록도 메시지에 실린다
  world.setLayers([
    userLayer({
      "l2.knowledge.skills.indexBudgetChars": 1000,
      "l2.knowledge.memory.enabled": false,
    }),
  ]);
  for (const name of NAMES) putSkill(world.fs, USER_SKILLS, name, { description: LONG });
  await world.runtime.skills.reindex();
  const events: TurnBlockEvent[] = [];
  const turns = contextOf(world, recordingSink(events));
  await turns.start(THREAD, "new");
  const message = await turns.beforeAgentStart(THREAD);
  // 메시지는 색인 블록 하나다(기억이 없다). 블록은 804자이고 어림 토큰은 804 / 4 = 201이다
  expect(message?.content.startsWith("아래 스킬은")).toBe(true);
  expect(message?.content).not.toContain("<memory");
  expect(message?.content.length).toBe(804);
  expect(events).toEqual([
    {
      kind: "skill_index",
      threadId: THREAD,
      plugin: "knowledge",
      listed: ["skill-01", "skill-02", "skill-03"],
      omitted: 7,
      tokens: 201,
    },
  ]);
});

test("the_memory_report_carries_the_memory_block_tokens_and_no_index_report_without_skills", async () => {
  const world = await createWorld();
  await world.runtime.memoryApi.add({ store: "user", text: "한국어 한다체" }, asHost());
  const events: TurnBlockEvent[] = [];
  const turns = contextOf(world, recordingSink(events));
  await turns.start(THREAD, "new");
  const message = await turns.beforeAgentStart(THREAD);
  expect(message?.content).toContain("한국어 한다체");
  expect(events).toEqual([
    {
      kind: "memory",
      threadId: THREAD,
      plugin: "knowledge",
      tokens: Math.ceil((message?.content.length ?? 0) / 4),
    },
  ]);
});

test("a_later_turn_reports_the_same_block_facts_again_and_the_messages_do_not_change", async () => {
  const world = await createWorld();
  putSkill(world.fs, USER_SKILLS, "deploy", { description: "Deploy steps." });
  await world.runtime.skills.reindex();
  await world.runtime.memoryApi.add({ store: "user", text: "한국어 한다체" }, asHost());
  const events: TurnBlockEvent[] = [];
  const watched = contextOf(world, recordingSink(events));
  const silent = contextOf(world);
  await watched.start(THREAD, "new");
  await silent.start(THREAD, "new");
  const first = await watched.beforeAgentStart(THREAD);
  // 같은 대화의 다음 turn은 델타가 없어 메시지를 더하지 않지만, 블록은 이력에 남아 있으므로 알림은 같다
  expect(await watched.beforeAgentStart(THREAD)).toBeUndefined();
  expect(events.map((event) => event.kind)).toEqual([
    "skill_index",
    "memory",
    "skill_index",
    "memory",
  ]);
  expect(events[2]).toEqual(events[0]);
  expect(events[3]).toEqual(events[1]);
  // 싱크가 있어도 없어도 첫 메시지는 같다(알림은 요청을 바꾸지 않는다)
  const withoutSink = await silent.beforeAgentStart(THREAD);
  expect(first).toEqual(withoutSink);
});

test("a_sink_that_throws_leaves_the_message_unchanged_and_logs_one_warning_per_event", async () => {
  const world = await createWorld();
  putSkill(world.fs, USER_SKILLS, "deploy", { description: "Deploy steps." });
  await world.runtime.skills.reindex();
  const turns = contextOf(world, {
    record: () => {
      throw new Error("sink failure");
    },
  });
  await turns.start(THREAD, "new");
  const message = await turns.beforeAgentStart(THREAD);
  expect(message?.content).toContain("<name>deploy</name>");
  // 기억이 켜져 있으므로 두 사건 모두 실패하고 사건마다 경고 하나를 남긴다
  expect(
    world.logs
      .filter((line) => line.event === "knowledge.turn_record_failed")
      .map((line) => line.fields),
  ).toEqual([
    { threadId: THREAD, kind: "skill_index" },
    { threadId: THREAD, kind: "memory" },
  ]);
});
