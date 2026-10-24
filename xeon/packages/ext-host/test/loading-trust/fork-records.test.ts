import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

// X.loading-trust.spec §4.7.1. PATCHES.md 표의 id, UPSTREAM.json modifications, 소스의 XEON-PATCH 표지 id 집합이 같고,
// pi에서 옮긴 파일의 머리에 출처 주석이 있다.

const PACKAGE = join(import.meta.dir, "..", "..");
const MARKER = /\/\/ XEON-PATCH: ([a-z0-9-]+)\b/g;
const FORKED: ReadonlySet<string> = new Set(["store.ts", "resources.ts", "resolve.ts"]);

function forkedSources(): readonly { readonly file: string; readonly text: string }[] {
  const dir = join(PACKAGE, "src", "loading-trust", "trust");
  return readdirSync(dir)
    .filter((name) => FORKED.has(name))
    .map((name) => ({ file: name, text: readFileSync(join(dir, name), "utf8") }));
}

function markerIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const { text } of forkedSources()) {
    for (const match of text.matchAll(MARKER)) ids.add(match[1] ?? "");
  }
  return ids;
}

function upstreamModificationIds(): ReadonlySet<string> {
  const record: unknown = JSON.parse(readFileSync(join(PACKAGE, "UPSTREAM.json"), "utf8"));
  if (typeof record !== "object" || record === null || !("modifications" in record)) {
    throw new Error("UPSTREAM.json has no modifications");
  }
  const modifications: unknown = record.modifications;
  if (!Array.isArray(modifications)) throw new Error("modifications is not an array");
  return new Set(modifications.map((entry) => String(entry).split(":")[0] ?? ""));
}

function patchTableIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const line of readFileSync(join(PACKAGE, "PATCHES.md"), "utf8").split("\n")) {
    const match = /^\|\s*`([a-z0-9-]+)`\s*\|/.exec(line);
    if (match !== null) ids.add(match[1] ?? "");
  }
  return ids;
}

test("patch ids agree between PATCHES.md, UPSTREAM.json and the source markers", () => {
  const markers = markerIds();
  expect(markers.size).toBeGreaterThan(0);
  expect([...patchTableIds()].toSorted()).toEqual([...markers].toSorted());
  expect([...upstreamModificationIds()].toSorted()).toEqual([...markers].toSorted());
});

test("forked files carry the origin header and the license is present", () => {
  const origin = /^\/\/ Forked from earendil-works\/pi packages\/coding-agent\/src\/core\//;
  const pinned = "cdaf6c227d4718a72b59ccd02152c9614df44cfc";
  for (const { file, text } of forkedSources()) {
    const head = text.split("\n").slice(0, 3).join("\n");
    expect(origin.test(head), file).toBe(true);
    expect(head, file).toContain(pinned);
    expect(head, file).toContain("MIT License, Copyright (c) 2025 Mario Zechner");
  }
  const license = readFileSync(join(PACKAGE, "LICENSE.pi"), "utf8");
  expect(license).toContain("Copyright (c) 2025 Mario Zechner");
});
