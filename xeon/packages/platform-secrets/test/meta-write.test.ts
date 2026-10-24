import { afterEach, describe, expect, test } from "bun:test";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createMetaStore, serializeMeta } from "../src/meta.ts";
import { metaOf } from "./support/meta.ts";
import { nameOf, handleOf } from "./support/names.ts";
import { tempDir, type TempDir } from "./support/os.ts";

// plan SC-02(M2) 쓰기. 0600, 원자 쓰기, 읽기와 왕복.

const dirs: TempDir[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => dir.remove()));
});

async function store() {
  const dir = await tempDir();
  dirs.push(dir);
  const metaDir = dir.join("secrets", "meta");
  return { dir, metaDir, store: createMetaStore(metaDir) };
}

describe("meta writes (spec §3.2)", () => {
  test("writes with mode 0600 and the file reads back to the same meta", async () => {
    const { store: metas, metaDir } = await store();
    const meta = metaOf({
      origins: ["https://login.example.test"],
      commands: ["gh api *"],
      expiresAt: "2026-12-31",
      approval: "per-use",
      desc: "토큰: 줄바꿈 없는 설명 # 주석처럼 보이는 글자",
    });
    expect(await metas.write(meta, { overwrite: false })).toEqual({ ok: true, value: undefined });
    const path = `${metaDir}/github-token.yaml`;
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const entry = await metas.get(nameOf("github-token"));
    expect(entry).toEqual({ kind: "ok", name: nameOf("github-token"), meta });
    const list = await metas.list();
    expect(list.map((e) => e.kind)).toEqual(["ok"]);
    expect((await readFile(path, "utf8")).startsWith("# Xeon")).toBe(true);
    expect(serializeMeta(meta)).toBe(await readFile(path, "utf8"));
  });

  test("creating an existing name is already_exists and leaves the file alone; overwrite replaces it", async () => {
    const { store: metas, metaDir } = await store();
    await metas.write(metaOf({ desc: "first" }), { overwrite: false });
    const again = await metas.write(metaOf({ desc: "second" }), { overwrite: false });
    expect(again).toEqual({
      ok: false,
      error: { kind: "already_exists", handle: handleOf("github-token") },
    });
    const kept = await metas.get(nameOf("github-token"));
    expect(kept?.kind === "ok" && kept.meta.desc).toBe("first");
    expect((await metas.write(metaOf({ desc: "third" }), { overwrite: true })).ok).toBe(true);
    const replaced = await metas.get(nameOf("github-token"));
    expect(replaced?.kind === "ok" && replaced.meta.desc).toBe("third");
    // 임시 파일이 남지 않는다
    expect(await readdir(metaDir)).toEqual(["github-token.yaml"]);
  });

  test("remove deletes the file and reports whether it existed", async () => {
    const { store: metas } = await store();
    await metas.write(metaOf(), { overwrite: false });
    expect(await metas.remove(nameOf("github-token"))).toEqual({ ok: true, value: true });
    expect(await metas.get(nameOf("github-token"))).toBeNull();
    expect(await metas.remove(nameOf("github-token"))).toEqual({ ok: true, value: false });
  });

  test("an unwritable location is meta_invalid with the cause code only", async () => {
    const dir = await tempDir();
    dirs.push(dir);
    await writeFile(dir.join("secrets"), "a file where a directory should be");
    const metas = createMetaStore(dir.join("secrets", "meta"));
    const result = await metas.write(metaOf(), { overwrite: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ kind: "meta_invalid", name: "github-token" });
    }
  });
});
