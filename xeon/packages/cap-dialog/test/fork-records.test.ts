import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";

// L2.dialog.plan §4.2 포크 기록과 ADR-0003 §3.4. Chord 값 import 0건 확인을 겸한다.
// PATCHES.md 표의 id, UPSTREAM.json modifications, 소스의 XEON-PATCH 표지 id 집합이 같아야 한다.

const PACKAGE = join(import.meta.dir, "..");
const MARKER = /\/\/ XEON-PATCH: (P\d+)\b/g;
const FORBIDDEN_IMPORT =
  /from ['"][^'"]*(chord|pi-durable)|import\(['"][^'"]*(chord|pi-durable)|require\(['"][^'"]*(chord|pi-durable)/;

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

/** PATCHES.md 패치 표의 행 id */
function patchTable(): string[] {
  return readFileSync(join(PACKAGE, "PATCHES.md"), "utf8")
    .split("\n")
    .map((line) => /^\| (P\d+) \|/.exec(line))
    .filter((match) => match !== null)
    .map(idOf);
}

/** 표지가 있는 파일(패키지 기준 경로) → 그 파일의 패치 id */
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

  test("no chord or pi-durable import remains", () => {
    const offenders = sourceFiles().flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          FORBIDDEN_IMPORT.test(line) ? [`${relative(PACKAGE, path)}:${index + 1}`] : [],
        ),
    );
    expect(offenders).toEqual([]);
    const manifest = readFileSync(join(PACKAGE, "package.json"), "utf8").toLowerCase();
    expect(manifest).not.toContain("chord");
    expect(manifest).not.toContain("pi-durable");
  });

  test("the fork reads files only through the port (no node:fs or Bun.file)", () => {
    const offenders = sourceFiles()
      .filter((path) => relative(PACKAGE, path).startsWith("src"))
      .flatMap((path) =>
        readFileSync(path, "utf8")
          .split("\n")
          .flatMap((line, index) =>
            /node:fs|Bun\.file|process\.platform/.test(line)
              ? [`${relative(PACKAGE, path)}:${index + 1}`]
              : [],
          ),
      );
    expect(offenders).toEqual([]);
  });
});
