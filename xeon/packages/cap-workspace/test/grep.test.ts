import { describe, expect, test } from "bun:test";
import { ok } from "@xeon/contracts";
import type { ProtectedPathEntry } from "@xeon/contracts/services";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import type { ThreadWorkspaces } from "../src/ports/threads.ts";
import { createFilesApi } from "../src/service.ts";
import { DEFAULT_WORKSPACE_SETTINGS, type WorkspaceSettings } from "../src/settings.ts";
import { rejection } from "./support/assertions.ts";
import { depsFor, missingRg, type DepsOptions } from "./support/fakes.ts";
import { memoryEnv, type MemoryEnv } from "./support/memory-env.ts";

// L2.workspace.spec §3.2 grep, §4.3 검색 기준 디렉터리 검사, §4.5 절단, §5 10번.
// rg는 ExecutionEnv.exec 대역(MemoryEnv.reply)으로 흉내 낸다. 실제 rg 출력은 test/rg.int.test.ts가 확인한다.

const RG = "/bundle/rg";
const BASE_ARGV = [RG, "--json", "--no-config", "--no-require-git", "--sort", "path"];
const TAIL_ARGV = ["--no-messages", "--", "."];

type Settings = Partial<{
  grep: Partial<WorkspaceSettings["grep"]>;
  read: Partial<WorkspaceSettings["read"]>;
}>;

function settingsWith(patch: Settings): () => WorkspaceSettings {
  return () => ({
    ...DEFAULT_WORKSPACE_SETTINGS,
    grep: { ...DEFAULT_WORKSPACE_SETTINGS.grep, ...patch.grep },
    read: { ...DEFAULT_WORKSPACE_SETTINGS.read, ...patch.read },
  });
}

function setup(options: DepsOptions = {}) {
  const env = memoryEnv({ cwd: "/work" });
  env.mkdir("/work");
  const files = createFilesApi(depsFor(env, options));
  return { env, files };
}

/** `rg --json`의 일치 또는 문맥 줄 한 개(개행 포함) */
function rgLine(kind: "match" | "context", path: string, line: number, text: string): string {
  const event = {
    type: kind,
    data: {
      path: { text: `./${path}` },
      lines: { text: `${text}\n` },
      line_number: line,
      absolute_offset: 0,
      submatches: [],
    },
  };
  return `${JSON.stringify(event)}\n`;
}

function rgBegin(path: string): string {
  return `${JSON.stringify({ type: "begin", data: { path: { text: `./${path}` } } })}\n`;
}

function rgEnd(path: string): string {
  return `${JSON.stringify({ type: "end", data: { path: { text: `./${path}` } } })}\n`;
}

