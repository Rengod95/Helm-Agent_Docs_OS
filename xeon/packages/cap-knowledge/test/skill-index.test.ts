import { afterEach, describe, expect, test } from "bun:test";
import { renderSkillView } from "@xeon/contracts/capabilities";
import { treeHash } from "../src/skills/tree.ts";
import { buildSkillIndexBlock, truncateDescription } from "../src/skills/prompt-block.ts";
import { asHost, rejection, treeFrom } from "./support/helpers.ts";
import {
  closeWorlds,
  createWorld,
  PROJECT_SKILLS,
  putSkill,
  userLayer,
  USER_SKILLS,
  type World,
} from "./support/world.ts";

afterEach(closeWorlds);

async function reindexed(world: World): Promise<void> {
  const result = await world.runtime.skills.reindex();
  if (!result.ok) throw new Error(result.error.message);
}

function entries(count: number, description = "d"): ReturnType<typeof entry>[] {
  return Array.from({ length: count }, (_, i) =>
    entry(`skill-${String(i).padStart(2, "0")}`, description),
  );
}

function entry(name: string, description: string) {
  return {
    name,
    description,
    scope: "user" as const,
    createdBy: "unknown" as const,
    treeHash: "0".repeat(64),
    modelInvocable: true,
  };
}

describe("skill index block", () => {
  test("index budget", () => {
    const all = entries(30, "x".repeat(100));
    const block = buildSkillIndexBlock(all, 2500);
    expect(block.usedChars).toBeLessThanOrEqual(2500);
    expect(block.included.length).toBeGreaterThan(0);
    expect(block.included.length).toBeLessThan(30);
    expect(block.omitted).toBe(30 - block.included.length);
    // 앞에서부터 싣는다: 건너뛰고 뒤의 짧은 항목을 싣지 않는다
    expect(block.included).toEqual(all.slice(0, block.included.length).map((e) => e.name));
    expect(block.text).toContain(
      `외 ${block.omitted}개 스킬은 knowledge_search(kinds: ["skill"])로 찾는다.`,
    );
    expect(block.text).toContain("skill_view");
    // 같은 집합은 같은 바이트
    expect(buildSkillIndexBlock(all, 2500).text).toBe(block.text);
    // 다 들어가면 안내 문구가 없다
    const roomy = buildSkillIndexBlock(entries(3), 8000);
    expect(roomy.omitted).toBe(0);
    expect(roomy.text).not.toContain("외 ");
    expect(buildSkillIndexBlock([], 8000)).toEqual({
      text: "",
      usedChars: 0,
      omitted: 0,
      included: [],
    });
  });

  test("description truncation", () => {
    expect(truncateDescription("short", 160)).toBe("short");
    const long = "가".repeat(200);
    const cut = truncateDescription(long, 160);
    expect(Array.from(cut)).toHaveLength(160);
    expect(cut.endsWith("…")).toBe(true);
    expect(truncateDescription("two\n\nlines  here", 160)).toBe("two lines here");
    // 서로게이트 쌍을 가르지 않는다
    expect(Array.from(truncateDescription("😀".repeat(50), 10))).toHaveLength(10);
  });

  test("xml special characters are escaped", () => {
    const block = buildSkillIndexBlock([entry("a", `<b>&"quote"</b>`)], 8000);
    expect(block.text).toContain("&lt;b&gt;&amp;&quot;quote&quot;&lt;/b&gt;");
  });
});

