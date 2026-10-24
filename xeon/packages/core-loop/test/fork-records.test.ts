import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

// adr.0009 §3.6. PATCHES.md 표의 id, UPSTREAM.json modifications, 소스의 XEON-PATCH 표지 id 집합이 같고,
// 원본에서 옮긴 파일의 머리에 출처 주석이 있다.

const PACKAGE = join(import.meta.dir, "..");
const MARKER = /\/\/ XEON-PATCH: ([a-z-]+)\b/g;
const DERIVED_HEADER =
  /^\/\/ Derived from pi-agent-core 1\.3\.0 agent-loop\.ts [^]*?\(MIT, Copyright \(c\) 2025 Mario Zechner\)\. See LICENSE\.pi\./;

function loopSources(): readonly { readonly file: string; readonly text: string }[] {
  const dir = join(PACKAGE, "src", "loop");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ file: name, text: readFileSync(join(dir, name), "utf8") }));
}

function markerIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const { text } of loopSources()) {
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
    const match = /^\|\s*`([a-z-]+)`\s*\|/.exec(line);
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

test("files ported from the original loop carry the derivation header", () => {
  const derived = ["run-turn.ts", "stream-response.ts", "tool-batch.ts"];
  const sources = new Map(loopSources().map((entry) => [entry.file, entry.text]));
  for (const file of derived) {
    // 출처 주석은 파일 머리 세 줄 안에 있다
    const head = (sources.get(file) ?? "").split("\n").slice(0, 3).join("\n");
    expect(DERIVED_HEADER.test(head), file).toBe(true);
  }
});

test("the MIT license text of the original is kept", () => {
  const license = readFileSync(join(PACKAGE, "LICENSE.pi"), "utf8");
  expect(license).toContain("MIT License");
  expect(license).toContain("Mario Zechner");
});