describe("grep arguments", () => {
  test("grep runs rg with an argv array in the search directory and maps the json events", async () => {
    const { env, files } = setup();
    env.put("/work/src/a.ts", "const x = 1;\nfoo\n");
    env.reply({
      chunks: [
        { text: rgBegin("src/a.ts") + rgLine("match", "src/a.ts", 2, "foo") + rgEnd("src/a.ts") },
      ],
      exitCode: 0,
    });
    const out = await files.grep({ pattern: "foo" });
    expect(env.calls).toHaveLength(1);
    expect(env.calls[0]?.command).toEqual([...BASE_ARGV, "-e", "foo", ...TAIL_ARGV]);
    expect(env.calls[0]?.options?.cwd).toBe("/work");
    expect(out).toEqual({
      root: "/work",
      matches: [{ path: "src/a.ts", line: 2, text: "foo", kind: "match" }],
    });
  });

  test("ignoreCase, literal, context and glob become rg flags, and context 0 adds no -C", async () => {
    const { env, files } = setup();
    env.mkdir("/work/src");
    // 글로브가 있으면 두 번째 호출이 .gitignore를 지킨 목록을 얻는다(visibleFiles). 그다음은 글로브 없는 호출이다
    env.reply({ exitCode: 1 }, { exitCode: 1 }, { exitCode: 1 });
    await files.grep({
      pattern: "a+b",
      path: "src",
      ignoreCase: true,
      literal: true,
      context: 2,
      glob: "*.ts",
    });
    await files.grep({ pattern: "a+b", context: 0 });
    expect(env.calls[0]?.command).toEqual([
      ...BASE_ARGV,
      "-e",
      "a+b",
      "-i",
      "-F",
      "-C",
      "2",
      "--glob",
      "*.ts",
      ...TAIL_ARGV,
    ]);
    expect(env.calls[0]?.options?.cwd).toBe("/work/src");
    expect(env.calls[1]?.command).toEqual([
      RG,
      "--files",
      "--no-config",
      "--no-require-git",
      "--sort",
      "path",
      "--no-messages",
      "--",
      ".",
    ]);
    expect(env.calls[1]?.options?.cwd).toBe("/work/src");
    expect(env.calls[2]?.command).toEqual([...BASE_ARGV, "-e", "a+b", ...TAIL_ARGV]);
  });

  test("a glob keeps only the matches in files that rg lists without the glob", async () => {
    // --glob은 .gitignore를 넘어 ignored.txt를 찾는다. 글로브 없는 목록에 없으므로 버린다
    const { env, files } = setup();
    env.reply(
      {
        chunks: [
          {
            text: rgLine("match", "a.txt", 1, "foo") + rgLine("match", "ignored.txt", 1, "foo"),
          },
        ],
        exitCode: 0,
      },
      { chunks: [{ text: "./a.txt\n" }], exitCode: 0 },
    );
    const out = await files.grep({ pattern: "foo", glob: "*.txt" });
    expect(out.matches).toEqual([{ path: "a.txt", line: 1, text: "foo", kind: "match" }]);
  });

  test("a pattern that starts with a dash stays the value of -e", async () => {
    const { env, files } = setup();
    env.reply({ exitCode: 1 });
    await files.grep({ pattern: "-x" });
    expect(env.calls[0]?.command).toEqual([...BASE_ARGV, "-e", "-x", ...TAIL_ARGV]);
  });

  test("a JSON line split across output chunks is parsed whole", async () => {
    const { env, files } = setup();
    const full = rgLine("match", "a.txt", 1, "hello world");
    env.reply({ chunks: [{ text: full.slice(0, 17) }, { text: full.slice(17) }], exitCode: 0 });
    const out = await files.grep({ pattern: "hello" });
    expect(out.matches).toEqual([{ path: "a.txt", line: 1, text: "hello world", kind: "match" }]);
  });
});

