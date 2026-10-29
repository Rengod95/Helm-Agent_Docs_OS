import { describe, expect, test } from "bun:test";
import { ok } from "@xeon/contracts";
import type { ProtectedPathEntry } from "@xeon/contracts/services";
import { createFilesApi } from "../src/service.ts";
import { DEFAULT_WORKSPACE_SETTINGS, type WorkspaceSettings } from "../src/settings.ts";
import { rejection } from "./support/assertions.ts";
import { depsFor, missingRg, type DepsOptions } from "./support/fakes.ts";
import { memoryEnv } from "./support/memory-env.ts";

// L2.workspace.spec §3.2 find, §4.3, §4.5, §10 미결 6. 엔진은 rg --files --glob이다. rg는 MemoryEnv.reply로 흉내 낸다.
// 글로브 결과는 글로브 없는 목록(visibleFiles)과 교차한다. 실제 rg와의 glob 의미는 test/rg.int.test.ts가 고정한다.

const RG = "/bundle/rg";
const GLOB_ARGV = [RG, "--files", "--no-config", "--no-require-git", "--sort", "path", "--glob"];
const VISIBLE_ARGV = [
  RG,
  "--files",
  "--no-config",
  "--no-require-git",
  "--sort",
  "path",
  "--no-messages",
  "--",
  ".",
];
const TAIL = ["--no-messages", "--", "."];

/** rg --files 출력 한 덩이 */
function listing(...paths: string[]): { chunks: { text: string }[]; exitCode: number } {
  return { chunks: [{ text: paths.map((path) => `./${path}\n`).join("") }], exitCode: 0 };
}

/** 이름 30바이트짜리 경로. 인덱스로 구별한다 */
function nameOf(index: number): string {
  return `${String(index).padStart(2, "0")}${"n".repeat(28)}`;
}

function setup(
  options: DepsOptions & { readonly maxResults?: number; readonly maxBytes?: number } = {},
) {
  const { maxResults, maxBytes, ...deps } = options;
  const settings = (): WorkspaceSettings => ({
    ...DEFAULT_WORKSPACE_SETTINGS,
    find: { maxResults: maxResults ?? DEFAULT_WORKSPACE_SETTINGS.find.maxResults },
    read: {
      ...DEFAULT_WORKSPACE_SETTINGS.read,
      maxBytes: maxBytes ?? DEFAULT_WORKSPACE_SETTINGS.read.maxBytes,
    },
  });
  const env = memoryEnv({ cwd: "/work" });
  env.mkdir("/work");
  const files = createFilesApi(depsFor(env, { settings, ...deps }));
  return { env, files };
}

