import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ok, parseJson } from "@fresnel/contracts";
import { parseArgv, type TerminalFacts } from "../src/cli/command.ts";
import { collectUsage, formatSize } from "../src/commands/db-usage.ts";
import { EXIT } from "../src/exit-codes.ts";
import { createHarness, type Harness, type HarnessOptions } from "./support/harness.ts";

// L4.cli.spec §4.13.2: `db usage`와 `db previous-rm`. 파서, 집계 값(실제 임시 폴더와 정확한 바이트 수), 명령(가짜 입력과 터미널).

const TTY: TerminalFacts = { stdinIsTty: true, stdoutIsTty: true };
/** 복원 전 사본 두 개. NAME이 최신이다 */
const NAME = "20261107T090000000Z";
const OLDER = "20261106T010203004Z";

const roots: string[] = [];
const harnesses: Harness[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function rootDir(): string {
  const root = mkdtempSync(join(tmpdir(), "xdb-usage-"));
  roots.push(root);
  return root;
}

/** 크기가 정확히 bytes인 일반 파일을 만든다. 상위 폴더도 만든다 */
function sized(path: string, bytes: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, new Uint8Array(bytes));
}

interface Layout {
  readonly data: string;
  readonly state: string;
}

/**
 * 시험 데이터 배치. 각 항목의 바이트 수는 아래 EXPECTED의 합과 같다.
 * 대화 1000+250+32, 블롭 3000+96, 측정 77, 로그 500+100, 복원 전 사본은 OLDER 500, NAME 40,
 * 형식이 다른 폴더 10, 형식에 맞는 이름의 일반 파일 999.
 */
function layout(root: string): Layout {
  const data = join(root, "data");
  const state = join(root, "state");
  sized(join(data, "fresnel.db"), 1000);
  sized(join(data, "fresnel.db-wal"), 250);
  sized(join(data, "fresnel.db-shm"), 32);
  sized(join(data, "blobs", "ab", "cd", "one.bin"), 3000);
  sized(join(data, "blobs", "ff", "two.bin"), 96);
  sized(join(data, "measure.db"), 77);
  sized(join(state, "logs", "engine.log"), 500);
  sized(join(state, "logs", "sub", "old.log"), 100);
  sized(join(data, "restore-previous", OLDER, "fresnel.db"), 300);
  sized(join(data, "restore-previous", OLDER, "blobs", "x.bin"), 200);
  sized(join(data, "restore-previous", NAME, "fresnel.db"), 40);
  sized(join(data, "restore-previous", "notes", "readme.txt"), 10);
  sized(join(data, "restore-previous", "20261105T000000000Z"), 999);
  return { data, state };
}

const EXPECTED = {
  conversations: 1282,
  attachments: 3096,
  measurements: 77,
  logs: 600,
  restorePrevious: 1549,
  previous: [
    { name: NAME, bytes: 40 },
    { name: OLDER, bytes: 500 },
  ],
};

function parse(argv: readonly string[]): unknown {
  const parsed = parseArgv(argv, TTY, {});
  return parsed.ok ? parsed.value.command : parsed.error.code;
}

function harnessAt(
  dirs: Layout,
  options: Omit<HarnessOptions, "dataDir" | "stateDir"> = {},
): Harness {
  const harness = createHarness({ ...options, dataDir: dirs.data, stateDir: dirs.state });
  harnesses.push(harness);
  return harness;
}

test("db usage takes an optional --json and no positional argument", () => {
  expect(parse(["db", "usage"])).toEqual({ kind: "db.usage", output: "text" });
  expect(parse(["db", "usage", "--json"])).toEqual({ kind: "db.usage", output: "json" });
  expect(parse(["db", "usage", "extra"])).toBe("unexpectedArgument");
  expect(parse(["db", "usage", "--force"])).toBe("unknownFlag");
});

test("db previous-rm takes one copy name with --yes and --json in any order", () => {
  expect(parse(["db", "previous-rm", NAME])).toEqual({
    kind: "db.previous-rm",
    name: NAME,
    output: "text",
    yes: false,
  });
  expect(parse(["db", "previous-rm", "--yes", NAME, "--json"])).toEqual({
    kind: "db.previous-rm",
    name: NAME,
    output: "json",
    yes: true,
  });
});

test("db previous-rm without a name, with two names, or with a name that is not a copy name", () => {
  expect(parse(["db", "previous-rm"])).toBe("missingArgument");
  expect(parse(["db", "previous-rm", ""])).toBe("missingArgument");
  expect(parse(["db", "previous-rm", NAME, "extra"])).toBe("unexpectedArgument");
  for (const bad of ["..", "../x", "a/b", `${NAME}/..`, "20261107T09000000Z", "latest"]) {
    expect(parse(["db", "previous-rm", bad])).toBe("invalidCopyName");
  }
});

