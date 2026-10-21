import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";

// L0.exec.plan EX-11. PATCHES.md 표의 id, UPSTREAM.json modifications, 소스의 XEON-PATCH 표지 id 집합이 같아야 한다.

const PACKAGE = join(import.meta.dir, "..");
const MARKER = /\/\/ XEON-PATCH: (P\d+)\b/g;
const CHORD_IMPORT = /from ['"][^'"]*chord|import\(['"][^'"]*chord|require\(['"][^'"]*chord/;

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

/** PATCHES.md 패치 표의 행 id. `(예약)` 행은 쓰지 않은 번호라 따로 가른다 */
function patchTable(): { readonly used: string[]; readonly reserved: string[] } {
  const rows = readFileSync(join(PACKAGE, "PATCHES.md"), "utf8")
    .split("\n")
    .map((line) => /^\| (P\d+) \| (.*)$/.exec(line))
    .filter((match) => match !== null);
  return {
    used: rows.filter((match) => !(match[2] ?? "").startsWith("(예약)")).map(idOf),
    reserved: rows.filter((match) => (match[2] ?? "").startsWith("(예약)")).map(idOf),
  };
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
    expect(readUpstream().modifications.toSorted()).toEqual(table.used.toSorted());
    expect(Array.from(marked).toSorted()).toEqual(table.used.toSorted());
    for (const id of table.reserved) expect(marked.has(id)).toBe(false);
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
      if (from.startsWith("packages/durable/")) {
        expect(String(upstream.originalSha256.get(from))).toMatch(/^[0-9a-f]{64}$/);
      }
    }
    expect(readFileSync(join(PACKAGE, "LICENSE.pi"), "utf8")).toContain("MIT License");
  });

  test("no chord import remains", () => {
    const offenders = sourceFiles().flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          CHORD_IMPORT.test(line) ? [`${relative(PACKAGE, path)}:${index + 1}`] : [],
        ),
    );
    expect(offenders).toEqual([]);
    expect(readFileSync(join(PACKAGE, "package.json"), "utf8").toLowerCase()).not.toContain(
      "chord",
    );
  });
});
