import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { ok } from "@xeon/contracts";
import { createFilesApi } from "../src/service.ts";
import { rejection } from "./support/assertions.ts";
import { realDeps, realEnv } from "./support/real-env.ts";

// L2.workspace.spec §3.2 grep·find, §4.3(심볼릭 링크를 따라가지 않음), §10 미결 6(find의 glob 의미).
// 실제 ripgrep 실행 파일과 실제 파일 시스템으로 확인한다. rg가 PATH에 없으면 건너뛴다.

const RG = Bun.which("rg");
const dirs: string[] = [];

function tempRoot(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "xeon-rg-int-")));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function filesAt(root: string) {
  const env = realEnv(root);
  const binary = RG ?? "rg";
  return createFilesApi({
    ...realDeps(env),
    rg: (rgPath) => Promise.resolve(ok(rgPath === "" ? binary : rgPath)),
  });
}

function write(root: string, path: string, content: string): void {
  const full = join(root, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

describe.skipIf(RG === null)("grep and find on a real ripgrep", () => {
  test("grep and find honour .gitignore in a directory that is not a git repository", async () => {
    const root = tempRoot();
    write(root, ".gitignore", "ignored.txt\nbuild/\n");
    write(root, "ignored.txt", "foo\n");
    write(root, "build/out.txt", "foo\n");
    write(root, "keep.txt", "foo\n");
    const files = filesAt(root);
    const grep = await files.grep({ pattern: "foo" });
    expect(grep.matches.map((m) => m.path)).toEqual(["keep.txt"]);
    expect((await files.find({ pattern: "*.txt" })).paths).toEqual(["keep.txt"]);
  });

  test("symbolic links are not followed, and hidden files are skipped by default", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    write(outside, "secret.txt", "foo\n");
    write(root, "real.txt", "foo\n");
    write(root, ".hidden.txt", "foo\n");
    symlinkSync(join(root, "real.txt"), join(root, "link.txt"));
    symlinkSync(outside, join(root, "linkdir"));
    const files = filesAt(root);
    expect((await files.grep({ pattern: "foo" })).matches.map((m) => m.path)).toEqual(["real.txt"]);
    expect((await files.find({ pattern: "*" })).paths).toEqual(["real.txt"]);
  });

  test("a glob does not bring back ignored or hidden files", async () => {
    const root = tempRoot();
    write(root, ".gitignore", "ignored.txt\n");
    write(root, "ignored.txt", "foo\n");
    write(root, ".hidden.txt", "foo\n");
    write(root, "keep.txt", "foo\n");
    const files = filesAt(root);
    // rg --glob은 예외 규칙이라 .gitignore와 숨김 파일을 되살린다. 결과는 글로브 없는 목록과 교차해야 한다
    expect((await files.find({ pattern: "*.txt" })).paths).toEqual(["keep.txt"]);
    expect((await files.find({ pattern: "*" })).paths).toEqual(["keep.txt"]);
    expect(
      (await files.grep({ pattern: "foo", glob: "*.txt" })).matches.map((m) => m.path),
    ).toEqual(["keep.txt"]);
  });

  test("results are in bytewise path order", async () => {
    const root = tempRoot();
    // 바이트 순: "B.txt"(0x42) < "a/..."(0x61) < "b.txt"(0x62) < "é.txt"(0xC3) < "～"(EF BD 9E)
    for (const name of ["b.txt", "é.txt", "B.txt", "a/x.txt", "～.txt"]) write(root, name, "foo\n");
    const files = filesAt(root);
    expect((await files.find({ pattern: "*.txt" })).paths).toEqual([
      "B.txt",
      "a/x.txt",
      "b.txt",
      "é.txt",
      "～.txt",
    ]);
    expect((await files.grep({ pattern: "foo" })).matches.map((m) => m.path)).toEqual([
      "B.txt",
      "a/x.txt",
      "b.txt",
      "é.txt",
      "～.txt",
    ]);
  });

  test("regex by default, literal with literal, and ignoreCase", async () => {
    const root = tempRoot();
    write(root, "a.txt", "abc\na.c\nABC\n");
    const files = filesAt(root);
    const regex = await files.grep({ pattern: "a.c" });
    expect(regex.matches.map((m) => m.line)).toEqual([1, 2]);
    const literal = await files.grep({ pattern: "a.c", literal: true });
    expect(literal.matches.map((m) => m.line)).toEqual([2]);
    const ignoring = await files.grep({ pattern: "abc", ignoreCase: true });
    expect(ignoring.matches.map((m) => m.line)).toEqual([1, 3]);
  });

  test("context lines come with their matches, and the glob filters by name at any depth", async () => {
    const root = tempRoot();
    write(root, "src/a.ts", "one\ntwo foo\nthree\nfour\n");
    write(root, "src/b.md", "foo\n");
    write(root, "top.ts", "foo\n");
    const files = filesAt(root);
    const out = await files.grep({ pattern: "foo", context: 1, glob: "*.ts" });
    expect(out.matches).toEqual([
      { path: "src/a.ts", line: 1, text: "one", kind: "context" },
      { path: "src/a.ts", line: 2, text: "two foo", kind: "match" },
      { path: "src/a.ts", line: 3, text: "three", kind: "context" },
      { path: "top.ts", line: 1, text: "foo", kind: "match" },
    ]);
  });

  test("an invalid regex is pattern_invalid with rg's message", async () => {
    const root = tempRoot();
    write(root, "a.txt", "x\n");
    const error = await rejection(filesAt(root).grep({ pattern: "(?:" }));
    expect(error.data.code).toBe("pattern_invalid");
    expect(error.data.detail).toEqual({ syntax: "regex", pattern: "(?:" });
    expect(error.data.message).toContain("regex parse error");
  });

  test("a pattern that starts with a dash is searched as a pattern", async () => {
    const root = tempRoot();
    write(root, "a.txt", "-x\nx\n");
    const out = await filesAt(root).grep({ pattern: "-x", literal: true });
    expect(out.matches).toEqual([{ path: "a.txt", line: 1, text: "-x", kind: "match" }]);
  });

  test("no match is an empty result and an unknown glob is pattern_invalid", async () => {
    const root = tempRoot();
    write(root, "a.txt", "x\n");
    const files = filesAt(root);
    expect(await files.grep({ pattern: "zzz" })).toEqual({ root, matches: [] });
    const error = await rejection(files.grep({ pattern: "x", glob: "[" }));
    expect(error.data.code).toBe("pattern_invalid");
    expect(error.data.detail).toEqual({ syntax: "glob", pattern: "[" });
  });

  test("find glob forms: a bare name matches at any depth, a slash anchors to the root, ** crosses directories", async () => {
    const root = tempRoot();
    write(root, "x.ts", "");
    write(root, "src/x.ts", "");
    write(root, "src/deep/x.ts", "");
    write(root, "src/a.spec.ts", "");
    write(root, "src/deep/b.spec.ts", "");
    const files = filesAt(root);
    expect((await files.find({ pattern: "x.ts" })).paths).toEqual([
      "src/deep/x.ts",
      "src/x.ts",
      "x.ts",
    ]);
    expect((await files.find({ pattern: "src/*.ts" })).paths).toEqual([
      "src/a.spec.ts",
      "src/x.ts",
    ]);
    expect((await files.find({ pattern: "**/*.spec.ts" })).paths).toEqual([
      "src/a.spec.ts",
      "src/deep/b.spec.ts",
    ]);
  });

  test("grep and find under a search directory report paths relative to it", async () => {
    const root = tempRoot();
    write(root, "pkg/src/m.ts", "foo\n");
    const files = filesAt(root);
    const out = await files.grep({ pattern: "foo", path: "pkg" });
    expect(out).toEqual({
      root: join(root, "pkg"),
      matches: [{ path: "src/m.ts", line: 1, text: "foo", kind: "match" }],
    });
    expect(await files.find({ pattern: "*.ts", path: "pkg" })).toEqual({
      root: join(root, "pkg"),
      paths: ["src/m.ts"],
    });
  });

  test("a search directory outside the root is denied before rg runs", async () => {
    const root = tempRoot();
    const error = await rejection(filesAt(root).grep({ pattern: "x", path: "../.." }));
    expect(error.data.code).toBe("denied");
  });
});
