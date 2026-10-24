import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";

// L2.knowledge.plan §4.1 포크 기록(adr.0003 §3.4). PATCHES.md 표의 id, UPSTREAM.json modifications, 소스의 XEON-PATCH 표지 id
// 집합이 같아야 한다.

const PACKAGE = join(import.meta.dir, "..");
const MARKER = /\/\/ XEON-PATCH: (KN-\d+)\b/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

function sourceFiles(): string[] {
  return ["src", "test"].flatMap((root) => walk(join(PACKAGE, root)));
}

function asRecord(value: unknown, what: string): Map<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} is not an object`);
  }
  return new Map(Object.entries(value));
}

function asStrings(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${what} is not an array`);
  return value.map((item) => String(item));
}

function readUpstream(): {
  readonly commit: string;
  readonly copiedPaths: readonly string[];
  readonly modifications: readonly string[];
  readonly originalSha256: ReadonlyMap<string, unknown>;
} {
  const record = asRecord(
    JSON.parse(readFileSync(join(PACKAGE, "UPSTREAM.json"), "utf8")),
    "UPSTREAM.json",
  );
  return {
    commit: String(record.get("commit")),
    copiedPaths: asStrings(record.get("copiedPaths"), "copiedPaths"),
    modifications: asStrings(record.get("modifications"), "modifications"),
    originalSha256: asRecord(record.get("originalSha256"), "originalSha256"),
  };
}

function idOf(match: RegExpExecArray): string {
  return match[1] ?? "";
}

function patchTable(): string[] {
  return readFileSync(join(PACKAGE, "PATCHES.md"), "utf8")
    .split("\n")
    .map((line) => /^\| (KN-\d+) \|/.exec(line))
    .filter((match) => match !== null)
    .map(idOf);
}

function markers(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const path of sourceFiles()) {
    const ids = Array.from(readFileSync(path, "utf8").matchAll(MARKER), (match) => match[1] ?? "");
    if (ids.length > 0) found.set(relative(PACKAGE, path), ids);
  }
  return found;
}

describe("fork records", () => {
  test("fork records agree", () => {
    const table = patchTable();
    const marked = new Set(Array.from(markers().values()).flat());
    expect(readUpstream().modifications.toSorted()).toEqual(table.toSorted());
    expect(Array.from(marked).toSorted()).toEqual(table.toSorted());
  });

  test("every file with a marker is a copied path", () => {
    const copied = new Set(readUpstream().copiedPaths.map((entry) => entry.split(" -> ")[1] ?? ""));
    for (const file of markers().keys()) expect(copied.has(file)).toBe(true);
  });

  test("copied paths exist and carry the pinned commit and original hashes", () => {
    const upstream = readUpstream();
    expect(upstream.commit).toBe("cdaf6c227d4718a72b59ccd02152c9614df44cfc");
    for (const entry of upstream.copiedPaths) {
      const [from = "", to = ""] = entry.split(" -> ");
      expect(existsSync(join(PACKAGE, to))).toBe(true);
      expect(String(upstream.originalSha256.get(from))).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(readFileSync(join(PACKAGE, "LICENSE.pi"), "utf8")).toContain("MIT License");
  });

  test("the fork imports neither ignore nor yaml and uses no node:fs (DR-13)", () => {
    const fork = readFileSync(join(PACKAGE, "src/upstream/skills.ts"), "utf8");
    expect(fork).not.toMatch(/from ['"](?:ignore|yaml)['"]/);
    expect(fork).not.toMatch(/node:fs|from ['"]fs['"]/);
    const manifest = readFileSync(join(PACKAGE, "package.json"), "utf8");
    expect(manifest).not.toContain('"ignore"');
    expect(manifest).not.toContain('"yaml"');
  });

  test("only fs/node-fs.ts touches node:fs", () => {
    const offenders = sourceFiles()
      .filter((path) => relative(PACKAGE, path).startsWith("src"))
      .filter((path) => /from "node:fs/.test(readFileSync(path, "utf8")))
      .map((path) => relative(PACKAGE, path));
    expect(offenders).toEqual(["src/fs/node-fs.ts"]);
  });
});
