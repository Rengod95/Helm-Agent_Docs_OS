import { afterEach, expect, test } from "bun:test";
import { err, ok, type Result } from "@xeon/contracts";
import type { ExportError, ExportOptions, ExportReport } from "@xeon/platform-store";
import { parseArgv, type TerminalFacts } from "../src/cli/command.ts";
import { EXIT, type ExitCode } from "../src/exit-codes.ts";
import type { CliDeps } from "../src/io.ts";
import { createHarness, type Harness } from "./support/harness.ts";

// M3-REQ-63: `xeon db export <폴더>`. 파서, 명령 실행(가짜 exportDatabase), 오류 문구와 종료 코드.
// 실제 저장소 왕복은 db-export.int.test.ts다.

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const TTY: TerminalFacts = { stdinIsTty: true, stdoutIsTty: true };
const DATA_DIR = "/state/xeon-data";
const DB_PATH = "/state/xeon-data/xeon.db";

function parse(argv: readonly string[]): unknown {
  const parsed = parseArgv(argv, TTY, {});
  return parsed.ok ? parsed.value.command : parsed.error.code;
}

test("db export takes one destination and an optional --json", () => {
  expect(parse(["db", "export", "out"])).toEqual({
    kind: "db.export",
    destDir: "out",
    output: "text",
  });
  expect(parse(["db", "export", "out", "--json"])).toEqual({
    kind: "db.export",
    destDir: "out",
    output: "json",
  });
  expect(parse(["db", "export", "--json", "out"])).toEqual({
    kind: "db.export",
    destDir: "out",
    output: "json",
  });
});

test("db export without a destination, with two, or with an unknown word is a usage error", () => {
  expect(parse(["db", "export"])).toBe("missingArgument");
  expect(parse(["db", "export", ""])).toBe("missingArgument");
  expect(parse(["db", "export", "a", "b"])).toBe("unexpectedArgument");
  expect(parse(["db"])).toBe("missingArgument");
  expect(parse(["db", "dump", "out"])).toBe("unknownCommand");
  expect(parse(["db", "export", "out", "--force"])).toBe("unknownFlag");
});

test("the usage error of a missing destination is two lines: what and the fix", () => {
  expect(parseArgv(["db", "export"], TTY, {})).toEqual({
    ok: false,
    error: {
      code: "missingArgument",
      message: "db export에는 내보낼 폴더가 필요하다",
      fix: "xeon db export <폴더>",
    },
  });
});

test("the global -C is kept and the destination stays relative to it until runDb", () => {
  const parsed = parseArgv(["-C", "work", "db", "export", "out"], TTY, {});
  expect(parsed).toMatchObject({
    ok: true,
    value: { global: { cwd: "work" }, command: { kind: "db.export", destDir: "out" } },
  });
});

/** 호출을 쌓아 두는 가짜 exportDatabase. 결과는 시험이 정한다 */
function exporting(result: Result<ExportReport, ExportError>): {
  readonly calls: ExportOptions[];
  readonly run: CliDeps["exportDatabase"];
} {
  const calls: ExportOptions[] = [];
  return {
    calls,
    run: (options) => {
      calls.push(options);
      return Promise.resolve(result);
    },
  };
}

function harness(
  result: Result<ExportReport, ExportError>,
  options: { readonly dataDir?: string | null } = {},
): { readonly h: Harness; readonly calls: ExportOptions[] } {
  const fake = exporting(result);
  const h = createHarness({
    cwd: "/work/project",
    dataDir: DATA_DIR,
    ...options,
    exportDatabase: fake.run,
  });
  harnesses.push(h);
  return { h, calls: fake.calls };
}

const REPORT: ExportReport = {
  destDir: "/work/project/out",
  exportedAt: 1_767_571_200_000,
  blobCount: 2,
  missingBlobs: [],
};