describe("grep results", () => {
  test("no match is an empty result, not an error", async () => {
    const { env, files } = setup();
    env.reply({ exitCode: 1 });
    expect(await files.grep({ pattern: "nothing" })).toEqual({ root: "/work", matches: [] });
  });

  test("context lines are kept around a retained match", async () => {
    const { env, files } = setup();
    env.reply({
      chunks: [
        {
          text:
            rgLine("context", "a.txt", 1, "before") +
            rgLine("match", "a.txt", 2, "foo") +
            rgLine("context", "a.txt", 3, "after"),
        },
      ],
      exitCode: 0,
    });
    const out = await files.grep({ pattern: "foo", context: 1 });
    expect(out.matches).toEqual([
      { path: "a.txt", line: 1, text: "before", kind: "context" },
      { path: "a.txt", line: 2, text: "foo", kind: "match" },
      { path: "a.txt", line: 3, text: "after", kind: "context" },
    ]);
    expect(out.truncated).toBeUndefined();
  });

  test("the entry limit counts matches and drops the leading context of the cut match", async () => {
    const { env, files } = setup();
    // 문맥 1줄. 두 번째 일치(5)의 앞 문맥 4줄은 남기지 않는다. 첫 일치(2)의 뒤 문맥 3줄은 남긴다
    env.reply({
      chunks: [
        {
          text:
            rgLine("context", "a.txt", 1, "a") +
            rgLine("match", "a.txt", 2, "foo") +
            rgLine("context", "a.txt", 3, "b") +
            rgLine("context", "a.txt", 4, "c") +
            rgLine("match", "a.txt", 5, "foo") +
            rgLine("context", "a.txt", 6, "d"),
        },
      ],
      exitCode: 0,
    });
    const out = await files.grep({ pattern: "foo", context: 1, limit: 1 });
    expect(out.matches.map((m) => [m.line, m.kind])).toEqual([
      [1, "context"],
      [2, "match"],
      [3, "context"],
    ]);
    expect(out.truncated).toEqual({ by: "entries", shown: 1, total: 2 });
  });

  test("the entry limit comes from the setting when the call has none, and the call wins over it", async () => {
    const { env, files } = setup({ settings: settingsWith({ grep: { maxMatches: 2 } }) });
    const three = [1, 2, 3].map((line) => rgLine("match", "a.txt", line, "foo")).join("");
    env.reply({ chunks: [{ text: three }], exitCode: 0 });
    expect(await files.grep({ pattern: "foo" })).toEqual({
      root: "/work",
      matches: [
        { path: "a.txt", line: 1, text: "foo", kind: "match" },
        { path: "a.txt", line: 2, text: "foo", kind: "match" },
      ],
      truncated: { by: "entries", shown: 2, total: 3 },
    });
    env.reply({ chunks: [{ text: three }], exitCode: 0 });
    const explicit = await files.grep({ pattern: "foo", limit: 1 });
    expect(explicit.matches).toHaveLength(1);
    expect(explicit.truncated).toEqual({ by: "entries", shown: 1, total: 3 });
  });

  test("the byte limit of read cuts the matches by bytes", async () => {
    // 한 줄은 "a.txt:N: " 9바이트 + 본문 10바이트 + 개행 1바이트 = 20바이트. 45바이트에는 두 줄만 들어간다
    const { env, files } = setup({ settings: settingsWith({ read: { maxBytes: 45 } }) });
    const text = "x".repeat(10);
    const three = [1, 2, 3].map((line) => rgLine("match", "a.txt", line, text)).join("");
    env.reply({ chunks: [{ text: three }], exitCode: 0 });
    const out = await files.grep({ pattern: "x" });
    expect(out.matches).toHaveLength(2);
    expect(out.truncated).toEqual({ by: "bytes", shown: 2, total: 3 });
  });

  test("a long line is cut to the setting length in characters, not in code units", async () => {
    const { env, files } = setup({ settings: settingsWith({ grep: { maxLineLength: 80 } }) });
    const emoji = "\u{1F600}".repeat(90);
    env.reply({ chunks: [{ text: rgLine("match", "a.txt", 1, emoji) }], exitCode: 0 });
    const out = await files.grep({ pattern: "x" });
    expect(out.matches[0]?.text).toBe("\u{1F600}".repeat(80));
  });

  test("results keep rg's order, which is the path order", async () => {
    const { env, files } = setup();
    env.reply({
      chunks: [{ text: rgLine("match", "a/b.txt", 1, "foo") + rgLine("match", "b.txt", 1, "foo") }],
      exitCode: 0,
    });
    const out = await files.grep({ pattern: "foo" });
    expect(out.matches.map((m) => m.path)).toEqual(["a/b.txt", "b.txt"]);
  });
});

describe("grep failures", () => {
  test("a regex error from rg is pattern_invalid with the pattern", async () => {
    const { env, files } = setup();
    env.reply({
      exitCode: 2,
      chunks: [
        {
          stream: "stderr",
          text: "rg: regex parse error:\n    (?:\n    ^\nerror: unclosed group\n",
        },
      ],
    });
    const error = await rejection(files.grep({ pattern: "(?:" }));
    expect(error.data.code).toBe("pattern_invalid");
    expect(error.data.detail).toEqual({ syntax: "regex", pattern: "(?:" });
    expect(error.data.message).toContain("regex parse error");
  });

  test("a glob error from rg is pattern_invalid with the glob", async () => {
    const { env, files } = setup();
    env.reply({
      exitCode: 2,
      chunks: [
        {
          stream: "stderr",
          text: "rg: error parsing glob '[': unclosed character class; missing ']'\n",
        },
      ],
    });
    const error = await rejection(files.grep({ pattern: "x", glob: "[" }));
    expect(error.data.code).toBe("pattern_invalid");
    expect(error.data.detail).toEqual({ syntax: "glob", pattern: "[" });
  });

  test("any other rg failure is internal and carries rg's message", async () => {
    const { env, files } = setup();
    env.reply({ exitCode: 2, chunks: [{ stream: "stderr", text: "rg: something broke\n" }] });
    const error = await rejection(files.grep({ pattern: "x" }));
    expect(error.data.code).toBe("internal");
    expect(error.data.message).toContain("something broke");
  });

  test("a missing rg is unavailable with rg_missing, and rg does not run", async () => {
    const missing = setup({ rg: missingRg() });
    const error = await rejection(missing.files.grep({ pattern: "x" }));
    expect(error.data.code).toBe("unavailable");
    expect(error.data.detail).toEqual({ reason: "rg_missing" });
    expect(missing.env.calls).toHaveLength(0);

    const noResolver = setup({ rg: null });
    const absent = await rejection(noResolver.files.grep({ pattern: "x" }));
    expect(absent.data.code).toBe("unavailable");
    expect(absent.data.detail).toEqual({ reason: "rg_missing" });
  });

  test("an rg that cannot be started is unavailable with rg_missing", async () => {
    const { env, files } = setup();
    env.reply({ error: { code: "spawn_error" } });
    const error = await rejection(files.grep({ pattern: "x" }));
    expect(error.data.code).toBe("unavailable");
    expect(error.data.detail).toEqual({ reason: "rg_missing" });
  });

  test("the grep.rgPath setting is handed to the resolver and the resolved path runs rg", async () => {
    const asked: string[] = [];
    const { env, files } = setup({
      settings: settingsWith({ grep: { rgPath: "/opt/rg/rg" } }),
      rg: (rgPath) => {
        asked.push(rgPath);
        return Promise.resolve(ok(RG));
      },
    });
    env.reply({ exitCode: 1 });
    await files.grep({ pattern: "x" });
    expect(asked).toEqual(["/opt/rg/rg"]);
    expect(env.calls[0]?.command).toEqual([...BASE_ARGV, "-e", "x", ...TAIL_ARGV]);
  });
});