test("collectUsage counts each figure from the real files and lists the copies newest first", async () => {
  const root = rootDir();
  const dirs = layout(root);
  expect(await collectUsage(dirs.data, dirs.state)).toEqual(
    ok({ dataDir: dirs.data, ...EXPECTED }),
  );
});

test("symbolic links are neither followed nor counted", async () => {
  const root = rootDir();
  const outside = join(root, "outside");
  sized(join(outside, "big.bin"), 9999);
  sized(join(outside, "copy", "payload.bin"), 4096);
  const data = join(root, "data");
  sized(join(data, "fresnel.db"), 10);
  symlinkSync(join(outside, "big.bin"), join(data, "fresnel.db-wal"));
  mkdirSync(join(data, "blobs"), { recursive: true });
  symlinkSync(join(outside, "big.bin"), join(data, "blobs", "link.bin"));
  mkdirSync(join(data, "restore-previous"), { recursive: true });
  symlinkSync(join(outside, "copy"), join(data, "restore-previous", NAME));
  expect(await collectUsage(data, null)).toEqual(
    ok({
      dataDir: data,
      conversations: 10,
      attachments: 0,
      measurements: 0,
      logs: 0,
      restorePrevious: 0,
      previous: [],
    }),
  );
});

test("missing paths count 0 and never throw", async () => {
  const root = rootDir();
  const data = join(root, "nothing-here");
  const zero = ok({
    dataDir: data,
    conversations: 0,
    attachments: 0,
    measurements: 0,
    logs: 0,
    restorePrevious: 0,
    previous: [],
  });
  expect(await collectUsage(data, null)).toEqual(zero);
  expect(await collectUsage(data, join(root, "no-state"))).toEqual(zero);
});

test("a data folder without a blobs folder counts the blobs as 0", async () => {
  const root = rootDir();
  const data = join(root, "data");
  sized(join(data, "fresnel.db"), 5);
  expect(await collectUsage(data, null)).toEqual(
    ok({
      dataDir: data,
      conversations: 5,
      attachments: 0,
      measurements: 0,
      logs: 0,
      restorePrevious: 0,
      previous: [],
    }),
  );
});

