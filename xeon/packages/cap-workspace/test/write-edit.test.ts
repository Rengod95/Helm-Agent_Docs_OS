import { describe, expect, test } from "bun:test";
import type { ProtectedPathEntry } from "@fresnel/contracts/services";
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

async function bytesOf(env: ReturnType<typeof memoryEnv>, path: string): Promise<number[]> {
  const read = await env.readBinaryFile(path, { abortSignal: undefined });
  if (!read.ok) throw read.error;
  return [...read.value];
}

describe("edit refuses files that are not valid UTF-8 text", () => {
  test("CP949 bytes are rejected as edit_not_text and stay byte for byte", async () => {
    const { env, files } = setup();
    // "한글" in CP949 is c7 d1 b1 db, plus ASCII "foo" to edit
    const original = new Uint8Array([0x66, 0x6f, 0x6f, 0x20, 0xc7, 0xd1, 0xb1, 0xdb, 0x0a]);
    env.put("/work/k.txt", original);
    const failure = await rejection(
      files.edit({ path: "k.txt", edits: [{ oldText: "foo", newText: "bar" }] }),
    );
    expect(failure.data.code).toBe("edit_not_text");
    expect(await bytesOf(env, "/work/k.txt")).toEqual([...original]);
  });

  test("a NUL byte is rejected even when the rest is valid UTF-8", async () => {
    const { env, files } = setup();
    const original = new Uint8Array([0x66, 0x6f, 0x6f, 0x00, 0x62, 0x0a]);
    env.put("/work/n.bin", original);
    const failure = await rejection(
      files.edit({ path: "n.bin", edits: [{ oldText: "foo", newText: "bar" }] }),
    );
    expect(failure.data.code).toBe("edit_not_text");
    expect(await bytesOf(env, "/work/n.bin")).toEqual([...original]);
  });

  test("valid UTF-8 Korean text and a BOM still edit", async () => {
    const { env, files } = setup();
    env.put("/work/ok.txt", "﻿한글 foo\n");
    await files.edit({ path: "ok.txt", edits: [{ oldText: "foo", newText: "bar" }] });
    expect(await text(env, "/work/ok.txt")).toBe("﻿한글 bar\n");
  });

  test("write over a non-text file replaces it and records an empty before", async () => {
    const { env, files } = setup();
    env.put("/work/k.txt", new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]));
    const result = await files.write({ path: "k.txt", content: "new\n" });
    expect(await text(env, "/work/k.txt")).toBe("new\n");
    expect(result.change.removed).toBe(0);
    expect(result.change.added).toBe(1);
  });
});
