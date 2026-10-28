import { describe, expect, test } from "bun:test";
import {
  loadSkills,
  loadSkillsFromDir,
  parseFrontmatter,
  type SkillSource,
} from "../src/upstream/skills.ts";
import { createMemoryFs } from "./support/memory-fs.ts";

const USER: SkillSource = { scope: "user", root: "/r" };

function skillFile(name: string, description: string | undefined, extra = ""): string {
  const desc = description === undefined ? "" : `description: ${description}\n`;
  return `---\nname: ${name}\n${desc}${extra}---\nbody of ${name}\n`;
}

function threeSkills(): ReturnType<typeof createMemoryFs> {
  const fs = createMemoryFs();
  for (const name of ["zeta", "alpha", "mid"]) fs.put(`/r/${name}/SKILL.md`, skillFile(name, name));
  return fs;
}

describe("fork of pi skills.ts", () => {
  test("discovery rules match pi", async () => {
    const fs = createMemoryFs();
    fs.put("/r/a/SKILL.md", skillFile("a", "skill a"));
    // SKILL.md가 있는 디렉터리에서 멈춘다: 아래 SKILL.md는 보지 않는다
    fs.put("/r/a/inner/SKILL.md", skillFile("inner", "never seen"));
    fs.put("/r/.hidden/SKILL.md", skillFile("hidden", "dot dir"));
    fs.put("/r/node_modules/pkg/SKILL.md", skillFile("pkg", "dependency"));
    fs.put("/r/group/deep/SKILL.md", skillFile("deep", "nested skill"));
    // 하위 디렉터리의 루트 아닌 .md는 스킬이 아니다
    fs.put("/r/group/loose.md", skillFile("loose", "not a root file"));
    // 루트 바로 아래의 .md는 설명이 있으면 스킬이다
    fs.put("/r/single.md", skillFile("single", "single file skill"));
    fs.put("/r/notes.md", "# plain notes without frontmatter\n");
    // 설명 없는 SKILL.md는 싣지 않고 경고한다
    fs.put("/r/nodesc/SKILL.md", skillFile("nodesc", undefined));
    // 이름 규칙을 어겨도 설명이 있으면 경고와 함께 싣는다
    fs.put("/r/Bad_Name/SKILL.md", skillFile("Bad_Name", "bad name"));
    const result = await loadSkillsFromDir(fs, "/r", USER);
    expect(result.skills.map((skill) => skill.name).toSorted()).toEqual([
      "Bad_Name",
      "a",
      "deep",
      "single",
    ]);
    const single = result.skills.find((skill) => skill.name === "single");
    expect(single?.layout).toBe("file");
    expect(result.skills.find((skill) => skill.name === "a")?.layout).toBe("dir");
    const messages = result.diagnostics.map((item) => `${item.path}: ${item.message}`);
    expect(messages).toContain("/r/nodesc/SKILL.md: description is required");
    expect(messages.some((m) => m.startsWith("/r/Bad_Name/SKILL.md: name contains invalid"))).toBe(
      true,
    );
  });

  test("symlinks are followed once and loops are skipped", async () => {
    const fs = createMemoryFs();
    fs.put("/r/real/SKILL.md", skillFile("real", "the real one"));
    fs.symlink("/r/alias", "/r/real");
    fs.put("/r/g/inside/SKILL.md", skillFile("inside", "inside g"));
    fs.symlink("/r/g/loop", "/r/g");
    fs.symlink("/r/broken", "/r/missing");
    const result = await loadSkills(fs, { user: "/r", extension: [], paths: [] });
    expect(result.skills.map((skill) => skill.name).toSorted()).toEqual(["inside", "real"]);
    // 같은 실제 파일은 조용히 한 번만 싣는다: 충돌 진단이 없다
    expect(result.diagnostics.filter((item) => item.type === "collision")).toEqual([]);
    expect(result.diagnostics.some((item) => item.message === "symlink loop skipped")).toBe(true);
  });

  test("frontmatter parse via Bun.YAML", () => {
    const plain = parseFrontmatter("---\nname: x\ndescription: hello\n---\nbody\n");
    expect(plain).toEqual({
      ok: true,
      value: { frontmatter: { name: "x", description: "hello" }, body: "body" },
    });
    // BOM과 CRLF
    const windows = parseFrontmatter(
      `${String.fromCodePoint(0xfeff)}---\r\nname: x\r\ndescription: hi\r\n---\r\nline\r\n`,
    );
    expect(windows).toEqual({
      ok: true,
      value: { frontmatter: { name: "x", description: "hi" }, body: "line" },
    });
    // 프론트매터가 없으면 빈 객체
    expect(parseFrontmatter("# just text\n")).toEqual({
      ok: true,
      value: { frontmatter: {}, body: "# just text\n" },
    });
    // 순환 별칭은 오류다
    const cyclic = parseFrontmatter("---\nname: x\ndescription: &d\n  self: *d\n---\nbody\n");
    expect(cyclic).toEqual({ ok: false, error: { kind: "frontmatter_cyclic" } });
    // 매핑이 아닌 값
    expect(parseFrontmatter("---\n- a\n- b\n---\nbody\n")).toEqual({
      ok: false,
      error: { kind: "frontmatter_not_object" },
    });
    const broken = parseFrontmatter("---\nname: [unclosed\n---\nbody\n");
    expect(broken.ok ? "ok" : broken.error.kind).toBe("frontmatter_yaml");
  });

  test("a cyclic frontmatter is a diagnostic, not a skill", async () => {
    const fs = createMemoryFs();
    fs.put("/r/x/SKILL.md", "---\nname: x\ndescription: &d\n  self: *d\n---\nbody\n");
    const result = await loadSkillsFromDir(fs, "/r", USER);
    expect(result.skills).toEqual([]);
    expect(result.diagnostics[0]?.path).toBe("/r/x/SKILL.md");
    expect(result.diagnostics[0]?.type).toBe("warning");
  });

  test("root order project first", async () => {
    const fs = createMemoryFs();
    fs.put("/proj/same/SKILL.md", skillFile("same", "from project"));
    fs.put("/user/same/SKILL.md", skillFile("same", "from user"));
    fs.put("/user/only-user/SKILL.md", skillFile("only-user", "user only"));
    fs.put("/ext/same/SKILL.md", skillFile("same", "from extension"));
    fs.put("/extra/same/SKILL.md", skillFile("same", "from path"));
    const result = await loadSkills(fs, {
      project: "/proj",
      user: "/user",
      extension: [{ dir: "/ext", extension: "demo" }],
      paths: ["/extra"],
    });
    const same = result.skills.find((skill) => skill.name === "same");
    expect(same?.source.scope).toBe("project");
    expect(same?.description).toBe("from project");
    expect(result.skills.map((skill) => skill.name).toSorted()).toEqual(["only-user", "same"]);
    const collisions = result.diagnostics.filter((item) => item.type === "collision");
    expect(collisions.map((item) => item.path).toSorted()).toEqual([
      "/ext/same/SKILL.md",
      "/extra/same/SKILL.md",
      "/user/same/SKILL.md",
    ]);
  });

  test("configured paths accept directories and markdown files only", async () => {
    const fs = createMemoryFs();
    fs.put("/p/dir-skill/SKILL.md", skillFile("dir-skill", "in a directory"));
    fs.put("/p/file.md", skillFile("file-skill", "a single file"));
    fs.put("/p/data.txt", "text");
    const result = await loadSkills(fs, {
      user: "/nowhere",
      extension: [],
      paths: ["/p", "/p/file.md", "/p/data.txt", "/missing", "relative/dir"],
    });
    expect(result.skills.map((skill) => skill.name).toSorted()).toEqual([
      "dir-skill",
      "file-skill",
    ]);
    const messages = result.diagnostics.map((item) => item.message);
    expect(messages).toContain("skill path is not a markdown file");
    expect(messages).toContain("skill path does not exist");
    expect(messages).toContain("skill path must be absolute");
    // 같은 파일이 디렉터리 경로와 파일 경로로 두 번 오면 한 번만 싣는다
    expect(result.skills.filter((skill) => skill.name === "file-skill")).toHaveLength(1);
  });

  test("results do not depend on entry order or timing", async () => {
    const first = await loadSkillsFromDir(threeSkills(), "/r", USER);
    const second = await loadSkillsFromDir(threeSkills(), "/r", USER);
    expect(first.skills.map((skill) => skill.name)).toEqual(["alpha", "mid", "zeta"]);
    expect(second.skills.map((skill) => skill.filePath)).toEqual(
      first.skills.map((skill) => skill.filePath),
    );
  });
});
