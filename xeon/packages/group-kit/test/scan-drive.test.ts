import { expect, test } from "bun:test";
import { scanDriveSource, type DriveScanFinding } from "../src/testing/index.ts";

const IO = "Direct I/O is not allowed in drive; use the effects of ADR-0015 §3.2.";

/**
 * 원문에서 needle이 처음 나오는 위치(1부터, UTF-16 코드 단위). 기대 위치를 구현과 따로 원문에서 계산한다.
 */
function locate(
  source: string,
  needle: string,
): { readonly line: number; readonly column: number } {
  const offset = source.indexOf(needle);
  expect(offset).toBeGreaterThanOrEqual(0);
  const before = source.slice(0, offset);
  return { line: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
}

/** 기대 항목 하나. 위치는 needle이 원문에서 나오는 자리에서 계산한다 */
function expectAt(
  source: string,
  needle: string,
  finding: Omit<DriveScanFinding, "line" | "column">,
): DriveScanFinding {
  return { ...locate(source, needle), ...finding };
}

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
    expectAt(source, "Date.now", {
      code: "SD-01",
      severity: "error",
      target: "Date.now",
      message: "Inject Clock (eng.typescript.guide TY-21).",
    }),
    expectAt(source, "new Date()", {
      code: "SD-02",
      severity: "error",
      target: "new Date()",
      message: "Inject Clock (TY-21).",
    }),
    expectAt(source, "Math.random", {
      code: "SD-03",
      severity: "error",
      target: "Math.random",
      message: "Inject RandomSource (TY-21).",
    }),
    expectAt(source, "crypto.randomUUID", {
      code: "SD-04",
      severity: "error",
      target: "crypto.randomUUID",
      message: "Use IdFactory (TY-21).",
    }),
    expectAt(source, "crypto.getRandomValues", {
      code: "SD-05",
      severity: "error",
      target: "crypto.getRandomValues",
      message: "Inject RandomSource (TY-21).",
    }),
    expectAt(source, "performance.now", {
      code: "SD-06",
      severity: "error",
      target: "performance.now",
      message: "Inject Clock (TY-21).",
    }),
    expectAt(source, "fetch", { code: "SD-07", severity: "error", target: "fetch", message: IO }),
    expectAt(source, "Bun.file", {
      code: "SD-08",
      severity: "error",
      target: "Bun.file",
      message: IO,
    }),
    expectAt(source, "Bun.write", {
      code: "SD-08",
      severity: "error",
      target: "Bun.write",
      message: IO,
    }),
    expectAt(source, "Bun.spawn", {
      code: "SD-09",
      severity: "error",
      target: "Bun.spawn",
      message: IO,
    }),
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
  expect(scanDriveSource(source)).toEqual([
    expectAt(source, "readFileSync(", {
      code: "SD-08",
      severity: "error",
      target: "readFileSync",
      message: IO,
    }),
    expectAt(source, "promises.readFile", {
      code: "SD-08",
      severity: "error",
      target: "promises.readFile",
      message: IO,
    }),
  ]);
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
  // stamp의 Date.now는 한 단계 안이라 잡고, outer가 부르는 deeper의 Math.random은 두 단계라 잡지 않는다
  expect(scanDriveSource(source)).toEqual([
    expectAt(source, "Date.now", {
      code: "SD-01",
      severity: "error",
      target: "Date.now",
      message: "Inject Clock (eng.typescript.guide TY-21).",
    }),
  ]);
});

test("scan.reports-a-violation-on-a-later-line-of-a-multi-line-drive", () => {
  const source = `g.drive(async (loop, state) => {
  const started = performance.now();
  await loop.turn({ input: { kind: "user", content: "x" } });
  const at = new Date();
  await g.commit({ n: state.n + 1 });
});`;
  expect(scanDriveSource(source)).toEqual([
    expectAt(source, "performance.now", {
      code: "SD-06",
      severity: "error",
      target: "performance.now",
      message: "Inject Clock (TY-21).",
    }),
    expectAt(source, "new Date()", {
      code: "SD-02",
      severity: "error",
      target: "new Date()",
      message: "Inject Clock (TY-21).",
    }),
  ]);
});

test("scan.reports-findings-in-source-order-not-in-scan-order", () => {
  // 직접 호출(fetch, Math.random)을 먼저 훑고 도우미(Date.now)는 나중에 훑는다. 보고는 원문 순서여야 한다
  const source = `function stamp() { return Date.now(); }
g.drive(async () => { stamp(); await fetch("x"); Math.random(); });`;
  expect(scanDriveSource(source)).toEqual([
    expectAt(source, "Date.now", {
      code: "SD-01",
      severity: "error",
      target: "Date.now",
      message: "Inject Clock (eng.typescript.guide TY-21).",
    }),
    expectAt(source, "fetch", { code: "SD-07", severity: "error", target: "fetch", message: IO }),
    expectAt(source, "Math.random", {
      code: "SD-03",
      severity: "error",
      target: "Math.random",
      message: "Inject RandomSource (TY-21).",
    }),
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
    expectAt(source, "calls += 1", {
      code: "SD-10",
      severity: "warning",
      target: "calls",
      message: "drive state lives only in scope state (eng.events EV-09).",
    }),
  ]);
});

test("scan.reports-columns-in-utf16-after-multibyte-text", () => {
  const source = `g.drive(async () => { const label = "한글"; Date.now(); });`;
  expect(scanDriveSource(source).map(({ line, column }) => ({ line, column }))).toEqual([
    locate(source, "Date.now"),
  ]);
  expect(locate(source, "Date.now")).toEqual({ line: 1, column: 43 });
});

test("scan.reports-a-syntax-error-as-one-finding", () => {
  const found = scanDriveSource("g.drive(async () => {");
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({ code: "SD-00", severity: "error", line: 1, column: 1 });
});