test("formatSize shows KB, MB or GB with one decimal", () => {
  expect(formatSize(0)).toBe("0.0 KB");
  expect(formatSize(1536)).toBe("1.5 KB");
  expect(formatSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  expect(formatSize(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
});

test("db usage --json prints one JSON document and does not start the engine", async () => {
  const root = rootDir();
  const dirs = layout(root);
  const harness = harnessAt(dirs);
  expect(await harness.run(["db", "usage", "--json"])).toBe(EXIT.ok);
  expect(parseJson(harness.stdoutText())).toEqual(ok({ dataDir: dirs.data, ...EXPECTED }));
  expect(harness.stderrText()).toBe("");
  expect(harness.startOptions).toEqual([]);
  expect(harness.methods()).toEqual([]);
});

test("db usage prints one line per figure, sized, with the copies newest first", async () => {
  const root = rootDir();
  const dirs = layout(root);
  const harness = harnessAt(dirs);
  expect(await harness.run(["db", "usage"])).toBe(EXIT.ok);
  expect(harness.stdoutText()).toBe(
    [
      `데이터 디렉터리: ${dirs.data}`,
      "대화 저장소: 1.3 KB",
      "첨부 파일(블롭): 3.0 KB",
      "측정 데이터: 0.1 KB",
      "엔진 로그: 0.6 KB",
      "복원 전 사본 합계: 1.5 KB",
      `  ${NAME}  0.0 KB`,
      `  ${OLDER}  0.5 KB`,
    ].join("\n") + "\n",
  );
});

test("db usage without a data directory is an environment problem (3)", async () => {
  const harness = createHarness({ dataDir: null });
  harnesses.push(harness);
  expect(await harness.run(["db", "usage"])).toBe(EXIT.environment);
  expect(harness.stderrText()).toContain("데이터 디렉터리 위치를 정하지 못했다");
});

test("previous-rm --yes --json deletes the copy and reports the real byte total; the other copy stays", async () => {
  const root = rootDir();
  const dirs = layout(root);
  const harness = harnessAt(dirs);
  expect(await harness.run(["db", "previous-rm", OLDER, "--yes", "--json"])).toBe(EXIT.ok);
  expect(parseJson(harness.stdoutText())).toEqual(ok({ removed: OLDER, freedBytes: 500 }));
  expect(harness.stderrText()).toBe("");
  expect(existsSync(join(dirs.data, "restore-previous", OLDER))).toBe(false);
  expect(existsSync(join(dirs.data, "restore-previous", NAME, "fresnel.db"))).toBe(true);
});

test("previous-rm --yes prints one line with the name and the size", async () => {
  const root = rootDir();
  const dirs = layout(root);
  const harness = harnessAt(dirs);
  expect(await harness.run(["db", "previous-rm", OLDER, "--yes"])).toBe(EXIT.ok);
  expect(harness.stdoutText()).toBe(`지웠다: ${OLDER} (0.5 KB)\n`);
});

test("a name that is not a copy name is a usage error and deletes nothing", async () => {
  const root = rootDir();
  const dirs = layout(root);
  const harness = harnessAt(dirs);
  const bad = ["..", `../${NAME}`, `${OLDER}/..`, "20261107T09000000Z", "notes"];
  const codes = await Promise.all(
    bad.map((name) => harness.run(["db", "previous-rm", name, "--yes"])),
  );
  expect(codes).toEqual(bad.map(() => EXIT.usage));
  expect(existsSync(join(dirs.data, "restore-previous", NAME))).toBe(true);
  expect(existsSync(join(dirs.data, "restore-previous", OLDER))).toBe(true);
});

test("a name with no such copy is a usage error and deletes nothing", async () => {
  const root = rootDir();
  const dirs = layout(root);
  const harness = harnessAt(dirs);
  expect(await harness.run(["db", "previous-rm", "20261101T000000000Z", "--yes"])).toBe(EXIT.usage);
  expect(harness.stderrText()).toContain("그런 복원 전 사본이 없다");
});

test("a copy that is only a file or a link is not a copy folder: exit 2 and nothing removed", async () => {
  const root = rootDir();
  const dirs = layout(root);
  const outside = join(root, "outside");
  sized(join(outside, "keep.bin"), 64);
  symlinkSync(outside, join(dirs.data, "restore-previous", "20261104T000000000Z"));
  const harness = harnessAt(dirs);
  expect(await harness.run(["db", "previous-rm", "20261105T000000000Z", "--yes"])).toBe(EXIT.usage);
  expect(await harness.run(["db", "previous-rm", "20261104T000000000Z", "--yes"])).toBe(EXIT.usage);
  expect(existsSync(join(dirs.data, "restore-previous", "20261105T000000000Z"))).toBe(true);
  expect(existsSync(join(outside, "keep.bin"))).toBe(true);
});

test("without --yes and without a terminal, nothing is deleted (exit 2)", async () => {
  const root = rootDir();
  const dirs = layout(root);
  const harness = harnessAt(dirs);
  expect(await harness.run(["db", "previous-rm", NAME])).toBe(EXIT.usage);
  expect(harness.stderrText()).toContain("터미널이 아니라서");
  expect(existsSync(join(dirs.data, "restore-previous", NAME, "fresnel.db"))).toBe(true);
});

test("the terminal prompt names the folder and its size, says it cannot be undone, and anything but y keeps it (exit 1)", async () => {
  const root = rootDir();
  const dirs = layout(root);
  const prompts: string[] = [];
  const harness = harnessAt(dirs, {
    terminal: { stdinIsTty: true },
    readLine: (prompt) => {
      prompts.push(prompt);
      return Promise.resolve("n");
    },
  });
  expect(await harness.run(["db", "previous-rm", OLDER])).toBe(EXIT.error);
  expect(prompts).toEqual([
    `복원 전 사본 ${join(dirs.data, "restore-previous", OLDER)} (0.5 KB)을(를) 지울까요? 되돌릴 수 없다 [y/N] `,
  ]);
  expect(harness.stderrText()).toBe("지우지 않았다 (아무것도 바꾸지 않았다)\n");
  expect(existsSync(join(dirs.data, "restore-previous", OLDER, "fresnel.db"))).toBe(true);
});

test("answering y at the terminal deletes the copy", async () => {
  const root = rootDir();
  const dirs = layout(root);
  const harness = harnessAt(dirs, { terminal: { stdinIsTty: true }, lines: ["y"] });
  expect(await harness.run(["db", "previous-rm", OLDER])).toBe(EXIT.ok);
  expect(harness.stdoutText()).toBe(`지웠다: ${OLDER} (0.5 KB)\n`);
  expect(existsSync(join(dirs.data, "restore-previous", OLDER))).toBe(false);
});

test("previous-rm without a data directory is an environment problem (3)", async () => {
  const harness = createHarness({ dataDir: null });
  harnesses.push(harness);
  expect(await harness.run(["db", "previous-rm", NAME, "--yes"])).toBe(EXIT.environment);
});
