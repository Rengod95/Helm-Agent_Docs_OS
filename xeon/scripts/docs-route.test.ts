import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkDocs, countUnresolved, parseFrontmatter, routeDocs } from "./docs-route.ts";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "xeon-docs-"));
  write(
    "docs/xeon/_routing/routes.yaml",
    `version: 1
by_task:
  implement: [eng.ts.guide]
  docs: [eng.ts.guide, meta.ghost]
layout:
  L1:
    domains: [loop, tools]
    path: "xeon/packages/core-{domain}/**"
  plugins:
    - path: "xeon/plugins/p/**"
      docs: [L1.tools.spec]
manifest:
  engineering: [eng.ts.guide]
  layers: "each layer"
`,
  );
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

function doc(file: string, front: Record<string, string>): void {
  const lines = Object.entries(front).map(([key, value]) => `${key}: ${value}`);
  write(file, `---\n${lines.join("\n")}\n---\n\n# body\n`);
}

const base = { status: "draft", depends_on: "[]", binds: "[]" };

function writeValid(): void {
  doc("docs/xeon/engineering/ts/guide.md", {
    id: "eng.ts.guide",
    layer: "eng",
    domain: "ts",
    kind: "guide",
    ...base,
  });
  doc("docs/xeon/L1/README.md", {
    id: "L1.readme",
    layer: "L1",
    domain: "index",
    kind: "readme",
    ...base,
    binds: "[xeon/packages/core-*/**]",
  });
  doc("docs/xeon/L1/loop/spec.md", {
    id: "L1.loop.spec",
    layer: "L1",
    domain: "loop",
    kind: "spec",
    ...base,
    depends_on: "[eng.ts.guide]",
    binds: "[xeon/packages/core-loop/**]",
  });
  doc("docs/xeon/L1/loop/plan.md", {
    id: "L1.loop.plan",
    layer: "L1",
    domain: "loop",
    kind: "plan",
    ...base,
    binds: "[xeon/packages/core-loop/**]",
  });
  doc("docs/xeon/L1/tools/spec.md", {
    id: "L1.tools.spec",
    layer: "L1",
    domain: "tools",
    kind: "spec",
    ...base,
    binds: "[xeon/plugins/p/**]",
  });
  doc("docs/xeon/L1/tools/plan.md", {
    id: "L1.tools.plan",
    layer: "L1",
    domain: "tools",
    kind: "plan",
    ...base,
  });
}

test("parseFrontmatter reads a mapping and reports absence", () => {
  expect(parseFrontmatter("---\nid: a\ndepends_on: [b, c]\n---\nbody").front).toEqual({
    id: "a",
    depends_on: ["b", "c"],
  });
  expect(parseFrontmatter("no front matter").error).toBeDefined();
  expect(parseFrontmatter("---\n: : :\n  - [\n---\n").error).toBeDefined();
});

test("check passes for a consistent set (readme for other layers still missing)", () => {
  writeValid();
  const report = checkDocs(root, { allowMissing: true });
  expect(report.errors).toEqual([]);
  expect(report.warnings.some((w) => w.includes("meta.ghost"))).toBe(true);
});

test("check fails on missing manifest documents unless allowMissing", () => {
  writeValid();
  expect(
    checkDocs(root, { allowMissing: false }).errors.some((e) => e.includes("meta.ghost")),
  ).toBe(true);
  expect(checkDocs(root, { allowMissing: true }).errors).toEqual([]);
});

test("check reports duplicate ids", () => {
  writeValid();
  doc("docs/xeon/L1/loop/design.md", {
    id: "L1.loop.spec",
    layer: "L1",
    domain: "loop",
    kind: "design",
    ...base,
  });
  expect(
    checkDocs(root, { allowMissing: true }).errors.some((e) => e.includes("duplicate id")),
  ).toBe(true);
});

test("check reports missing required fields and bad enums", () => {
  writeValid();
  write("docs/xeon/L1/loop/design.md", "---\nid: L1.loop.design\nlayer: L1\n---\n");
  doc("docs/xeon/L1/tools/design.md", {
    id: "L1.tools.design",
    layer: "L1",
    domain: "tools",
    kind: "essay",
    status: "done",
    depends_on: "[]",
    binds: "[]",
  });
  const errors = checkDocs(root, { allowMissing: true }).errors.join("\n");
  expect(errors).toContain('field "domain" is missing');
  expect(errors).toContain('kind "essay"');
  expect(errors).toContain('status "done"');
});

