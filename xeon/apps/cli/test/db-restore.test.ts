import { afterEach, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import type { RestoreError, RestoreOptions, RestoreReport } from "@fresnel/platform-store";
import { parseArgv, type TerminalFacts } from "../src/cli/command.ts";
import { EXIT, type ExitCode } from "../src/exit-codes.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// `fresnel db restore <폴더>`: 파서, 명령 실행(가짜 restoreDatabase), 오류 문구와 종료 코드.
// 실제 저장소 왕복은 db-restore.int.test.ts다.

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const TTY: TerminalFacts = { stdinIsTty: true, stdoutIsTty: true };
const DB_PATH = "/state/fresnel-data/fresnel.db";

function parse(argv: readonly string[]): unknown {
  const parsed = parseArgv(argv, TTY, {});
  return parsed.ok ? parsed.value.command : parsed.error.code;
}

test("db restore takes one folder and an optional --json", () => {
  expect(parse(["db", "restore", "out"])).toEqual({
    kind: "db.restore",
    backupDir: "out",
    output: "text",
    check: false,
  });
  expect(parse(["db", "restore", "out", "--check", "--json"])).toEqual({
    kind: "db.restore",
    backupDir: "out",
    output: "json",
    check: true,
  });
  expect(parse(["db", "restore", "--json", "out"])).toEqual({
    kind: "db.restore",
    backupDir: "out",
    output: "json",
    check: false,
  });
  expect(parse(["db", "restore"])).toBe("missingArgument");
  expect(parse(["db", "restore", "a", "b"])).toBe("unexpectedArgument");
  expect(parse(["db", "restore", "out", "--force"])).toBe("unknownFlag");
});

const REPORT: RestoreReport = {
  dbPath: DB_PATH,
  backupDir: "/work/project/out",
  blobsAdded: 2,
  missingBlobs: [],
  previousDir: "/state/fresnel-data/restore-previous/20261104T000000000Z",
  recovered: null,
};

function harness(result: Result<RestoreReport, RestoreError>): {
  readonly h: Harness;
  readonly calls: RestoreOptions[];
} {
  const calls: RestoreOptions[] = [];
  const h = createHarness({
    env: { NO_COLOR: "1" },
    dataDir: "/state/fresnel-data",
    cwd: "/work/project",
    restoreDatabase: (options) => {
      calls.push(options);
      return Promise.resolve(result);
    },
  });
  harnesses.push(h);
  return { h, calls };
}

test("a restore resolves the folder against -C, runs no engine, and says secrets need the separate age key", async () => {
  const { h, calls } = harness(ok(REPORT));
  expect(await h.run(["db", "restore", "out"])).toBe(EXIT.ok);
  expect(calls).toEqual([{ dbPath: DB_PATH, backupDir: "/work/project/out", clock: h.clock }]);
  expect(h.stdoutText()).toContain("/work/project/out");
  expect(h.stdoutText()).toContain("/state/fresnel-data/restore-previous/20261104T000000000Z");
  expect(h.stderrText()).toContain("secrets/age/keys.txt");
  expect(h.startOptions).toEqual([]);
});

test("--check only verifies: it passes verifyOnly, restores nothing and prints no secrets notice", async () => {
  const { h, calls } = harness(ok({ ...REPORT, blobsAdded: 0, previousDir: null }));
  expect(await h.run(["db", "restore", "out", "--check"])).toBe(EXIT.ok);
  expect(calls).toEqual([
    { dbPath: DB_PATH, backupDir: "/work/project/out", clock: h.clock, verifyOnly: true },
  ]);
  expect(h.stdoutText()).toBe("/work/project/out는 쓸 수 있는 백업이다 (아무것도 바꾸지 않았다)\n");
  expect(h.stderrText()).toBe("");
});

test("--json prints the report as one document", async () => {
  const { h } = harness(ok(REPORT));
  expect(await h.run(["db", "restore", "out", "--json"])).toBe(EXIT.ok);
  expect(JSON.parse(h.stdoutText())).toEqual(REPORT);
});

const FAILURES: readonly {
  readonly name: string;
  readonly error: RestoreError;
  readonly code: ExitCode;
  readonly includes: string;
}[] = [
  {
    name: "backup_not_found",
    error: { kind: "backup_not_found" },
    code: EXIT.usage,
    includes: "백업 폴더가 아니다",
  },
  {
    name: "future_version",
    error: { kind: "future_version", backupVersion: 5, codeVersion: 3 },
    code: EXIT.environment,
    includes: "버전 5, 이 빌드는 3까지",
  },
  {
    name: "engine_running",
    error: { kind: "engine_running" },
    code: EXIT.environment,
    includes: "fresnel service stop",
  },
  {
    name: "blob_hash",
    error: { kind: "backup_invalid", reason: "blob_hash" },
    code: EXIT.environment,
    includes: "해시와 다르다",
  },
  {
    name: "io",
    error: { kind: "io", code: "EACCES" },
    code: EXIT.environment,
    includes: "(EACCES)",
  },
];

for (const failure of FAILURES) {
  test(`db restore maps ${failure.name} to exit ${String(failure.code)} and a two-line message`, async () => {
    const { h } = harness(err(failure.error));
    expect(await h.run(["db", "restore", "out"])).toBe(failure.code);
    expect(h.stdoutText()).toBe("");
    expect(
      h
        .stderrText()
        .split("\n")
        .filter((line) => line !== ""),
    ).toHaveLength(2);
    expect(h.stderrText()).toContain(failure.includes);
  });
}
