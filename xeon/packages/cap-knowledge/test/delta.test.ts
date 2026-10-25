import { afterEach, describe, expect, test } from "bun:test";
import { asHost } from "./support/helpers.ts";
import {
  closeWorlds,
  createWorld,
  putSkill,
  USER_SKILLS,
  userLayer,
  type World,
} from "./support/world.ts";
import {
  diffIndex,
  formatIndexDelta,
  isEmptyDelta,
  type IndexSnapshot,
} from "../src/skills/delta.ts";
import {
  createTurnContext,
  DELTA_MESSAGE_TYPE,
  INDEX_MESSAGE_TYPE,
  type TurnContext,
} from "../src/turn-context.ts";

afterEach(closeWorlds);

function snapshot(version: number, entries: Record<string, string>): IndexSnapshot {
  return { version, descriptions: new Map(Object.entries(entries)) };
}

describe("diffIndex and formatIndexDelta", () => {
  test("added, changed and removed names are sorted and described", () => {
    const delta = diffIndex(
      snapshot(1, { "release-checklist": "Old.", "old-notes": "Gone.", same: "Same." }),
      snapshot(2, {
        "release-checklist": "New.",
        "deploy-rollback": "롤백 절차",
        same: "Same.",
      }),
    );
    expect(delta).toEqual({
      added: [{ name: "deploy-rollback", description: "롤백 절차" }],
      changed: ["release-checklist"],
      removed: ["old-notes"],
    });
    expect(formatIndexDelta(delta)).toBe(
      "스킬 인덱스 변경: 추가 deploy-rollback(롤백 절차), 변경 release-checklist, 삭제 old-notes",
    );
  });

  test("an unchanged index is an empty delta with no text", () => {
    const delta = diffIndex(snapshot(1, { a: "A." }), snapshot(2, { a: "A." }));
    expect(isEmptyDelta(delta)).toBe(true);
    expect(formatIndexDelta(delta)).toBe("");
  });

  test("long lists are cut to ten names and long notes to sixty characters", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 13; i += 1) many[`skill-${String(i).padStart(2, "0")}`] = "가".repeat(100);
    const text = formatIndexDelta(diffIndex(snapshot(1, {}), snapshot(2, many)));
    expect(text).toContain(`skill-00(${"가".repeat(59)}…)`);
    expect(text).toContain("skill-09");
    expect(text).not.toContain("skill-10");
    expect(text.endsWith("외 3개")).toBe(true);
  });
});

function contextOf(world: World): TurnContext {
  return createTurnContext({
    skills: world.runtime.skills,
    memory: world.runtime.memory,
    logger: world.deps.logger,
  });
}

const THREAD = "thr_1";

async function created(world: World, name: string, description: string) {
  return world.runtime.skillsApi.create(
    { name, description, body: "# Body\n\nSteps.\n" },
    asHost(),
  );
}