test("superseded is a status value for ADRs only", () => {
  writeValid();
  doc("docs/xeon/decisions/ADR-0007-ext-points.md", {
    id: "adr.0007",
    layer: "adr",
    domain: "extension-points",
    kind: "adr",
    ...base,
    status: "superseded",
  });
  doc("docs/xeon/L1/tools/design.md", {
    id: "L1.tools.design",
    layer: "L1",
    domain: "tools",
    kind: "design",
    ...base,
    status: "superseded",
  });
  const errors = checkDocs(root, { allowMissing: true }).errors;
  expect(errors.filter((e) => e.includes("ADR-0007"))).toEqual([]);
  expect(
    errors.some(
      (e) => e.includes("L1/tools/design.md") && e.includes('allowed only for kind "adr"'),
    ),
  ).toBe(true);
});

test("check reports files without front matter", () => {
  writeValid();
  write("docs/xeon/L1/loop/notes.md", "# nothing\n");
  expect(
    checkDocs(root, { allowMissing: true }).errors.some(
      (e) => e.includes("notes.md") && e.includes("front matter missing"),
    ),
  ).toBe(true);
});

test("check reports depends_on targets that exist nowhere, but only warns for manifest ones", () => {
  writeValid();
  doc("docs/xeon/L1/loop/design.md", {
    id: "L1.loop.design",
    layer: "L1",
    domain: "loop",
    kind: "design",
    ...base,
    depends_on: "[nope.nothing.spec, meta.ghost]",
  });
  const report = checkDocs(root, { allowMissing: true });
  expect(report.errors.some((e) => e.includes("nope.nothing.spec"))).toBe(true);
  expect(report.errors.some((e) => e.includes('"meta.ghost"'))).toBe(false);
});

test("check reports binds that do not match the layout", () => {
  writeValid();
  doc("docs/xeon/L1/loop/design.md", {
    id: "L1.loop.design",
    layer: "L1",
    domain: "loop",
    kind: "design",
    ...base,
    binds: "[xeon/packages/core-ghost/**]",
  });
  expect(checkDocs(root, { allowMissing: true }).errors.some((e) => e.includes("core-ghost"))).toBe(
    true,
  );
});

test("check reports domains outside layout", () => {
  writeValid();
  doc("docs/xeon/L1/other/spec.md", {
    id: "L1.other.spec",
    layer: "L1",
    domain: "other",
    kind: "spec",
    ...base,
  });
  expect(
    checkDocs(root, { allowMissing: true }).errors.some((e) => e.includes('domain "other"')),
  ).toBe(true);
});

test("route: task docs come first, then path-bound docs with layer readme and one-step depends_on", () => {
  writeValid();
  const result = routeDocs(root, {
    tasks: ["implement"],
    inputs: ["packages/core-loop/src/turn.ts"],
  });
  expect(result.files).toEqual([
    "docs/xeon/engineering/ts/guide.md",
    "docs/xeon/L1/README.md",
    "docs/xeon/L1/loop/spec.md",
    "docs/xeon/L1/loop/plan.md",
  ]);
});

test("route: L1/loop and doc ids select the domain docs", () => {
  writeValid();
  expect(routeDocs(root, { tasks: [], inputs: ["L1/loop"] }).ids).toEqual([
    "L1.readme",
    "L1.loop.spec",
    "L1.loop.plan",
    "eng.ts.guide",
  ]);
  expect(routeDocs(root, { tasks: [], inputs: ["L1.tools.plan"] }).ids).toEqual([
    "L1.readme",
    "L1.tools.plan",
  ]);
});

test("route: plugin paths reach their bound docs and unknown paths warn", () => {
  writeValid();
  expect(routeDocs(root, { tasks: [], inputs: ["xeon/plugins/p/src/a.ts"] }).ids).toContain(
    "L1.tools.spec",
  );
  const result = routeDocs(root, { tasks: [], inputs: ["packages/nothing/src/a.ts"] });
  expect(result.files).toEqual([]);
  expect(result.warnings.length).toBe(1);
});

test("route: unknown task throws and unwritten task docs warn", () => {
  writeValid();
  expect(() => routeDocs(root, { tasks: ["bogus"], inputs: [] })).toThrow("unknown task");
  const result = routeDocs(root, { tasks: ["docs"], inputs: [] });
  expect(result.files).toEqual(["docs/xeon/engineering/ts/guide.md"]);
  expect(result.warnings.some((w) => w.includes("meta.ghost"))).toBe(true);
});

test("countUnresolved counts [미결 markers per document and skips _research and clean documents", () => {
  write("docs/xeon/L0/os/spec.md", "---\nid: x\n---\n- [미결] a\n- [미결: 사용자] b\n");
  write("docs/xeon/review/m3-plan.md", "---\nid: y\n---\n- [미결] c\n");
  write("docs/xeon/_research/notes.md", "- [미결] not counted\n");
  write("docs/xeon/clean.md", "---\nid: z\n---\nno markers\n");
  expect(countUnresolved(root)).toEqual([
    { file: "docs/xeon/L0/os/spec.md", count: 2 },
    { file: "docs/xeon/review/m3-plan.md", count: 1 },
  ]);
});
