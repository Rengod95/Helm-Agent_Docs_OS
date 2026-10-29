import { describe, expect, test } from "bun:test";
import type { ProtectedPathEntry } from "@xeon/contracts/services";
import { createFilesApi } from "../src/service.ts";
import { DEFAULT_WORKSPACE_SETTINGS } from "../src/settings.ts";
import { rejection } from "./support/assertions.ts";
import { depsFor } from "./support/fakes.ts";
import { memoryEnv } from "./support/memory-env.ts";

// L2.workspace.spec §3.2 write·edit의 오류 코드, §4.3 쓰기 root·보호 경로 검사. 메모리 파일 시스템 위.

const PROTECTED: readonly ProtectedPathEntry[] = [
  { path: "/work/.git/hooks", match: "prefix", access: "write", reason: "git_exec" },
];

function setup(fuzzy = true) {
  const env = memoryEnv({ cwd: "/work" });
  env.mkdir("/work");
  const files = createFilesApi(
    depsFor(env, {
      protectedPaths: PROTECTED,
      settings: () => ({ ...DEFAULT_WORKSPACE_SETTINGS, edit: { fuzzy } }),
    }),
  );
  return { env, files };
}

async function text(env: ReturnType<typeof memoryEnv>, path: string): Promise<string> {
  const read = await env.readTextFile(path, { abortSignal: undefined });
  if (!read.ok) throw read.error;
  return read.value;
}

describe("edit failures leave the file untouched", () => {
  test("each failure has its own code and detail", async () => {
    const { env, files } = setup();
    env.put("/work/f.txt", "one\ntwo\ntwo\n");
    const missing = await rejection(
      files.edit({ path: "f.txt", edits: [{ oldText: "zzz", newText: "y" }] }),
    );
    const ambiguous = await rejection(
      files.edit({ path: "f.txt", edits: [{ oldText: "two", newText: "y" }] }),
    );
    const empty = await rejection(
      files.edit({ path: "f.txt", edits: [{ oldText: "", newText: "y" }] }),
    );
    const overlap = await rejection(
      files.edit({
        path: "f.txt",
        edits: [
          { oldText: "one\ntwo", newText: "a" },
          { oldText: "two\ntwo", newText: "b" },
        ],
      }),
    );
    const same = await rejection(
      files.edit({ path: "f.txt", edits: [{ oldText: "one", newText: "one" }] }),
    );
    expect([missing, ambiguous, empty, overlap, same].map((e) => e.data.code)).toEqual([
      "edit_not_found",
      "edit_ambiguous",
      "edit_empty_old_text",
      "edit_overlap",
      "edit_no_change",
    ]);
    expect(ambiguous.data.detail).toMatchObject({ editIndex: 0, totalEdits: 1, occurrences: 2 });
    expect(await text(env, "/work/f.txt")).toBe("one\ntwo\ntwo\n");
  });

  test("a disabled fuzzy setting reports fuzzyDisabled", async () => {
    const { env, files } = setup(false);
    env.put("/work/f.txt", "say “hi”\n");
    const missing = await rejection(
      files.edit({ path: "f.txt", edits: [{ oldText: 'say "hi"', newText: "x" }] }),
    );
    expect(missing.data.code).toBe("edit_not_found");
    expect(missing.data.detail).toMatchObject({ fuzzyDisabled: true });
  });

  test("a missing file is not_found and a directory is invalid_input", async () => {
    const { env, files } = setup();
    env.mkdir("/work/dir");
    const gone = await rejection(
      files.edit({ path: "nope.txt", edits: [{ oldText: "a", newText: "b" }] }),
    );
    const dir = await rejection(files.write({ path: "dir", content: "x" }));
    expect([gone.data.code, dir.data.code]).toEqual(["not_found", "invalid_input"]);
  });
});

describe("write and edit keep line endings and respect protected paths", () => {
  test("edit keeps CRLF and the BOM", async () => {
    const { env, files } = setup();
    env.put("/work/f.txt", "﻿a\r\nb\r\n");
    await files.edit({ path: "f.txt", edits: [{ oldText: "b", newText: "B" }] });
    expect(await text(env, "/work/f.txt")).toBe("﻿a\r\nB\r\n");
  });

  test("write is refused under a protected path and outside the root", async () => {
    const { env, files } = setup();
    env.mkdir("/work/.git/hooks");
    const hook = await rejection(files.write({ path: ".git/hooks/pre-commit", content: "x" }));
    const outside = await rejection(files.write({ path: "/etc/x", content: "x" }));
    expect(hook.data.detail).toMatchObject({ reason: "protected_path" });
    expect(outside.data.detail).toMatchObject({ reason: "outside_root" });
    expect(await env.exists("/work/.git/hooks/pre-commit", { abortSignal: undefined })).toEqual({
      ok: true,
      value: false,
    });
  });
});
