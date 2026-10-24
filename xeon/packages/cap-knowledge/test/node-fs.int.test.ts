import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createNodeFs } from "../src/fs/node-fs.ts";
import { loadSkills } from "../src/upstream/skills.ts";
import { readDirTree, treeHash } from "../src/skills/tree.ts";
import { applyTree } from "../src/ledger/target.ts";
import { manualClock } from "./support/clock.ts";
import { treeFrom } from "./support/helpers.ts";

// 실제 임시 디렉터리에서 node:fs 구현을 확인한다(L2.knowledge.plan §5 int 태그). 프로세스 사이 락은 엔진 임대가 맡으므로
// 락 시험은 같은 프로세스 안의 직렬화만 본다(L2.knowledge.spec §4.3.3).

const dirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "xeon-knowledge-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("node fs", () => {
  test("writeAtomic replaces a file and leaves no temp file behind", async () => {
    const root = tmp();
    const fs = createNodeFs();
    const path = join(root, "USER.md");
    expect((await fs.writeAtomic(path, new TextEncoder().encode("one"))).ok).toBe(true);
    expect((await fs.writeAtomic(path, new TextEncoder().encode("two"))).ok).toBe(true);
    const read = await fs.readFile(path);
    expect(read.ok && new TextDecoder().decode(read.value)).toBe("two");
    expect(readdirSync(root)).toEqual(["USER.md"]);
    const missingParent = await fs.writeAtomic(join(root, "none", "x.md"), new Uint8Array());
    expect(missingParent.ok ? "ok" : missingParent.error.kind).toBe("not_found");
    expect(readdirSync(root)).toEqual(["USER.md"]);
  });

  test("list sorts by bytes and reports links without following them", async () => {
    const root = tmp();
    const fs = createNodeFs();
    writeFileSync(join(root, "b.md"), "b");
    writeFileSync(join(root, "a.md"), "a");
    mkdirSync(join(root, "dir"));
    symlinkSync(join(root, "a.md"), join(root, "link"));
    const listed = await fs.list(root);
    expect(listed.ok && listed.value).toEqual([
      { name: "a.md", kind: "file" },
      { name: "b.md", kind: "file" },
      { name: "dir", kind: "directory" },
      { name: "link", kind: "symlink" },
    ]);
    const stat = await fs.stat(join(root, "link"));
    expect(stat.ok && stat.value.kind).toBe("file");
    const missing = await fs.list(join(root, "none"));
    expect(missing.ok ? "ok" : missing.error.kind).toBe("not_found");
  });

  test("rename refuses to overwrite and archive moves a skill directory", async () => {
    const root = tmp();
    const fs = createNodeFs();
    const clock = manualClock();
    const skill = join(root, "skills", "deploy");
    const target = { kind: "skill" as const, name: "deploy", scope: "user" as const, path: skill };
    const tree = treeFrom({
      "SKILL.md": "---\nname: deploy\ndescription: d\n---\nb\n",
      "references/a.md": "A",
    });
    expect((await applyTree(fs, target, null, tree, "archive", clock)).ok).toBe(true);
    const written = await readDirTree(fs, skill);
    expect(written.ok && treeHash(written.value)).toBe(treeHash(tree));

    expect((await applyTree(fs, target, tree, null, "archive", clock)).ok).toBe(true);
    const gone = await fs.stat(skill);
    expect(gone.ok ? "ok" : gone.error.kind).toBe("not_found");
    const archives = readdirSync(join(root, "skills", ".archive"));
    expect(archives).toHaveLength(1);
    expect(archives[0]).toMatch(/^deploy-\d{8}T\d{6}Z$/);

    // 같은 초에 다시 만들고 다시 보관하면 번호가 붙은 새 이름으로 간다
    expect((await applyTree(fs, target, null, tree, "archive", clock)).ok).toBe(true);
    expect((await applyTree(fs, target, tree, null, "archive", clock)).ok).toBe(true);
    expect(readdirSync(join(root, "skills", ".archive")).toSorted()).toEqual(
      [archives[0] ?? "", `${archives[0] ?? ""}-2`].toSorted(),
    );
    const clash = await fs.rename(join(root, "skills", ".archive"), join(root, "skills"));
    expect(clash.ok ? "ok" : clash.error.kind).toBe("exists");
  });

  test("applyTree writes changed files only and removes stale ones", async () => {
    const root = tmp();
    const fs = createNodeFs();
    const clock = manualClock();
    const skill = join(root, "deploy");
    const target = { kind: "skill" as const, name: "deploy", scope: "user" as const, path: skill };
    const v1 = treeFrom({ "SKILL.md": "one", "references/a.md": "A", "scripts/x.sh": "x" });
    const v2 = treeFrom({ "SKILL.md": "two", "references/a.md": "A" });
    await applyTree(fs, target, null, v1, "archive", clock);
    await applyTree(fs, target, v1, v2, "archive", clock);
    const after = await readDirTree(fs, skill);
    expect(after.ok && treeHash(after.value)).toBe(treeHash(v2));
  });

  test("real discovery follows a linked skill directory once", async () => {
    const root = tmp();
    const fs = createNodeFs();
    mkdirSync(join(root, "skills", "real"), { recursive: true });
    writeFileSync(
      join(root, "skills", "real", "SKILL.md"),
      "---\nname: real\ndescription: real one\n---\nb\n",
    );
    symlinkSync(join(root, "skills", "real"), join(root, "skills", "alias"));
    symlinkSync(join(root, "skills"), join(root, "skills", "real", "loop"));
    const result = await loadSkills(fs, { user: join(root, "skills"), extension: [], paths: [] });
    expect(result.skills.map((skill) => skill.name)).toEqual(["real"]);
    expect(result.diagnostics.filter((item) => item.type === "collision")).toEqual([]);
  });

  test("withLock serializes work on the same key and lets different keys overlap", async () => {
    const fs = createNodeFs();
    const order: string[] = [];
    const slow = fs.withLock("k", async () => {
      order.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("a-end");
      return "a";
    });
    const queued = fs.withLock("k", () => {
      order.push("b");
      return Promise.resolve("b");
    });
    const other = fs.withLock("other", () => {
      order.push("other");
      return Promise.resolve("o");
    });
    expect(await Promise.all([slow, queued, other])).toEqual(["a", "b", "o"]);
    expect(order.indexOf("other")).toBeLessThan(order.indexOf("a-end"));
    expect(order.indexOf("a-end")).toBeLessThan(order.indexOf("b"));
    // run이 던져도 다음 대기자는 이어서 돈다
    const failing = fs.withLock("k", () => Promise.reject(new Error("boom")));
    const after = fs.withLock("k", () => Promise.resolve("ok"));
    const thrown = await failing.then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(thrown).toBeInstanceOf(Error);
    expect(await after).toBe("ok");
  });
});
