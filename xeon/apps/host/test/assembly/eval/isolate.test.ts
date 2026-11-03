import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { Bug } from "@fresnel/contracts";
import { createIsolatedWorkspace, digestTree } from "../../../src/assembly/eval/isolate.ts";

// T-TEST-ISO: 비교 실행은 복사본에서 돈다. 복사본을 고쳐도 원래 폴더의 해시는 그대로이고, 끝나면 복사본이 지워진다.

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function source(): string {
  const dir = mkdtempSync(join(tmpdir(), "eval-source-"));
  roots.push(dir);
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "README.md"), "hello\n");
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "node_modules", "dep.js"), "skip me\n");
  return dir;
}

function digestOf(dir: string): string {
  const digest = digestTree(dir);
  if (!digest.ok) throw new Bug("the tree must be readable");
  return digest.value;
}

test("changing the copy leaves the original byte for byte, and dispose removes the copy", () => {
  const original = source();
  const before = digestOf(original);
  const copy = createIsolatedWorkspace(original);
  if (!copy.ok) throw new Bug("the copy must succeed");
  const { dir } = copy.value;
  roots.push(dir);
  expect(readFileSync(join(dir, "src", "a.ts"), "utf8")).toBe("export const a = 1;\n");
  // 의존 폴더는 복사하지 않는다
  expect(existsSync(join(dir, "node_modules"))).toBe(false);
  expect(digestOf(dir)).toBe(before);

  writeFileSync(join(dir, "src", "a.ts"), "export const a = 2;\n");
  writeFileSync(join(dir, "new.txt"), "created by the run\n");
  expect(digestOf(dir)).not.toBe(before);
  expect(digestOf(original)).toBe(before);
  expect(existsSync(join(original, "new.txt"))).toBe(false);

  copy.value.dispose();
  copy.value.dispose();
  expect(existsSync(dir)).toBe(false);
});

test("a missing source is an io error value, not a throw", () => {
  const copy = createIsolatedWorkspace(join(tmpdir(), "eval-source-that-does-not-exist"));
  expect(copy.ok).toBe(false);
  expect(!copy.ok && copy.error.kind).toBe("io");
});
