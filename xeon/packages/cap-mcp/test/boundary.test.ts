import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// L2.mcp.spec §9-10, eng.context-map.design CM-03. SDK와 zod는 어댑터 경계 파일에서만 import한다.

const SRC = join(import.meta.dir, "..", "src");
const ALLOWED = [/^adapter\.ts$/, /^transport\//, /^testing\//, /^oauth\//, /^tasks\/schemas\.ts$/];
const SDK_IMPORT = /from\s+["'](?:@modelcontextprotocol\/[^"']+|zod(?:\/[^"']*)?)["']/;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("sdk boundary", () => {
  test("sdk types stay inside adapter", () => {
    const offenders = sources(SRC)
      .map((path) => relative(SRC, path))
      .filter((path) => !ALLOWED.some((pattern) => pattern.test(path)))
      .filter((path) => SDK_IMPORT.test(readFileSync(join(SRC, path), "utf8")));
    expect(offenders).toEqual([]);
  });

  test("the boundary files do import the sdk (the scan sees real imports)", () => {
    expect(SDK_IMPORT.test(readFileSync(join(SRC, "adapter.ts"), "utf8"))).toBe(true);
  });
});
