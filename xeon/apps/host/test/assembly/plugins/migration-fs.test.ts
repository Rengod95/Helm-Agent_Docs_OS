import { afterEach, expect, test } from "bun:test";
import { realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { attemptAsync } from "@fresnel/contracts";
import { createExistenceFs, createScanFs } from "../../../src/assembly/plugins/migration-fs.ts";
import { removeTree, tempRoot, writeFiles } from "./support.ts";

// 훑기의 읽기 전용 포트(§7.4, 수용 기준 4·19). 루트 밖으로 나가는 `..`와 심볼릭 링크는 따라가지 않고,
// 감지 포트는 존재만 본다. 항목 상한을 넘으면 그 뒤의 읽기는 모두 빈 결과다.

const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) removeTree(root);
});

/** 시험 폴더 둘: 루트(읽을 자리)와 바깥(읽지 말아야 할 자리). 정규 경로로 돌려준다 */
function twoFolders(): { readonly root: string; readonly outside: string } {
  const root = tempRoot("migration-fs-root-");
  const outside = tempRoot("migration-fs-outside-");
  created.push(root, outside);
  return { root: realpathSync(root), outside: realpathSync(outside) };
}

test("inside the roots a file reads as text, a NUL file as binary, and a file past the byte limit as too_large", async () => {
  const { root } = twoFolders();
  writeFiles(root, { "a.md": "본문\n", "b.bin": "x\0y" });
  writeFileSync(join(root, "big.txt"), "0123456789");
  const guard = createScanFs([root]);
  expect(await guard.fs.readBounded(join(root, "a.md"), 100)).toEqual({
    kind: "text",
    text: "본문\n",
  });
  expect((await guard.fs.readBounded(join(root, "b.bin"), 100)).kind).toBe("binary");
  expect(await guard.fs.readBounded(join(root, "big.txt"), 4)).toEqual({ kind: "too_large" });
  const bytes = new TextEncoder().encode("본문\n").length;
  expect(await guard.fs.lstat(join(root, "a.md"))).toEqual({ kind: "file", size: bytes });
  expect((await guard.fs.lstat(root))?.kind).toBe("dir");
  expect(await guard.fs.lstat(join(root, "missing.md"))).toBeNull();
  expect((await guard.fs.listDir(root)).toSorted()).toEqual(["a.md", "b.bin", "big.txt"]);
});

test("a path that climbs out of the roots with .. is never read or listed", async () => {
  const { root, outside } = twoFolders();
  writeFiles(outside, { "secret.md": "밖\n" });
  writeFiles(root, { "a.md": "안\n" });
  const guard = createScanFs([root]);
  const climbing = join(root, "..", basenameOf(outside), "secret.md");
  expect(await guard.fs.readBounded(climbing, 100)).toEqual({ kind: "unreadable" });
  expect(await guard.fs.lstat(climbing)).toBeNull();
  expect(await guard.fs.listDir(join(root, "..", basenameOf(outside)))).toEqual([]);
});

test("a symbolic link that points outside the roots is not followed: its lstat says symlink, and reads refuse", async () => {
  const { root, outside } = twoFolders();
  writeFiles(outside, { "secret.md": "밖\n" });
  symlinkSync(join(outside, "secret.md"), join(root, "link.md"));
  symlinkSync(outside, join(root, "linkdir"));
  const guard = createScanFs([root]);
  expect((await guard.fs.lstat(join(root, "link.md")))?.kind).toBe("symlink");
  expect(await guard.fs.readBounded(join(root, "link.md"), 100)).toEqual({ kind: "unreadable" });
  expect(await guard.fs.listDir(join(root, "linkdir"))).toEqual([]);
  // 밖의 파일이 심볼릭 폴더 밑에 있어도 lstat이 보지 못한다
  expect(await guard.fs.lstat(join(root, "linkdir", "secret.md"))).toBeNull();
  const refused = await attemptAsync(() => guard.fs.realpath(join(root, "link.md")));
  expect(refused.ok).toBe(false);
});

test("a symbolic link that stays inside the roots is read through, to the real file", async () => {
  const { root } = twoFolders();
  writeFiles(root, { "a.md": "안\n" });
  symlinkSync(join(root, "a.md"), join(root, "inner.md"));
  const guard = createScanFs([root]);
  expect(await guard.fs.readBounded(join(root, "inner.md"), 100)).toEqual({
    kind: "text",
    text: "안\n",
  });
  expect(await guard.fs.realpath(join(root, "inner.md"))).toBe(join(root, "a.md"));
});

test("past the entry limit every later read is empty, and the guard reports that the limit was reached", async () => {
  const { root } = twoFolders();
  writeFiles(root, { "a.md": "1\n", "b.md": "2\n", "c.md": "3\n" });
  const guard = createScanFs([root], 2);
  expect(await guard.fs.lstat(join(root, "a.md"))).not.toBeNull();
  expect(await guard.fs.lstat(join(root, "b.md"))).not.toBeNull();
  expect(guard.limitReached()).toBe(false);
  expect(await guard.fs.lstat(join(root, "c.md"))).toBeNull();
  expect(guard.limitReached()).toBe(true);
  expect(await guard.fs.readBounded(join(root, "a.md"), 100)).toEqual({ kind: "unreadable" });
  expect(await guard.fs.listDir(root)).toEqual([]);
});

test("the existence port sees files and folders above the roots, and reads nothing", async () => {
  const { root } = twoFolders();
  writeFiles(root, { "a.md": "안\n", ".agents/skills/x/SKILL.md": "x\n" });
  const existence = createExistenceFs();
  expect((await existence.lstat(join(root, ".agents", "skills")))?.kind).toBe("dir");
  expect(await existence.lstat(join(root, "nothing"))).toBeNull();
  expect(await existence.listDir(root)).toEqual([]);
  expect(await existence.readBounded(join(root, "a.md"), 100)).toEqual({ kind: "unreadable" });
  const resolved = await attemptAsync(() => existence.realpath(root));
  expect(resolved.ok).toBe(false);
});

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