describe("grep paths", () => {
  test("the search directory must exist and be a directory, and must be inside the root", async () => {
    const { env, files } = setup();
    env.put("/work/a.txt", "x\n");
    env.mkdir("/elsewhere");
    expect((await rejection(files.grep({ pattern: "x", path: "nope" }))).data.code).toBe(
      "not_found",
    );
    expect((await rejection(files.grep({ pattern: "x", path: "a.txt" }))).data.code).toBe(
      "invalid_input",
    );
    const outside = await rejection(files.grep({ pattern: "x", path: "../elsewhere" }));
    expect(outside.data.code).toBe("denied");
    expect(outside.data.detail).toMatchObject({ reason: "outside_root" });
    expect(env.calls).toHaveLength(0);
  });

  test("a protected search directory is denied before rg runs", async () => {
    const protectedPaths: readonly ProtectedPathEntry[] = [
      { path: "/work/private", match: "prefix", access: "read_write", reason: "secret_key" },
    ];
    const { env, files } = setup({ protectedPaths });
    env.mkdir("/work/private");
    const error = await rejection(files.grep({ pattern: "x", path: "private" }));
    expect(error.data.code).toBe("denied");
    expect(error.data.detail).toMatchObject({
      reason: "protected_path",
      protectedBy: "secret_key",
    });
    expect(env.calls).toHaveLength(0);
  });

  test("matches under a read-protected path inside the root are dropped", async () => {
    const protectedPaths: readonly ProtectedPathEntry[] = [
      { path: "/work/private", match: "prefix", access: "read_write", reason: "secret_key" },
    ];
    const { env, files } = setup({ protectedPaths });
    env.reply({
      chunks: [
        {
          text:
            rgLine("match", "private/key", 1, "secret") + rgLine("match", "src/a.ts", 4, "secret"),
        },
      ],
      exitCode: 0,
    });
    const out = await files.grep({ pattern: "secret" });
    expect(out).toEqual({
      root: "/work",
      matches: [{ path: "src/a.ts", line: 4, text: "secret", kind: "match" }],
    });
  });

  test("a thread's workspace is the cwd and the root of the search", async () => {
    const ids = fixedIdFactory();
    const alpha = ids.next("thr");
    const env: MemoryEnv = memoryEnv({ cwd: "/work" });
    env.mkdir("/work");
    env.mkdir("/projects/alpha");
    const threads: ThreadWorkspaces = {
      workspaceOf: (threadId) => (threadId === alpha ? "/projects/alpha" : null),
      envAt: (cwd) => env.withCwd(cwd),
    };
    const files = createFilesApi(depsFor(env, { threads }));
    env.put("/projects/alpha/a.txt", "foo\n");
    env.reply({ chunks: [{ text: rgLine("match", "a.txt", 1, "foo") }], exitCode: 0 });
    const out = await files.grep(
      { pattern: "foo" },
      { context: { threadId: alpha, caller: { kind: "host" } } },
    );
    expect(out.root).toBe("/projects/alpha");
    expect(env.calls[0]?.options?.cwd).toBe("/projects/alpha");
    expect(out.matches).toEqual([{ path: "a.txt", line: 1, text: "foo", kind: "match" }]);
  });
});
