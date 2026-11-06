import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dialogsModule } from "../src/main/dialogs.ts";
import {
  FOLDER_LIST_MAX_DEPTH,
  FOLDER_LIST_MAX_ENTRIES,
  MAX_FOLDER_HANDLES,
  relativeSegments,
} from "../src/main/folder-access.ts";
import { fakeCtx, type FakeCtx } from "./support/fake-ctx.ts";

const SCOPE = "helm/graph";

/** 폴더 하나를 만들고 고른 것으로 하여 핸들을 받는다 */
async function openFolder(fake: FakeCtx, root: string, scope = SCOPE): Promise<string> {
  fake.dialogs.folder = root;
  const reply = await fake.call("pick_folder_open", { scope });
  const value: unknown = reply.ok ? reply.value : undefined;
  const handle: unknown = Object.getOwnPropertyDescriptor(value, "handle")?.value;
  if (typeof handle !== "string") throw new Error("no handle");
  return handle;
}

function fixture(): { fake: FakeCtx; root: string; outside: string } {
  const fake = fakeCtx();
  dialogsModule.register(fake.ctx);
  const root = path.join(fake.dir, "proj");
  const outside = path.join(fake.dir, "secret");
  mkdirSync(path.join(root, "src", "deep"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(root, "a.md"), "# 가\n");
  writeFileSync(path.join(root, "src", "b.ts"), "export {};\n");
  writeFileSync(path.join(root, "src", "deep", "c.bin"), new Uint8Array([0xff, 0x00]));
  writeFileSync(path.join(outside, "key.txt"), "TOP");
  return { fake, root, outside };
}

describe("relative path text", () => {
  test("accepts plain segments and the empty path", () => {
    expect(relativeSegments("")).toEqual([]);
    expect(relativeSegments("src/b.ts")).toEqual(["src", "b.ts"]);
  });
  test("rejects dot segments, absolute, backslash, NUL and empty segments", () => {
    for (const bad of ["..", "../x", "a/../b", ".", "./a", "/etc", "a\\b", "a\0b", "a//b", "a/"]) {
      expect(relativeSegments(bad)).toBeUndefined();
    }
  });
});

describe("pick_folder_open", () => {
  test("answers handle, full path and name; cancel is null", async () => {
    const { fake, root } = fixture();
    fake.dialogs.folder = root;
    const reply = await fake.call("pick_folder_open", { scope: SCOPE });
    expect(reply.ok).toBe(true);
    const value: unknown = reply.ok ? reply.value : undefined;
    expect(Object.getOwnPropertyDescriptor(value, "path")?.value).toBe(root);
    expect(Object.getOwnPropertyDescriptor(value, "name")?.value).toBe("proj");
    fake.dialogs.folder = null;
    expect(await fake.call("pick_folder_open", { scope: SCOPE })).toEqual({
      ok: true,
      value: null,
    });
  });
  test("needs a scope", async () => {
    const { fake, root } = fixture();
    fake.dialogs.folder = root;
    expect(await fake.call("pick_folder_open", {})).toEqual({ ok: false, error: "bad-request" });
  });
});

describe("folder_list", () => {
  test("lists one level by default and the whole tree when recursive", async () => {
    const { fake, root } = fixture();
    const handle = await openFolder(fake, root);
    expect(await fake.call("folder_list", { scope: SCOPE, handle })).toEqual({
      ok: true,
      value: {
        entries: [
          { path: "a.md", name: "a.md", kind: "file", size: 6 },
          { path: "src", name: "src", kind: "dir" },
        ],
        truncated: false,
      },
    });
    const deep = await fake.call("folder_list", { scope: SCOPE, handle, recursive: true });
    expect(deep).toEqual({
      ok: true,
      value: {
        entries: [
          { path: "a.md", name: "a.md", kind: "file", size: 6 },
          { path: "src", name: "src", kind: "dir" },
          { path: "src/b.ts", name: "b.ts", kind: "file", size: 11 },
          { path: "src/deep", name: "deep", kind: "dir" },
          { path: "src/deep/c.bin", name: "c.bin", kind: "file", size: 2 },
        ],
        truncated: false,
      },
    });
    expect(await fake.call("folder_list", { scope: SCOPE, handle, path: "src" })).toEqual({
      ok: true,
      value: {
        entries: [
          { path: "src/b.ts", name: "b.ts", kind: "file", size: 11 },
          { path: "src/deep", name: "deep", kind: "dir" },
        ],
        truncated: false,
      },
    });
  });

  test("stops at the entry cap and says truncated", async () => {
    const { fake, root } = fixture();
    const many = path.join(root, "many");
    mkdirSync(many);
    for (let i = 0; i < FOLDER_LIST_MAX_ENTRIES + 5; i += 1)
      writeFileSync(path.join(many, `f${i}`), "");
    const handle = await openFolder(fake, root);
    const reply = await fake.call("folder_list", { scope: SCOPE, handle, path: "many" });
    const value: unknown = reply.ok ? reply.value : undefined;
    const entries: unknown = Object.getOwnPropertyDescriptor(value, "entries")?.value;
    expect(Array.isArray(entries) && entries.length).toBe(FOLDER_LIST_MAX_ENTRIES);
    expect(Object.getOwnPropertyDescriptor(value, "truncated")?.value).toBe(true);
  });

  test("does not descend below the depth cap", async () => {
    const { fake, root } = fixture();
    const parts = Array.from({ length: FOLDER_LIST_MAX_DEPTH + 3 }, (_, i) => `d${i}`);
    mkdirSync(path.join(root, "chain", ...parts), { recursive: true });
    const handle = await openFolder(fake, root);
    const reply = await fake.call("folder_list", {
      scope: SCOPE,
      handle,
      path: "chain",
      recursive: true,
    });
    const value: unknown = reply.ok ? reply.value : undefined;
    const entries: unknown = Object.getOwnPropertyDescriptor(value, "entries")?.value;
    expect(Array.isArray(entries) && entries.length).toBe(FOLDER_LIST_MAX_DEPTH);
  });

  test("a link pointing outside is not listed; a link inside is", async () => {
    const { fake, root, outside } = fixture();
    symlinkSync(outside, path.join(root, "escape"));
    symlinkSync(path.join(outside, "key.txt"), path.join(root, "leak.txt"));
    symlinkSync(path.join(root, "a.md"), path.join(root, "alias.md"));
    const handle = await openFolder(fake, root);
    const reply = await fake.call("folder_list", { scope: SCOPE, handle, recursive: true });
    const value: unknown = reply.ok ? reply.value : undefined;
    const entries: unknown = Object.getOwnPropertyDescriptor(value, "entries")?.value;
    const names = Array.isArray(entries)
      ? entries.map((entry: unknown): unknown => pathOf(entry))
      : [];
    expect(names).toEqual(["a.md", "alias.md", "src", "src/b.ts", "src/deep", "src/deep/c.bin"]);
  });
});

describe("folder_read", () => {
  test("reads text and binary files under the folder", async () => {
    const { fake, root } = fixture();
    const handle = await openFolder(fake, root);
    expect(await fake.call("folder_read", { scope: SCOPE, handle, path: "a.md" })).toEqual({
      ok: true,
      value: {
        name: "a.md",
        path: path.join(realRoot(root), "a.md"),
        size: 6,
        encoding: "utf8",
        content: "# 가\n",
      },
    });
    const bin = await fake.call("folder_read", { scope: SCOPE, handle, path: "src/deep/c.bin" });
    const value: unknown = bin.ok ? bin.value : undefined;
    expect(Object.getOwnPropertyDescriptor(value, "encoding")?.value).toBe("base64");
    expect(Object.getOwnPropertyDescriptor(value, "content")?.value).toBe("/wA=");
  });

  test("refuses .., absolute paths and the folder itself", async () => {
    const { fake, root } = fixture();
    const handle = await openFolder(fake, root);
    const bad = [
      "../secret/key.txt",
      "src/../../secret/key.txt",
      path.join(root, "a.md"),
      "",
      "src/..",
      "a\\..\\x",
    ];
    const replies = await Promise.all(
      bad.map((one) => fake.call("folder_read", { scope: SCOPE, handle, path: one })),
    );
    for (const reply of replies) expect(reply).toEqual({ ok: false, error: "outside-folder" });
  });

  test("refuses a link that leaves the folder, a dangling link stays read_failed", async () => {
    const { fake, root, outside } = fixture();
    symlinkSync(path.join(outside, "key.txt"), path.join(root, "leak.txt"));
    symlinkSync(outside, path.join(root, "escape"));
    symlinkSync(path.join(root, "nothing"), path.join(root, "dangling"));
    const handle = await openFolder(fake, root);
    expect(await fake.call("folder_read", { scope: SCOPE, handle, path: "leak.txt" })).toEqual({
      ok: false,
      error: "outside-folder",
    });
    expect(
      await fake.call("folder_read", { scope: SCOPE, handle, path: "escape/key.txt" }),
    ).toEqual({
      ok: false,
      error: "outside-folder",
    });
    expect(await fake.call("folder_list", { scope: SCOPE, handle, path: "escape" })).toEqual({
      ok: false,
      error: "outside-folder",
    });
    expect(await fake.call("folder_read", { scope: SCOPE, handle, path: "dangling" })).toEqual({
      ok: false,
      error: "read_failed",
    });
  });

  test("a folder that is not picked has no handle", async () => {
    const { fake, root } = fixture();
    await openFolder(fake, root);
    expect(
      await fake.call("folder_read", { scope: SCOPE, handle: "fld_other", path: "a.md" }),
    ).toEqual({
      ok: false,
      error: "unknown-folder",
    });
    expect(await fake.call("folder_list", { scope: SCOPE, handle: "/etc" })).toEqual({
      ok: false,
      error: "unknown-folder",
    });
  });

  test("a handle works only for the screen that picked it", async () => {
    const { fake, root } = fixture();
    const handle = await openFolder(fake, root);
    expect(await fake.call("folder_read", { scope: "helm/other", handle, path: "a.md" })).toEqual({
      ok: false,
      error: "unknown-folder",
    });
  });

  test("the oldest handle is forgotten past the cap", async () => {
    const { fake, root } = fixture();
    const first = await openFolder(fake, root);
    await Promise.all(Array.from({ length: MAX_FOLDER_HANDLES }, () => openFolder(fake, root)));
    expect(await fake.call("folder_list", { scope: SCOPE, handle: first })).toEqual({
      ok: false,
      error: "unknown-folder",
    });
  });
});

function pathOf(entry: unknown): unknown {
  const found: unknown = Object.getOwnPropertyDescriptor(entry, "path")?.value;
  return found;
}

function realRoot(root: string): string {
  return realpathSync(root);
}