describe("turn context", () => {
  test("first turn adds one record message with the index block and the memory snapshot", async () => {
    const world = await createWorld();
    putSkill(world.fs, USER_SKILLS, "deploy", { description: "Deploy steps." });
    await world.runtime.skills.reindex();
    await world.runtime.memoryApi.add({ store: "user", text: "한국어 한다체" }, asHost());
    const turns = contextOf(world);
    await turns.start(THREAD, "new");
    const message = await turns.beforeAgentStart(THREAD);
    expect(message?.customType).toBe(INDEX_MESSAGE_TYPE);
    expect(message?.display).toBe(false);
    expect(message?.content).toContain("<available_skills>");
    expect(message?.content).toContain("<name>deploy</name>");
    expect(message?.content).toContain('<memory store="user"');
    expect(message?.content).toContain("한국어 한다체");
    expect(await turns.beforeAgentStart(THREAD)).toBeUndefined();
  });

  test("index delta next turn", async () => {
    const world = await createWorld();
    await created(world, "release-checklist", "Old.");
    await created(world, "old-notes", "Gone.");
    const turns = contextOf(world);
    await turns.start(THREAD, "new");
    await turns.beforeAgentStart(THREAD);

    await created(world, "deploy-rollback", "Rollback steps.");
    await world.runtime.skillsApi.edit(
      {
        name: "release-checklist",
        baseHash: (await world.runtime.skillsApi.view({ name: "release-checklist" })).treeHash,
        description: "New.",
      },
      asHost(),
    );
    await world.runtime.skillsApi.remove(
      {
        name: "old-notes",
        baseHash: (await world.runtime.skillsApi.view({ name: "old-notes" })).treeHash,
      },
      asHost(),
    );
    const message = await turns.beforeAgentStart(THREAD);
    expect(message).toEqual({
      customType: DELTA_MESSAGE_TYPE,
      content:
        "스킬 인덱스 변경: 추가 deploy-rollback(Rollback steps.), 변경 release-checklist, 삭제 old-notes",
      display: false,
    });
    // 같은 변경을 두 번 알리지 않는다
    expect(await turns.beforeAgentStart(THREAD)).toBeUndefined();
  });

  test("a body-only change gives no memo", async () => {
    const world = await createWorld();
    await created(world, "deploy", "Deploy steps.");
    const turns = contextOf(world);
    await turns.start(THREAD, "new");
    await turns.beforeAgentStart(THREAD);
    const viewed = await world.runtime.skillsApi.view({ name: "deploy" });
    await world.runtime.skillsApi.edit(
      { name: "deploy", baseHash: viewed.treeHash, body: "Fresh body." },
      asHost(),
    );
    expect(await turns.beforeAgentStart(THREAD)).toBeUndefined();
  });

  test("a hidden skill appearing in the index is reported as added and disappearing as removed", async () => {
    const world = await createWorld();
    putSkill(world.fs, USER_SKILLS, "quiet", {
      description: "Quiet.",
      frontmatter: "disable-model-invocation: true\n",
    });
    await world.runtime.skills.reindex();
    const turns = contextOf(world);
    await turns.start(THREAD, "new");
    await turns.beforeAgentStart(THREAD);
    putSkill(world.fs, USER_SKILLS, "quiet", {
      description: "Quiet.",
      frontmatter: "disable-model-invocation: false\n",
    });
    await world.runtime.skills.reindex();
    expect((await turns.beforeAgentStart(THREAD))?.content).toBe(
      "스킬 인덱스 변경: 추가 quiet(Quiet.)",
    );
  });

  test("sessions are independent and shutdown forgets the session", async () => {
    const world = await createWorld();
    await created(world, "deploy", "Deploy steps.");
    const turns = contextOf(world);
    await turns.start("thr_a", "new");
    await turns.beforeAgentStart("thr_a");
    await created(world, "extra", "Extra.");
    await turns.start("thr_b", "new");
    const first = await turns.beforeAgentStart("thr_b");
    expect(first?.customType).toBe(INDEX_MESSAGE_TYPE);
    expect((await turns.beforeAgentStart("thr_a"))?.customType).toBe(DELTA_MESSAGE_TYPE);
    expect(turns.size()).toBe(2);
    turns.shutdown("thr_a");
    expect(turns.size()).toBe(1);
    // 정리한 세션의 다음 turn은 처음 turn처럼 블록을 다시 넣는다
    expect((await turns.beforeAgentStart("thr_a"))?.customType).toBe(INDEX_MESSAGE_TYPE);
  });

  test("after a compaction the next turn re-adds the index block and memory snapshot once, from the current index", async () => {
    const world = await createWorld();
    await created(world, "deploy", "Deploy steps.");
    await world.runtime.memoryApi.add({ store: "user", text: "한국어 한다체" }, asHost());
    const turns = contextOf(world);
    await turns.start(THREAD, "new");
    await turns.beforeAgentStart(THREAD);
    expect(await turns.beforeAgentStart(THREAD)).toBeUndefined();

    await created(world, "rollback", "Rollback steps.");
    turns.afterCompaction(THREAD);
    const again = await turns.beforeAgentStart(THREAD);
    // 델타 메모가 아니라 지금 인덱스 전체와 메모리 스냅샷이다
    expect(again?.customType).toBe(INDEX_MESSAGE_TYPE);
    expect(again?.content).toContain("<name>deploy</name>");
    expect(again?.content).toContain("<name>rollback</name>");
    expect(again?.content).toContain("한국어 한다체");
    expect(await turns.beforeAgentStart(THREAD)).toBeUndefined();
  });

  test("a resumed session does not repeat the first-turn block and starts from the current index", async () => {
    const world = await createWorld();
    await created(world, "deploy", "Deploy steps.");
    const turns = contextOf(world);
    await turns.start(THREAD, "resume");
    expect(await turns.beforeAgentStart(THREAD)).toBeUndefined();
    await created(world, "extra", "Extra.");
    expect((await turns.beforeAgentStart(THREAD))?.content).toBe(
      "스킬 인덱스 변경: 추가 extra(Extra.)",
    );
  });

  test("session start reindexes skills placed outside the engine, except at startup", async () => {
    const world = await createWorld();
    const turns = contextOf(world);
    putSkill(world.fs, USER_SKILLS, "outside", { description: "Placed by hand." });
    await turns.start(THREAD, "startup");
    expect((await world.runtime.skillsApi.list({})).skills).toEqual([]);
    await turns.start("thr_2", "new");
    expect((await world.runtime.skillsApi.list({})).skills.map((skill) => skill.name)).toEqual([
      "outside",
    ]);
  });

  test("with skills and memory off the first turn adds nothing", async () => {
    const world = await createWorld();
    world.setLayers([
      userLayer({ "l2.knowledge.skills.enabled": false, "l2.knowledge.memory.enabled": false }),
    ]);
    const turns = contextOf(world);
    await turns.start(THREAD, "new");
    expect(await turns.beforeAgentStart(THREAD)).toBeUndefined();
  });
});
