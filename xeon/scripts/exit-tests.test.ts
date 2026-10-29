import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  describeVerdict,
  judge,
  needsSidecar,
  parseExitList,
  sidecarBinaryPath,
  skippedTotal,
  summarizeBunOutput,
  type ExitEntry,
} from "./exit-tests.ts";

const BUN_OUTPUT = `bun test v1.4.3 (c6da4a4d3)

test/admin.int.test.ts:
(pass) add, ls [3.00ms]

 4 pass
 2 skip
 0 fail
Ran 6 tests across 2 files. [20.00ms]
`;

const ENTRY: ExitEntry = {
  condition: "E7",
  dir: "packages/platform-secrets",
  files: ["test/admin.int.test.ts"],
  line: 3,
};

test("the list parses conditions, package dirs and files, skipping comments", () => {
  const parsed = parseExitList(
    "# c\n\nE7 packages/platform-secrets test/a.int.test.ts test/b.int.test.ts\nM1 packages/platform-sandbox test/*.int.test.ts\n",
  );
  expect(parsed).toEqual({
    ok: true,
    value: [
      {
        condition: "E7",
        dir: "packages/platform-secrets",
        files: ["test/a.int.test.ts", "test/b.int.test.ts"],
        line: 3,
      },
      { condition: "M1", dir: "packages/platform-sandbox", files: ["test/*.int.test.ts"], line: 4 },
    ],
  });
});

test("a line without files, a bad label, an escaping path or an empty list is an error", () => {
  expect(parseExitList("E7 packages/x\n")).toEqual({
    ok: false,
    error: "line 1: expected <condition> <package dir> <file...>",
  });
  expect(parseExitList("e7 packages/x test/a.ts\n")).toEqual({
    ok: false,
    error: "line 1: condition must look like E7, M1 or E2,E3",
  });
  expect(parseExitList("E7 ../x test/a.ts\n")).toEqual({
    ok: false,
    error: "line 1: paths must stay inside the package",
  });
  expect(parseExitList("# only comments\n")).toEqual({
    ok: false,
    error: "the list has no entries",
  });
});

test("the repository list parses and names every exit condition it covers", () => {
  const text = readFileSync(join(import.meta.dir, "exit-tests.txt"), "utf8");
  const parsed = parseExitList(text);
  if (!parsed.ok) throw new Error(parsed.error);
  const covered = parsed.value.flatMap((entry) => entry.condition.split(","));
  expect([...new Set(covered)].toSorted()).toEqual([
    "E2",
    "E3",
    "E4",
    "E5",
    "E6",
    "E7",
    "M1",
    "X1",
    "X10",
    "X2",
    "X3",
    "X4",
    "X5",
    "X6",
    "X7",
    "X8",
    "X9",
  ]);
});

test("E2 and E3 each name the host test and the sidecar e2e test, and the e2e line makes the runner build the sidecar", () => {
  const text = readFileSync(join(import.meta.dir, "exit-tests.txt"), "utf8");
  const parsed = parseExitList(text);
  if (!parsed.ok) throw new Error(parsed.error);
  const lineOf = (condition: string, dir: string, file: string): boolean =>
    parsed.value.some(
      (entry) =>
        entry.condition.split(",").includes(condition) &&
        entry.dir === dir &&
        entry.files.includes(file),
    );
  expect(lineOf("E2", "apps/host", "test/contract/transport-parity.contract.test.ts")).toBe(true);
  expect(lineOf("E2", "apps/desktop", "test/e2e/sidecar.e2e.test.ts")).toBe(true);
  expect(lineOf("E3", "apps/host", "test/int/stdio-shutdown.int.test.ts")).toBe(true);
  expect(lineOf("E3", "apps/desktop", "test/e2e/sidecar.e2e.test.ts")).toBe(true);
  expect(needsSidecar(parsed.value)).toBe(true);
});

test("X4 names the idle, lifecycle, schedule and schedule-wire host tests (the halves and the end test of the condition)", () => {
  const text = readFileSync(join(import.meta.dir, "exit-tests.txt"), "utf8");
  const parsed = parseExitList(text);
  if (!parsed.ok) throw new Error(parsed.error);
  const x4 = parsed.value.filter((entry) => entry.condition === "X4");
  expect(x4.map((entry) => [entry.dir, entry.files])).toEqual([
    [
      "apps/host",
      [
        "test/int/service-idle.int.test.ts",
        "test/int/service-lifecycle.int.test.ts",
        "test/int/service-schedule.int.test.ts",
        "test/int/service-schedule-wire.int.test.ts",
      ],
    ],
  ]);
});