describe("find", () => {
  test("find runs rg --files with the glob, then keeps the files rg lists without it", async () => {
    const { env, files } = setup();
    // 글로브 결과에는 ignored.spec.ts가 있지만 글로브 없는 목록에는 없다(.gitignore). 버린다
    env.reply(
      listing("a.spec.ts", "src/b.spec.ts", "ignored.spec.ts"),
      listing("a.spec.ts", "src/b.spec.ts"),
    );
    const out = await files.find({ pattern: "**/*.spec.ts" });
    expect(env.calls).toHaveLength(2);
    expect(env.calls[0]?.command).toEqual([...GLOB_ARGV, "**/*.spec.ts", ...TAIL]);
    expect(env.calls[0]?.options?.cwd).toBe("/work");
    expect(env.calls[1]?.command).toEqual(VISIBLE_ARGV);
    expect(env.calls[1]?.options?.cwd).toBe("/work");
    expect(out).toEqual({ root: "/work", paths: ["a.spec.ts", "src/b.spec.ts"] });
  });

  test("no file is an empty result, and the second listing is not needed", async () => {
    const { env, files } = setup();
    env.reply({ exitCode: 1 });
    expect(await files.find({ pattern: "*.nothing" })).toEqual({ root: "/work", paths: [] });
    expect(env.calls).toHaveLength(1);
  });

  test("the search directory comes from path and its root is that directory", async () => {
    const { env, files } = setup();
    env.mkdir("/work/src");
    env.reply(listing("x.ts"), listing("x.ts"));
    const out = await files.find({ pattern: "*.ts", path: "src" });
    expect(env.calls[0]?.options?.cwd).toBe("/work/src");
    expect(env.calls[1]?.options?.cwd).toBe("/work/src");
    expect(out).toEqual({ root: "/work/src", paths: ["x.ts"] });
  });

  test("the limit counts paths, and the setting applies when the call has no limit", async () => {
    const { env, files } = setup({ maxResults: 2 });
    env.reply(listing("a", "b", "c"), listing("a", "b", "c"));
    expect(await files.find({ pattern: "*" })).toEqual({
      root: "/work",
      paths: ["a", "b"],
      truncated: { by: "entries", shown: 2, total: 3 },
    });
    env.reply(listing("a", "b", "c"), listing("a", "b", "c"));
    const explicit = await files.find({ pattern: "*", limit: 3 });
    expect(explicit.paths).toHaveLength(3);
    expect(explicit.truncated).toBeUndefined();
  });

  test("the byte limit of read cuts the paths by bytes", async () => {
    // 한 줄은 이름 30바이트와 개행 1바이트다. 65바이트에는 두 줄만 들어간다
    const { env, files } = setup({ maxBytes: 65 });
    env.reply(listing(nameOf(1), nameOf(2), nameOf(3)), listing(nameOf(1), nameOf(2), nameOf(3)));
    const out = await files.find({ pattern: "*" });
    expect(out.paths).toHaveLength(2);
    expect(out.truncated).toEqual({ by: "bytes", shown: 2, total: 3 });
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
    const error = await rejection(files.find({ pattern: "[" }));
    expect(error.data.code).toBe("pattern_invalid");
    expect(error.data.detail).toEqual({ syntax: "glob", pattern: "[" });
    expect(env.calls).toHaveLength(1);
  });

  test("a missing rg is unavailable with rg_missing, and rg does not run", async () => {
    const { env, files } = setup({ rg: missingRg() });
    const error = await rejection(files.find({ pattern: "*" }));
    expect(error.data.code).toBe("unavailable");
    expect(error.data.detail).toEqual({ reason: "rg_missing" });
    expect(env.calls).toHaveLength(0);
  });

  test("the grep.rgPath setting reaches the resolver for find too", async () => {
    const asked: string[] = [];
    const { env, files } = setup({
      settings: () => ({
        ...DEFAULT_WORKSPACE_SETTINGS,
        grep: { ...DEFAULT_WORKSPACE_SETTINGS.grep, rgPath: "/opt/rg/rg" },
      }),
      rg: (rgPath) => {
        asked.push(rgPath);
        return Promise.resolve(ok(RG));
      },
    });
    env.reply({ exitCode: 1 });
    await files.find({ pattern: "*" });
    expect(asked).toEqual(["/opt/rg/rg"]);
  });

  test("the search directory must exist, be a directory, and be inside the root", async () => {
    const { env, files } = setup();
    env.put("/work/a.txt", "x");
    env.mkdir("/elsewhere");
    expect((await rejection(files.find({ pattern: "*", path: "nope" }))).data.code).toBe(
      "not_found",
    );
    expect((await rejection(files.find({ pattern: "*", path: "a.txt" }))).data.code).toBe(
      "invalid_input",
    );
    const outside = await rejection(files.find({ pattern: "*", path: "../elsewhere" }));
    expect(outside.data.detail).toMatchObject({ reason: "outside_root" });
    expect(env.calls).toHaveLength(0);
  });

  test("a protected search directory is denied before rg runs", async () => {
    const protectedPaths: readonly ProtectedPathEntry[] = [
      { path: "/work/private", match: "prefix", access: "read_write", reason: "secret_key" },
    ];
    const { env, files } = setup({ protectedPaths });
    env.mkdir("/work/private");
    const error = await rejection(files.find({ pattern: "*", path: "private" }));
    expect(error.data.detail).toMatchObject({ reason: "protected_path" });
    expect(env.calls).toHaveLength(0);
  });
});