describe("skills service", () => {
  test("list shows scopes in order, truncated descriptions and hides non-invocable skills", async () => {
    const world = await createWorld();
    putSkill(world.fs, PROJECT_SKILLS, "proj-skill", { description: "project procedure" });
    putSkill(world.fs, USER_SKILLS, "b-skill", { description: "y".repeat(400) });
    putSkill(world.fs, USER_SKILLS, "a-skill");
    putSkill(world.fs, USER_SKILLS, "hidden-skill", {
      frontmatter: "disable-model-invocation: true\n",
    });
    await reindexed(world);

    const listed = await world.runtime.skillsApi.list({});
    expect(listed.skills.map((s) => `${s.scope}:${s.name}`)).toEqual([
      "project:proj-skill",
      "user:a-skill",
      "user:b-skill",
    ]);
    const long = listed.skills.find((s) => s.name === "b-skill");
    expect(Array.from(long?.description ?? "")).toHaveLength(160);
    expect(listed.budget.limitChars).toBe(8000);
    expect(listed.budget.omitted).toBe(0);
    expect(listed.budget.usedChars).toBeGreaterThan(0);

    const all = await world.runtime.skillsApi.list({ includeHidden: true });
    expect(all.skills.map((s) => s.name)).toContain("hidden-skill");
    expect(all.skills.find((s) => s.name === "hidden-skill")?.modelInvocable).toBe(false);

    const onlyUser = await world.runtime.skillsApi.list({ scopes: ["user"] });
    expect(onlyUser.skills.map((s) => s.scope)).toEqual(["user", "user"]);

    // 모델 인덱스 블록에는 숨긴 스킬이 없다
    const block = world.runtime.skills.indexBlock(undefined);
    expect(block.ok && block.value.included).toEqual(["proj-skill", "a-skill", "b-skill"]);
  });

  test("lazy body loading", async () => {
    const world = await createWorld();
    putSkill(world.fs, USER_SKILLS, "lazy", {
      body: "SECRET-BODY\n",
      extra: { "references/a.md": "ref" },
    });
    await reindexed(world);
    world.fs.reads.length = 0;
    await world.runtime.skillsApi.list({});
    world.runtime.skills.indexBlock(undefined);
    expect(world.fs.reads).toEqual([]);
    const viewed = await world.runtime.skillsApi.view({ name: "lazy" });
    expect(viewed.content).toBe("SECRET-BODY");
    expect(world.fs.reads.length).toBeGreaterThan(0);
  });

  test("tree hash stable", () => {
    const a = treeFrom({ "SKILL.md": "x", "references/b.md": "2", "references/a.md": "1" });
    const b = treeFrom({ "references/a.md": "1", "SKILL.md": "x", "references/b.md": "2" });
    expect(treeHash(a)).toBe(treeHash(b));
    expect(
      treeHash(treeFrom({ "SKILL.md": "x", "references/b.md": "2", "references/a.md": "1!" })),
    ).not.toBe(treeHash(a));
    // 경로도 해시에 든다
    expect(treeHash(treeFrom({ "a.md": "1" }))).not.toBe(treeHash(treeFrom({ "b.md": "1" })));
  });

  test("dot files, archives and symlinks stay out of the tree hash", async () => {
    const world = await createWorld();
    const dir = putSkill(world.fs, USER_SKILLS, "clean");
    await reindexed(world);
    const before = (await world.runtime.skillsApi.list({})).skills[0]?.treeHash;
    world.fs.put(`${dir}/.DS_Store`, "junk");
    world.fs.put(`${USER_SKILLS}/.archive/old-20260101T000000Z/SKILL.md`, "old");
    world.fs.symlink(`${dir}/link.md`, `${dir}/SKILL.md`);
    const result = await world.runtime.skills.reindex();
    expect(result.ok && result.value.changed).toBe(0);
    const after = (await world.runtime.skillsApi.list({})).skills[0]?.treeHash;
    expect(after).toBe(before);
  });

  test("view returns the body, support files and the tree hash", async () => {
    const world = await createWorld();
    putSkill(world.fs, USER_SKILLS, "deploy", {
      description: "Deploy steps",
      body: "# Deploy\n\n1. go\n",
      extra: {
        "references/guide.md": "guide text",
        "scripts/run.sh": "echo hi",
        "NOTES.txt": "root note",
      },
    });
    await reindexed(world);
    const body = await world.runtime.skillsApi.view({ name: "deploy" });
    expect(body.content).toBe("# Deploy\n\n1. go");
    expect(body.description).toBe("Deploy steps");
    expect(body.scope).toBe("user");
    expect(body.createdBy).toBe("unknown");
    // 지원 파일 규칙(허용 하위 디렉터리)에 맞는 파일만 files에 든다
    expect(body.files).toEqual(["references/guide.md", "scripts/run.sh"]);
    const file = await world.runtime.skillsApi.view({
      name: "deploy",
      file: "references/guide.md",
    });
    expect(file.content).toBe("guide text");
    expect(file.treeHash).toBe(body.treeHash);
    const missing = await rejection(
      world.runtime.skillsApi.view({ name: "deploy", file: "references/none.md" }),
    );
    expect(missing.data.code).toBe("not_found");
    const unknown = await rejection(world.runtime.skillsApi.view({ name: "nope" }));
    expect(unknown.data.code).toBe("not_found");
  });

  test("unsafe support file paths are rejected before any file access", async () => {
    const world = await createWorld();
    putSkill(world.fs, USER_SKILLS, "deploy", { extra: { "references/.hidden": "h" } });
    world.fs.put("/data/secret.txt", "outside");
    await reindexed(world);
    world.fs.reads.length = 0;
    const unsafe = [
      "references/../../secret.txt",
      "references/../SKILL.md",
      "../secret.txt",
      "/etc/passwd",
      "references/./a.md",
      "references/.hidden",
      "references/trailing.",
      "SKILL.md",
      "other/a.md",
    ];
    const errors = await Promise.all(
      unsafe.map((file) => rejection(world.runtime.skillsApi.view({ name: "deploy", file }))),
    );
    expect(errors.map((error) => error.data.code)).toEqual(unsafe.map(() => "invalid_input"));
    expect(world.fs.reads).toEqual([]);
  });

  test("a symlink inside a skill never leaks a file from outside", async () => {
    const world = await createWorld();
    const dir = putSkill(world.fs, USER_SKILLS, "deploy");
    world.fs.put("/data/secret.txt", "outside");
    world.fs.symlink(`${dir}/references/leak.md`, "/data/secret.txt");
    await reindexed(world);
    const viewed = await world.runtime.skillsApi.view({ name: "deploy" });
    expect(viewed.files).toEqual([]);
    const error = await rejection(
      world.runtime.skillsApi.view({ name: "deploy", file: "references/leak.md" }),
    );
    expect(error.data.code).toBe("not_found");
  });

  test("agent-made skill bodies are wrapped as untrusted when rendered", async () => {
    const world = await createWorld();
    const dir = putSkill(world.fs, USER_SKILLS, "learned");
    await reindexed(world);
    world.deps.db.write((tx) => {
      tx.run("UPDATE cap_knowledge_skills SET created_by = 'agent' WHERE name = 'learned'");
    });
    expect(world.fs.has(dir)).toBe(true);
    const viewed = await world.runtime.skillsApi.view({ name: "learned" });
    expect(viewed.createdBy).toBe("agent");
    const rendered = renderSkillView(viewed);
    const text = rendered.content[0]?.type === "text" ? rendered.content[0].text : "";
    expect(text).toContain('<untrusted_session_content kind="skill" createdBy="agent">');
  });

  test("a file edited outside is noticed on view and recorded as external", async () => {
    const world = await createWorld();
    const dir = putSkill(world.fs, USER_SKILLS, "deploy", { body: "old body\n" });
    await reindexed(world);
    const first = await world.runtime.skillsApi.view({ name: "deploy" });
    world.fs.put(
      `${dir}/SKILL.md`,
      "---\nname: deploy\ndescription: Use when working on deploy.\n---\nnew body\n",
    );
    const second = await world.runtime.skillsApi.view({ name: "deploy" });
    expect(second.content).toBe("new body");
    expect(second.treeHash).not.toBe(first.treeHash);

    const ledger = await world.runtime.ledgerApi.list({
      target: { kind: "skill", name: "deploy", scope: "user" },
    });
    expect(ledger.entries.map((e) => e.op)).toEqual(["external", "external"]);
    const change = ledger.entries[0];
    expect(change?.actor).toEqual({ kind: "external" });
    expect(change?.beforeHash).toBe(first.treeHash);
    expect(change?.afterHash).toBe(second.treeHash);
    const shown = await world.runtime.ledgerApi.show({ ledgerId: change?.ledgerId ?? "" });
    expect(shown.files).toHaveLength(1);
    expect(shown.files[0]?.change).toBe("modified");
    expect(shown.files[0]?.diff).toContain("-old body");
    expect(shown.files[0]?.diff).toContain("+new body");

    // 바깥 편집도 되돌릴 수 있다(이전 내용을 담은 항목이다)
    const rolled = await world.runtime.ledgerApi.rollback(
      { ledgerId: change?.ledgerId ?? "" },
      asHost(),
    );
    expect(rolled.status).toBe("applied");
    expect(world.fs.text(`${dir}/SKILL.md`)).toContain("old body");
  });

  test("reindex counts changes and keeps external edits in the ledger for writable scopes only", async () => {
    const world = await createWorld({
      extensionRoots: [{ dir: "/ext/skills", extension: "demo" }],
    });
    putSkill(world.fs, USER_SKILLS, "keep");
    putSkill(world.fs, USER_SKILLS, "gone");
    putSkill(world.fs, "/ext/skills", "from-ext");
    const first = await world.runtime.skills.reindex();
    expect(first.ok && [first.value.added, first.value.changed, first.value.removed]).toEqual([
      3, 0, 0,
    ]);

    putSkill(world.fs, USER_SKILLS, "keep", { body: "changed\n" });
    await world.fs.remove(`${USER_SKILLS}/gone`, { recursive: true });
    putSkill(world.fs, USER_SKILLS, "fresh");
    putSkill(world.fs, "/ext/skills", "from-ext", { body: "ext changed\n" });
    const second = await world.runtime.skills.reindex();
    expect(second.ok && [second.value.added, second.value.changed, second.value.removed]).toEqual([
      1, 2, 1,
    ]);

    const ledger = await world.runtime.ledgerApi.list({}, asHost());
    // 확장 범위(읽기 전용)는 원장에 남기지 않는다: 첫 훑기 사용자 2 + 둘째 훑기 사용자 3
    expect(ledger.entries).toHaveLength(5);
    expect(
      ledger.entries.every((e) => e.actor.kind === "external" && e.target.scope === "user"),
    ).toBe(true);
    const list = await world.runtime.skillsApi.list({});
    expect(list.skills.map((s) => s.name)).toEqual(["fresh", "keep", "from-ext"]);
  });

  test("the index version moves only when names or descriptions change", async () => {
    const world = await createWorld();
    const dir = putSkill(world.fs, USER_SKILLS, "deploy", { description: "one" });
    await reindexed(world);
    const v1 = (await world.runtime.skillsApi.list({})).indexVersion;
    expect(v1).toBeGreaterThan(0);

    world.fs.put(
      `${dir}/SKILL.md`,
      "---\nname: deploy\ndescription: one\n---\nonly the body changed\n",
    );
    await reindexed(world);
    expect((await world.runtime.skillsApi.list({})).indexVersion).toBe(v1);

    world.fs.put(
      `${dir}/SKILL.md`,
      "---\nname: deploy\ndescription: two\n---\nonly the body changed\n",
    );
    await reindexed(world);
    expect((await world.runtime.skillsApi.list({})).indexVersion).toBeGreaterThan(v1);
  });

  test("a shadowed skill is not addressable and an unaddressable name is not indexed", async () => {
    const world = await createWorld();
    putSkill(world.fs, PROJECT_SKILLS, "same", { description: "project one" });
    putSkill(world.fs, USER_SKILLS, "same", { description: "user one" });
    world.fs.put(
      `${USER_SKILLS}/Bad_Name/SKILL.md`,
      "---\nname: Bad_Name\ndescription: bad\n---\nbody\n",
    );
    await reindexed(world);
    const listed = await world.runtime.skillsApi.list({});
    expect(listed.skills.map((s) => `${s.scope}:${s.name}`)).toEqual(["project:same"]);
    expect(listed.diagnostics.some((d) => d.severity === "collision")).toBe(true);
    expect(listed.diagnostics.some((d) => d.message.includes("cannot be addressed"))).toBe(true);
    const viewed = await world.runtime.skillsApi.view({ name: "same" });
    expect(viewed.description).toBe("project one");
    const shadowed = await rejection(world.runtime.skillsApi.view({ name: "same", scope: "user" }));
    expect(shadowed.data.code).toBe("not_found");
  });

  test("a skill tree beyond the limits is left out with a warning", async () => {
    const world = await createWorld();
    const dir = putSkill(world.fs, USER_SKILLS, "huge");
    for (let i = 0; i < 501; i += 1) world.fs.put(`${dir}/references/f${i}.md`, "x");
    putSkill(world.fs, USER_SKILLS, "fine");
    const result = await world.runtime.skills.reindex();
    expect(
      result.ok && result.value.diagnostics.some((d) => d.message.includes("not indexed")),
    ).toBe(true);
    expect((await world.runtime.skillsApi.list({})).skills.map((s) => s.name)).toEqual(["fine"]);
  });

  test("turning skills off empties list and view", async () => {
    const world = await createWorld();
    putSkill(world.fs, USER_SKILLS, "deploy");
    await reindexed(world);
    world.setLayers([userLayer({ "l2.knowledge.skills.enabled": false })]);
    expect((await world.runtime.skillsApi.list({})).skills).toEqual([]);
    const block = world.runtime.skills.indexBlock(undefined);
    expect(block.ok && block.value.text).toBe("");
    const error = await rejection(world.runtime.skillsApi.view({ name: "deploy" }));
    expect(error.data.code).toBe("unavailable");
  });

  test("the budget and description settings apply on the next call", async () => {
    const world = await createWorld();
    for (let i = 0; i < 20; i += 1) {
      putSkill(world.fs, USER_SKILLS, `skill-${String(i).padStart(2, "0")}`, {
        description: "z".repeat(200),
      });
    }
    await reindexed(world);
    const roomy = await world.runtime.skillsApi.list({});
    expect(roomy.budget.omitted).toBe(0);
    world.setLayers([
      userLayer({
        "l2.knowledge.skills.indexBudgetChars": 1000,
        "l2.knowledge.skills.indexDescriptionChars": 40,
      }),
    ]);
    const tight = await world.runtime.skillsApi.list({});
    expect(tight.budget.limitChars).toBe(1000);
    expect(tight.budget.omitted).toBeGreaterThan(0);
    expect(Array.from(tight.skills[0]?.description ?? "")).toHaveLength(40);
  });

  test("write methods are not available yet", async () => {
    const world = await createWorld();
    const error = await rejection(
      world.runtime.skillsApi.create({ name: "x", description: "d", body: "b" }),
    );
    expect(error.data.code).toBe("unsupported");
    const manage = await rejection(world.runtime.skillsApi.manage({ action: "create", name: "x" }));
    expect(manage.data.code).toBe("unsupported");
  });
});
