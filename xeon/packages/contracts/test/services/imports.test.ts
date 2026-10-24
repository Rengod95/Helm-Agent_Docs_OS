import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// F.capabilities.spec §3.12 규칙 4·6: services는 base, conversation, records, capabilities, extensions를 import type으로만 가져온다.
// 값 import는 typebox와 같은 서브패스의 다른 파일뿐이다. cordis와 platform-*, core-* 패키지는 import하지 않는다.
const DIR = resolve(import.meta.dir, "../../src/services");
const FILES = readdirSync(DIR).filter((name) => name.endsWith(".ts"));

function importLines(source: string): { readonly line: string; readonly spec: string }[] {
  const found: { line: string; spec: string }[] = [];
  for (const match of source.matchAll(/(^|\n)((?:import|export)\b[^;]*?\bfrom\s+"([^"]+)";)/g)) {
    if (match[2] !== undefined && match[3] !== undefined) {
      found.push({ line: match[2], spec: match[3] });
    }
  }
  return found;
}

/** 같은 서브패스 안에서 허용하는 파일 사이 import. F.capabilities.spec §3.12 규칙 4의 명시 항목 + 값 타입 공유(models→context 등) */
function localSpecs(file: string): string[] {
  const source = readFileSync(join(DIR, file), "utf8");
  return importLines(source)
    .filter(({ spec }) => spec.startsWith("./"))
    .map(({ spec }) => spec.slice(2));
}

describe("services imports", () => {
  test("type-only imports from other F directories", () => {
    const violations: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(join(DIR, file), "utf8");
      for (const { line, spec } of importLines(source)) {
        if (!spec.startsWith("..")) continue;
        const typeOnly = /^(import|export) type\b/.test(line);
        if (!typeOnly) violations.push(`${file}: ${line.split("\n")[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("only typebox is imported as a value from outside", () => {
    for (const file of FILES) {
      const source = readFileSync(join(DIR, file), "utf8");
      for (const { line, spec } of importLines(source)) {
        if (spec.startsWith(".")) continue;
        expect({ file, spec, ok: spec === "typebox" }).toEqual({ file, spec, ok: true });
        expect({
          file,
          spec,
          line: /^import type\b/.test(line) || line.includes('"typebox"'),
        }).toEqual({
          file,
          spec,
          line: true,
        });
      }
    }
  });

  test("no cordis, platform-*, core-* or xeon package imports", () => {
    for (const file of FILES) {
      const source = readFileSync(join(DIR, file), "utf8");
      for (const { spec } of importLines(source)) {
        expect({ file, bad: /cordis|@xeon\/|platform-|core-/.test(spec) }).toEqual({
          file,
          bad: false,
        });
      }
    }
  });

  test("files import each other as a directed acyclic graph", () => {
    const graph = new Map(FILES.map((file) => [file, localSpecs(file)]));
    const visiting = new Set<string>();
    const done = new Set<string>();
    const cycle: string[] = [];
    const visit = (file: string, path: readonly string[]): void => {
      if (done.has(file) || cycle.length > 0) return;
      if (visiting.has(file)) {
        cycle.push(...path, file);
        return;
      }
      visiting.add(file);
      for (const next of graph.get(file) ?? []) visit(next, [...path, file]);
      visiting.delete(file);
      done.add(file);
    };
    for (const file of FILES) visit(file, []);
    expect(cycle).toEqual([]);
  });

  test("leaf files import no sibling", () => {
    // F.capabilities.spec §3.12 규칙 4: sandbox-report, secrets, groups는 같은 서브패스의 파일을 import하지 않는다
    for (const file of ["sandbox-report.ts", "secrets.ts", "groups.ts", "names.ts"]) {
      expect({ file, local: localSpecs(file) }).toEqual({ file, local: [] });
    }
  });

  test("the listed intra-subpath imports exist", () => {
    expect(localSpecs("exec.ts").toSorted()).toEqual(["sandbox-report.ts", "secrets.ts"]);
    expect(localSpecs("sandbox.ts").toSorted()).toEqual(["exec.ts", "sandbox-report.ts"]);
    expect(localSpecs("secret-admin.ts")).toEqual(["secrets.ts"]);
    expect(localSpecs("context.ts")).toEqual(["models.ts"]);
  });

  test("shared value types are the only other sibling imports", () => {
    // F.capabilities.spec §3.12 규칙 3: 여러 서비스가 쓰는 값 타입은 원래 도메인 파일에 두고 다른 서비스 파일이 가져간다.
    // 규칙 4의 열거에 없는 이 import들은 openIssues에 [미결]로 적었다.
    expect(localSpecs("loop.ts").toSorted()).toEqual(["agents.ts", "tasks.ts", "tools.ts"]);
    expect(localSpecs("approvals.ts")).toEqual(["tools.ts"]);
    expect(localSpecs("agents.ts")).toEqual(["tools.ts"]);
    expect(localSpecs("tools.ts")).toEqual([]);
    expect(localSpecs("tasks.ts")).toEqual([]);
    expect(localSpecs("models.ts")).toEqual([]);
  });
});
