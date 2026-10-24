import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// F.readme §3 "도메인 사이 import" 표: 각 소스 디렉터리는 자기보다 순서가 낮은 것만 import한다.
// 순서가 같은 것끼리(capabilities와 records, settings와 services)는 import하지 않는다. import type도 같다.
const SRC = resolve(import.meta.dir, "../src");

/** 소스 디렉터리 → 순서. 키는 src 기준 상대 경로 접두 */
const ORDER: ReadonlyArray<readonly [string, number]> = [
  ["base", 0],
  ["conversation", 1],
  ["capabilities", 2],
  ["records", 2],
  ["extensions", 3],
  ["wire-settings/settings", 4],
  ["services", 4],
  ["wire-settings/wire", 5],
];

function areaOf(file: string): string | undefined {
  const rel = relative(SRC, file).split("\\").join("/");
  return ORDER.find(([prefix]) => rel.startsWith(`${prefix}/`))?.[0];
}

function orderOf(area: string): number {
  return ORDER.find(([prefix]) => prefix === area)?.[1] ?? -1;
}

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listTs(path));
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"/g)) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  return found;
}

const files = listTs(SRC);

describe("F import order", () => {
  test("the order table covers every source file", () => {
    for (const file of files) {
      if (relative(SRC, file) === "index.ts") continue;
      expect({ file: relative(SRC, file), area: areaOf(file) !== undefined }).toEqual({
        file: relative(SRC, file),
        area: true,
      });
    }
  });

  test("each directory imports only lower-order directories", () => {
    const violations: string[] = [];
    for (const file of files) {
      const from = areaOf(file);
      if (from === undefined) continue;
      for (const spec of specifiers(readFileSync(file, "utf8"))) {
        if (!spec.startsWith(".")) continue;
        const target = resolve(file, "..", spec);
        const to = areaOf(target);
        if (to === undefined || to === from) continue;
        if (orderOf(to) >= orderOf(from)) {
          violations.push(`${relative(SRC, file)} -> ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test("the root entry reaches only base", () => {
    const root = readFileSync(join(SRC, "index.ts"), "utf8");
    expect(specifiers(root)).toEqual(["./base/index.ts"]);
  });

  test("no file imports cordis or pi coding-agent", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const spec of specifiers(text)) {
        expect({ file: relative(SRC, file), spec: /cordis|pi-coding-agent/.test(spec) }).toEqual({
          file: relative(SRC, file),
          spec: false,
        });
      }
    }
  });

  test("pi packages are only imported as types", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect({
        file: relative(SRC, file),
        value: /^import (?!type)[^;]*"@earendil-works\//m.test(text),
      }).toEqual({
        file: relative(SRC, file),
        value: false,
      });
    }
  });
});
