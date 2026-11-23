import { describe, expect, test } from "bun:test";
import { LIST_MAX_DEPTH, LIST_MAX_LIMIT } from "@fresnel/contracts/capabilities";
import { createFilesApi } from "../src/service.ts";
import { rejection } from "./support/assertions.ts";
import { depsFor, type DepsOptions } from "./support/fakes.ts";
import { memoryEnv } from "./support/memory-env.ts";

// `ls` 도구(AGE-77 질문 3): 명령 실행 없이 폴더를 둘러본다. 읽기 root 검사, 보호 경로 가림, 깊이와 항목 수 상한.

function setup(options: DepsOptions = {}) {
  const env = memoryEnv({ cwd: "/work" });
  env.mkdir("/work");
  const files = createFilesApi(depsFor(env, options));
  return { env, files };
}

describe("ls", () => {
  test("lists one level by default, in name order, with kinds", async () => {
    const { env, files } = setup();
    env.put("/work/b.txt", "b");
    env.put("/work/a.txt", "a");
    env.put("/work/src/deep/c.ts", "c");
    const out = await files.ls({});
    expect(out.root).toBe("/work");
    expect(out.entries).toEqual([
      { path: "a.txt", kind: "file" },
      { path: "b.txt", kind: "file" },
      { path: "src", kind: "directory" },
    ]);
    expect(out.truncated).toBeUndefined();
  });

  test("depth goes down more levels and is capped at the maximum", async () => {
    const { env, files } = setup();
    env.put("/work/a/b/c/d/e.txt", "e");
    const two = await files.ls({ depth: 2 });
    expect(two.entries.map((entry) => entry.path)).toEqual(["a", "a/b"]);
    const capped = await files.ls({ depth: LIST_MAX_DEPTH });
    expect(capped.entries.map((entry) => entry.path)).toEqual(["a", "a/b", "a/b/c"]);
  });

  test("the entry limit cuts the list and reports it", async () => {
    const { env, files } = setup();
    for (const name of ["a", "b", "c", "d"]) env.put(`/work/${name}.txt`, name);
    const out = await files.ls({ limit: 3 });
    expect(out.entries.map((entry) => entry.path)).toEqual(["a.txt", "b.txt", "c.txt"]);
    expect(out.truncated).toEqual({ by: "entries", shown: 3 });
  });

  test("the entry limit never exceeds the maximum", async () => {
    const { env, files } = setup();
    for (let index = 0; index < LIST_MAX_LIMIT + 5; index++) {
      env.put(`/work/f${String(index).padStart(5, "0")}`, "x");
    }
    const out = await files.ls({ limit: LIST_MAX_LIMIT + 100 });
    expect(out.entries).toHaveLength(LIST_MAX_LIMIT);
    expect(out.truncated).toEqual({ by: "entries", shown: LIST_MAX_LIMIT });
  });

  test("node_modules and .git show up but are not entered", async () => {
    const { env, files } = setup();
    env.put("/work/node_modules/x/index.js", "x");
    env.put("/work/.git/HEAD", "ref");
    const out = await files.ls({ depth: 3 });
    expect(out.entries.map((entry) => entry.path)).toEqual([".git", "node_modules"]);
  });

  test("a read-protected path is hidden from the list", async () => {
    const { env, files } = setup({
      protectedPaths: [
        { path: "/work/vault", match: "prefix", access: "read_write", reason: "user_extra" },
      ],
    });
    env.put("/work/vault/a.txt", "secret");
    env.put("/work/ok.txt", "ok");
    const out = await files.ls({ depth: 2 });
    expect(out.entries.map((entry) => entry.path)).toEqual(["ok.txt"]);
  });

  test("a folder outside the workspace keeps the read rule: refused as outside_root", async () => {
    const { env, files } = setup();
    env.put("/other/a.txt", "a");
    const error = await rejection(files.ls({ path: "/other" }));
    expect(error.data.code).toBe("denied");
    expect(error.data.detail).toMatchObject({ reason: "outside_root" });
  });

  test("a file, a missing path, and a symlink out of the workspace are refused", async () => {
    const { env, files } = setup();
    env.put("/work/a.txt", "a");
    env.put("/etc/passwd", "root");
    env.symlink("/work/link", "/etc");
    expect((await rejection(files.ls({ path: "a.txt" }))).data.code).toBe("invalid_input");
    expect((await rejection(files.ls({ path: "nope" }))).data.code).toBe("not_found");
    expect((await rejection(files.ls({ path: "link" }))).data.code).toBe("denied");
  });
});
