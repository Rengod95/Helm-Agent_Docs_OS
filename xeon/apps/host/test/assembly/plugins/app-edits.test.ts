import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { createAppEditLedger } from "../../../src/assembly/plugins/app-edits.ts";
import { hashPluginTree } from "../../../src/assembly/plugins/content-hash.ts";

// AGE-33. 앱의 편집 통신이 쓴 폴더의 해시 장부.

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "appedit-"));
  made.push(dir);
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "a.txt"), text);
  return dir;
}

function hashOf(dir: string): string {
  const hashed = hashPluginTree(dir);
  if (!hashed.ok) throw new Error("the fixture folder cannot be hashed");
  return hashed.value.contentHash;
}

test("a marked folder's current hash is known; a different content or an unmarked folder is not", () => {
  const ledger = createAppEditLedger();
  const edited = folder("one");
  ledger.markDir(edited);
  expect(ledger.has(hashOf(edited))).toBe(true);
  writeFileSync(join(edited, "src", "a.txt"), "changed by hand");
  expect(ledger.has(hashOf(edited))).toBe(false);
  expect(ledger.has(hashOf(folder("other")))).toBe(false);
});

test("a folder that cannot be hashed marks nothing, and the oldest hashes are forgotten past the limit", () => {
  const ledger = createAppEditLedger(2);
  ledger.markDir(join(tmpdir(), "appedit-does-not-exist"));
  const [a, b, c] = [folder("a"), folder("b"), folder("c")];
  ledger.markDir(a);
  ledger.markDir(b);
  ledger.markDir(c);
  expect([a, b, c].map((dir) => ledger.has(hashOf(dir)))).toEqual([false, true, true]);
});
