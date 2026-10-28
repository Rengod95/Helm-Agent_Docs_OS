import { expect, test } from "bun:test";
import { scanDriveSource } from "../src/testing/index.ts";

const IO = "Direct I/O is not allowed in drive; use the effects of ADR-0015 §3.2.";

test("scan.clean-drive-has-no-findings", () => {
  const source = `export function setup(g) {
  g.drive(async (loop, state) => {
    await loop.turn({ input: { kind: "user", content: "x" } });
    await g.commit({ n: state.n + 1 });
  });
}`;
  expect(scanDriveSource(source)).toEqual([]);
});

test("scan.finds-each-forbidden-call-with-position-and-message", () => {
  const source = `g.drive(async () => {
  const a = Date.now();
  const b = new Date();
  const c = Math.random();
  const d = crypto.randomUUID();
  crypto.getRandomValues(new Uint8Array(1));
  const e = performance.now();
  await fetch("https://example.test");
  Bun.file("a");
  Bun.write("a", "b");
  Bun.spawn(["ls"]);
});`;
  expect(scanDriveSource(source)).toEqual([
    {
      code: "SD-01",
      severity: "error",
      line: 2,
      column: 13,
      target: "Date.now",
      message: "Inject Clock (eng.typescript.guide TY-21).",
    },
    {
      code: "SD-02",
      severity: "error",
      line: 3,
      column: 13,
      target: "new Date()",
      message: "Inject Clock (TY-21).",
    },
    {
      code: "SD-03",
      severity: "error",
      line: 4,
      column: 13,
      target: "Math.random",
      message: "Inject RandomSource (TY-21).",
    },
    {
      code: "SD-04",
      severity: "error",
      line: 5,
      column: 13,
      target: "crypto.randomUUID",
      message: "Use IdFactory (TY-21).",
    },
    {
      code: "SD-05",
      severity: "error",
      line: 6,
      column: 3,
      target: "crypto.getRandomValues",
      message: "Inject RandomSource (TY-21).",
    },
    {
      code: "SD-06",
      severity: "error",
      line: 7,
      column: 13,
      target: "performance.now",
      message: "Inject Clock (TY-21).",
    },
    { code: "SD-07", severity: "error", line: 8, column: 9, target: "fetch", message: IO },
    { code: "SD-08", severity: "error", line: 9, column: 3, target: "Bun.file", message: IO },
    { code: "SD-08", severity: "error", line: 10, column: 3, target: "Bun.write", message: IO },
    { code: "SD-09", severity: "error", line: 11, column: 3, target: "Bun.spawn", message: IO },
  ]);
});

test("scan.new-date-with-an-argument-is-allowed", () => {
  expect(scanDriveSource(`g.drive(async () => { const d = new Date(0); });`)).toEqual([]);
});

test("scan.finds-fs-bindings-in-a-named-drive-function", () => {
  const source = `import { readFileSync } from "node:fs";
import * as promises from "fs/promises";
async function run(loop) {
  readFileSync("a");
  await promises.readFile("b");
}
g.drive(run);`;
  expect(scanDriveSource(source).map(({ code, line, target }) => ({ code, line, target }))).toEqual(
    [
      { code: "SD-08", line: 4, target: "readFileSync" },
      { code: "SD-08", line: 5, target: "promises.readFile" },
    ],
  );
});

test("scan.ignores-code-outside-drive-and-property-names", () => {
  const source = `const at = Date.now();
g.on("boundary.step.after", () => { return Math.random(); });
g.drive(async (loop) => { const o = { fetch: 1 }; return o.fetch; });`;
  expect(scanDriveSource(source)).toEqual([]);
});

test("scan.follows-same-file-helpers-one-level", () => {
  const source = `function stamp() { return Date.now(); }
function deeper() { return Math.random(); }
function outer() { return deeper(); }
g.drive(async () => { stamp(); outer(); });`;
  expect(scanDriveSource(source).map(({ code, line }) => ({ code, line }))).toEqual([
    { code: "SD-01", line: 1 },
  ]);
});

test("scan.warns-when-drive-reassigns-an-outer-variable", () => {
  const source = `let calls = 0;
g.drive(async (loop) => {
  let local = 0;
  local += 1;
  calls += 1;
});`;
  expect(scanDriveSource(source)).toEqual([
    {
      code: "SD-10",
      severity: "warning",
      line: 5,
      column: 3,
      target: "calls",
      message: "drive state lives only in scope state (eng.events EV-09).",
    },
  ]);
});

test("scan.reports-columns-in-utf16-after-multibyte-text", () => {
  const source = `g.drive(async () => { const label = "한글"; Date.now(); });`;
  expect(scanDriveSource(source).map(({ line, column }) => ({ line, column }))).toEqual([
    { line: 1, column: 43 },
  ]);
});

test("scan.reports-a-syntax-error-as-one-finding", () => {
  const found = scanDriveSource("g.drive(async () => {");
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({ code: "SD-00", severity: "error", line: 1, column: 1 });
});
