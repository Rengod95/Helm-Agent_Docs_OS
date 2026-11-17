import { createHash } from "node:crypto";
import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { hashPluginTree } from "../../../src/assembly/plugins/content-hash.ts";
import { removeTree, tempRoot, writeFiles } from "./support.ts";

// M5c §4.6.1: 내용 해시. 같은 내용이면 나열 순서와 mtime과 무관하게 같은 값이다.

const roots: string[] = [];
function fresh(): string {
  const root = tempRoot("plugin-hash-");
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) removeTree(root);
});

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

test("같은 내용은 쓴 순서가 달라도 같은 해시다", () => {
  const a = fresh();
  const b = fresh();
  writeFiles(a, { "one.md": "1", "dir/two.md": "2", "three.txt": "3" });
  writeFiles(b, { "three.txt": "3", "dir/two.md": "2", "one.md": "1" });
  const left = hashPluginTree(a);
  const right = hashPluginTree(b);
  expect(left.ok && right.ok).toBe(true);
  if (!left.ok || !right.ok) return;
  expect(left.value.contentHash).toBe(right.value.contentHash);
});

test("mtime을 바꿔도 해시는 같다", () => {
  const root = fresh();
  writeFiles(root, { "a.md": "same" });
  const before = hashPluginTree(root);
  utimesSync(join(root, "a.md"), new Date(0), new Date(0));
  const after = hashPluginTree(root);
  expect(before.ok && after.ok).toBe(true);
  if (!before.ok || !after.ok) return;
  expect(after.value.contentHash).toBe(before.value.contentHash);
});

test("해시 형식과 줄 형식이 §4.6.1과 같다", () => {
  const root = fresh();
  writeFiles(root, { "b.txt": "bee", "a.txt": "ay" });
  const result = hashPluginTree(root);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const body = `a.txt\0-\0${sha("ay")}\nb.txt\0-\0${sha("bee")}\n`;
  expect(result.value.contentHash).toBe(`sha256:${sha(body)}`);
  expect(result.value.files).toEqual([
    { path: "a.txt", bytes: 2, sha256: sha("ay"), executable: false },
    { path: "b.txt", bytes: 3, sha256: sha("bee"), executable: false },
  ]);
});

test("파일 이름을 바꾸면 해시가 바뀐다", () => {
  const a = fresh();
  const b = fresh();
  writeFiles(a, { "x.md": "v" });
  writeFiles(b, { "y.md": "v" });
  const left = hashPluginTree(a);
  const right = hashPluginTree(b);
  expect(left.ok && right.ok).toBe(true);
  if (!left.ok || !right.ok) return;
  expect(left.value.contentHash).not.toBe(right.value.contentHash);
});

test("실행 비트가 있으면 x가 들고 해시가 바뀐다", () => {
  const plain = fresh();
  const exec = fresh();
  writeFiles(plain, { "run.sh": "echo" });
  writeFiles(exec, { "run.sh": "echo" }, ["run.sh"]);
  const left = hashPluginTree(plain);
  const right = hashPluginTree(exec);
  expect(left.ok && right.ok).toBe(true);
  if (!left.ok || !right.ok) return;
  expect(left.value.contentHash).not.toBe(right.value.contentHash);
  expect(right.value.files[0]?.executable).toBe(true);
  expect(left.value.files[0]?.executable).toBe(false);
});

test("제외 목록(.git, .hg, .svn, .DS_Store)은 해시에 들지 않고 빈 폴더도 세지 않는다", () => {
  const plain = fresh();
  const noisy = fresh();
  writeFiles(plain, { "a.md": "a" });
  writeFiles(noisy, {
    "a.md": "a",
    ".git/HEAD": "ref",
    ".hg/store": "x",
    ".svn/entries": "y",
    ".DS_Store": "z",
    "sub/.DS_Store": "z",
  });
  mkdirSync(join(noisy, "empty"));
  const left = hashPluginTree(plain);
  const right = hashPluginTree(noisy);
  expect(left.ok && right.ok).toBe(true);
  if (!left.ok || !right.ok) return;
  expect(right.value.contentHash).toBe(left.value.contentHash);
  expect(right.value.files.map((file) => file.path)).toEqual(["a.md"]);
});

test("NFD로 저장된 이름도 NFC 경로로 해시된다", () => {
  const root = fresh();
  const decomposed = "é.md";
  writeFileSync(join(root, decomposed), "x");
  const result = hashPluginTree(root);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.files.map((file) => file.path)).toEqual(["é.md"]);
});

test("심볼릭 링크는 따라가지 않고 거절한다", () => {
  const root = fresh();
  const outside = fresh();
  writeFiles(outside, { "secret.md": "s" });
  writeFiles(root, { "a.md": "a" });
  symlinkSync(join(outside, "secret.md"), join(root, "link.md"));
  const result = hashPluginTree(root);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toEqual({ kind: "symlink_refused", path: "link.md" });
});

test("node_modules가 있으면 거절한다", () => {
  const root = fresh();
  writeFiles(root, { "node_modules/pkg/index.js": "x" });
  const result = hashPluginTree(root);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toEqual({ kind: "node_modules_present", path: "node_modules" });
});

test("파일 수 상한을 넘으면 too_large(files)다", () => {
  const root = fresh();
  writeFiles(root, { "a.md": "a", "b.md": "b", "c.md": "c" });
  const result = hashPluginTree(root, { maxFiles: 2 });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toEqual({ kind: "too_large", limit: "files" });
});

test("합계 크기 상한을 넘으면 too_large(bytes)다", () => {
  const root = fresh();
  writeFiles(root, { "a.md": "12345", "b.md": "12345" });
  const result = hashPluginTree(root, { maxBytes: 9 });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toEqual({ kind: "too_large", limit: "bytes" });
});

/** `depth`단계 디렉터리 아래의 파일 경로 */
function nestedPath(depth: number): string {
  return `${Array.from({ length: depth }, () => "d").join("/")}/leaf.md`;
}

test("깊이 상한: 16단계 디렉터리는 통과하고 17단계는 too_large(depth)다", () => {
  const deep = fresh();
  const tooDeep = fresh();
  writeFiles(deep, { [nestedPath(16)]: "x" });
  writeFiles(tooDeep, { [nestedPath(17)]: "x" });
  expect(hashPluginTree(deep).ok).toBe(true);
  const result = hashPluginTree(tooDeep);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toEqual({ kind: "too_large", limit: "depth" });
});

test("루트가 링크면 거절하고, 없는 폴더는 read_failed다", () => {
  const real = fresh();
  writeFiles(real, { "a.md": "a" });
  const link = `${real}-link`;
  symlinkSync(real, link);
  roots.push(link);
  const linked = hashPluginTree(link);
  expect(linked.ok).toBe(false);
  if (linked.ok) return;
  expect(linked.error.kind).toBe("symlink_refused");

  const missing = hashPluginTree(join(real, "no-such-dir"));
  expect(missing.ok).toBe(false);
  if (missing.ok) return;
  expect(missing.error.kind).toBe("read_failed");
});