test("X5 names the socat fake-tunnel remote-use host test", () => {
  const text = readFileSync(join(import.meta.dir, "exit-tests.txt"), "utf8");
  const parsed = parseExitList(text);
  if (!parsed.ok) throw new Error(parsed.error);
  const x5 = parsed.value.filter((entry) => entry.condition === "X5");
  expect(x5.map((entry) => [entry.dir, entry.files])).toEqual([
    ["apps/host", ["test/int/service-transport.int.test.ts"]],
  ]);
});

test("a line for several conditions parses, and only desktop lines need the sidecar", () => {
  const parsed = parseExitList(
    "E2,E3 apps/desktop test/e2e/x.e2e.test.ts\nE4 apps/host test/a.ts\n",
  );
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.value.map((entry) => entry.condition)).toEqual(["E2,E3", "E4"]);
  expect(needsSidecar(parsed.value)).toBe(true);
  expect(needsSidecar(parsed.value.slice(1))).toBe(false);
  expect(parseExitList("E2,e3 apps/desktop test/a.ts\n").ok).toBe(false);
  expect(parseExitList("E2, apps/desktop test/a.ts\n").ok).toBe(false);
});

test("the sidecar binary path follows the triple of the machine", () => {
  expect(sidecarBinaryPath("xeon", "linux", "x64")).toBe(
    "apps/desktop/src-tauri/binaries/xeon-x86_64-unknown-linux-gnu",
  );
  expect(sidecarBinaryPath("xeon", "darwin", "arm64")).toBe(
    "apps/desktop/src-tauri/binaries/xeon-aarch64-apple-darwin",
  );
  expect(sidecarBinaryPath("xeon", "freebsd", "x64")).toBeUndefined();
});

test("bun output gives pass, skip and fail counts; no pass line is undefined", () => {
  expect(summarizeBunOutput(BUN_OUTPUT)).toEqual({ pass: 4, skip: 2, fail: 0 });
  expect(summarizeBunOutput(" 3 pass\n 0 fail\n")).toEqual({ pass: 3, skip: 0, fail: 0 });
  expect(summarizeBunOutput("error: no tests found\n")).toBeUndefined();
});

test("a skipped test fails the line even when bun exits 0", () => {
  const verdict = judge(ENTRY.files, ["test/admin.int.test.ts"], {
    exitCode: 0,
    output: BUN_OUTPUT,
  });
  expect(verdict).toEqual({ kind: "skipped", summary: { pass: 4, skip: 2, fail: 0 } });
  expect(describeVerdict(ENTRY, verdict)).toBe(
    "E7\tpackages/platform-secrets\tskipped\tpass 4, skip 2: a skipped exit-condition test leaves the condition unchecked (install the binary it needs)",
  );
  expect(skippedTotal([verdict])).toBe(2);
});

test("no matching file is missing, a non-zero exit is failed, a clean run is ok", () => {
  expect(judge(["test/*.int.test.ts"], [], undefined)).toEqual({
    kind: "missing",
    patterns: ["test/*.int.test.ts"],
  });
  expect(judge(ENTRY.files, ["x"], { exitCode: 1, output: " 1 pass\n 1 fail\n" })).toEqual({
    kind: "failed",
    exitCode: 1,
    summary: { pass: 1, skip: 0, fail: 1 },
  });
  const ok = judge(ENTRY.files, ["x"], { exitCode: 0, output: " 5 pass\n 0 fail\n" });
  expect(ok).toEqual({ kind: "ok", summary: { pass: 5, skip: 0, fail: 0 } });
  expect(describeVerdict(ENTRY, ok)).toBe("E7\tpackages/platform-secrets\tok\tpass 5, skip 0");
});

test("X7 names the view-model test and the host test through the real settings.writeFile, X8 and X10 name their tests", () => {
  const text = readFileSync(join(import.meta.dir, "exit-tests.txt"), "utf8");
  const parsed = parseExitList(text);
  if (!parsed.ok) throw new Error(parsed.error);
  const linesOf = (condition: string): (string | readonly string[])[][] =>
    parsed.value
      .filter((entry) => entry.condition === condition)
      .map((entry) => [entry.dir, entry.files]);
  expect(linesOf("X7")).toEqual([
    ["packages/client", ["test/accounts/x7.test.ts"]],
    ["packages/core-models", ["test/rotation.test.ts"]],
    ["apps/host", ["test/int/x7-settings-file.int.test.ts"]],
  ]);
  expect(linesOf("X8")).toEqual([["packages/client", ["test/settings/x8.test.ts"]]]);
  expect(linesOf("X10")).toEqual([["apps/cli", ["test/x10-settings-keys.int.test.ts"]]]);
});