test("db export prints the blob count and the destination, and runs no engine", async () => {
  const { h, calls } = harness(ok(REPORT));
  expect(await h.run(["db", "export", "out"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe("exported 2 blobs to /work/project/out\n");
  expect(h.stderrText()).toBe("");
  expect(calls).toEqual([{ dbPath: DB_PATH, destDir: "/work/project/out", clock: h.clock }]);
  expect(h.startOptions).toEqual([]);
  expect(h.methods()).toEqual([]);
});

test("the destination is resolved against -C, not against the process cwd", async () => {
  const { h, calls } = harness(ok({ ...REPORT, destDir: "/work/project/sub/out" }));
  expect(await h.run(["-C", "sub", "db", "export", "out"])).toBe(EXIT.ok);
  expect(calls.map((call) => call.destDir)).toEqual(["/work/project/sub/out"]);
});

test("db export --json prints the report as one JSON document", async () => {
  const { h } = harness(ok(REPORT));
  expect(await h.run(["db", "export", "out", "--json"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe(`${JSON.stringify(REPORT, null, 2)}\n`);
  expect(JSON.parse(h.stdoutText())).toEqual(REPORT);
  expect(h.stderrText()).toBe("");
});

test("each missing blob gets one warning line; the exit code stays 0", async () => {
  const missing = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
  const { h } = harness(ok({ ...REPORT, blobCount: 0, missingBlobs: missing }));
  expect(await h.run(["db", "export", "out"])).toBe(EXIT.ok);
  expect(h.stdoutText()).toBe("exported 0 blobs to /work/project/out\n");
  expect(h.stderrText()).toBe(
    missing.map((sha256) => `경고: 블롭 파일이 없어 빠졌다: ${sha256}\n`).join(""),
  );
});

test("more than ten missing blobs list ten lines and then count the rest", async () => {
  const missing = Array.from({ length: 12 }, (_, index) => String(index).padStart(64, "0"));
  const { h } = harness(ok({ ...REPORT, blobCount: 0, missingBlobs: missing }));
  expect(await h.run(["db", "export", "out"])).toBe(EXIT.ok);
  const lines = h.stderrText().split("\n").slice(0, -1);
  expect(lines).toHaveLength(11);
  expect(lines.slice(0, 10)).toEqual(
    missing.slice(0, 10).map((sha256) => `경고: 블롭 파일이 없어 빠졌다: ${sha256}`),
  );
  expect(lines[10]).toBe("경고: 나머지 2개도 빠졌다 (전체 12개, manifest.json의 missingBlobs)");
});

test("the JSON output does not repeat the missing blobs as warnings", async () => {
  const { h } = harness(ok({ ...REPORT, missingBlobs: ["d".repeat(64)] }));
  expect(await h.run(["db", "export", "out", "--json"])).toBe(EXIT.ok);
  expect(h.stderrText()).toBe("");
  expect(JSON.parse(h.stdoutText())).toMatchObject({ missingBlobs: ["d".repeat(64)] });
});

/** ExportError 하나마다 종료 코드와 두 줄 오류 문구를 고정한다. dest_not_empty는 사용법(2), 나머지는 환경 문제(3) */
const FAILURES: readonly {
  readonly name: string;
  readonly error: ExportError;
  readonly code: ExitCode;
  readonly stderr: string;
}[] = [
  {
    name: "dest_not_empty",
    error: { kind: "dest_not_empty" },
    code: 2,
    stderr:
      "xeon: 내보낼 폴더가 비어 있지 않다 (아무것도 바꾸지 않았다)\n  해결: 비어 있거나 없는 폴더를 지정한다\n",
  },
  {
    name: "foreign_database",
    error: { kind: "foreign_database", applicationId: 1234 },
    code: 3,
    stderr:
      "xeon: Xeon 데이터베이스가 아니다 (application_id 1234)\n  해결: XEON_HOME으로 데이터 디렉터리를 확인한다. xeon.db가 다른 프로그램의 파일이면 옮긴다\n",
  },
  {
    name: "not_a_database",
    error: { kind: "not_a_database" },
    code: 3,
    stderr:
      "xeon: 데이터베이스 파일이 없거나 SQLite 파일이 아니다\n  해결: xeon chat을 한 번 실행해 데이터베이스를 만든 뒤 다시 실행한다. 위치는 XEON_HOME으로 바꾼다\n",
  },
  {
    name: "busy",
    error: { kind: "busy" },
    code: 3,
    stderr: "xeon: 데이터베이스가 다른 쓰기로 바쁘다\n  해결: 잠시 뒤 다시 실행한다\n",
  },
  {
    name: "disk_full",
    error: { kind: "disk_full" },
    code: 3,
    stderr: "xeon: 저장 공간이 가득 찼다\n  해결: 디스크 공간을 비우고 다시 실행한다\n",
  },
  {
    name: "io",
    error: { kind: "io", code: "EACCES" },
    code: 3,
    stderr:
      "xeon: 내보내기 중 입출력 오류가 났다 (EACCES)\n  해결: 대상 폴더와 데이터 디렉터리의 권한과 디스크 상태를 확인한다\n",
  },
];

for (const failure of FAILURES) {
  test(`db export maps ${failure.name} to exit ${String(failure.code)} and a two-line message`, async () => {
    const { h, calls } = harness(err(failure.error));
    expect(await h.run(["db", "export", "out"])).toBe(failure.code);
    expect(h.stderrText()).toBe(failure.stderr);
    expect(h.stdoutText()).toBe("");
    expect(calls).toHaveLength(1);
  });
}

test("a data directory that cannot be decided is an environment failure before any export", async () => {
  const { h, calls } = harness(ok(REPORT), { dataDir: null });
  expect(await h.run(["db", "export", "out"])).toBe(EXIT.environment);
  expect(h.stderrText()).toBe(
    "xeon: 데이터 디렉터리 위치를 정하지 못했다\n  해결: HOME(Windows는 USERPROFILE)과 XEON_HOME 설정을 확인한다\n",
  );
  expect(calls).toEqual([]);
});

test("a missing destination exits 2 before the export runs", async () => {
  const { h, calls } = harness(ok(REPORT));
  expect(await h.run(["db", "export"])).toBe(EXIT.usage);
  expect(h.stderrText()).toBe(
    "xeon: db export에는 내보낼 폴더가 필요하다\n  해결: xeon db export <폴더>\n",
  );
  expect(calls).toEqual([]);
});
