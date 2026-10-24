import { describe, expect, test } from "bun:test";
import { memoryFs } from "../src/testing/index.ts";

const context = { abortSignal: undefined };

describe("memoryFs", () => {
  test("memoryFs reads and writes files relative to cwd", async () => {
    const fs = memoryFs({ cwd: "/work", clock: { now: () => 42 } });
    expect(await fs.writeFile("a/b.txt", "hello\nworld", context)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await fs.readTextFile("/work/a/b.txt", context)).toEqual({
      ok: true,
      value: "hello\nworld",
    });
    expect(await fs.appendFile("a/b.txt", "!", context)).toEqual({ ok: true, value: undefined });
    expect(await fs.readTextLines("a/b.txt", { maxLines: 1 }, context)).toEqual({
      ok: true,
      value: ["hello"],
    });
    expect(await fs.fileInfo("a/b.txt", context)).toEqual({
      ok: true,
      value: { name: "b.txt", path: "/work/a/b.txt", kind: "file", size: 12, mtimeMs: 42 },
    });
    expect(await fs.exists("a", context)).toEqual({ ok: true, value: true });
    expect(await fs.exists("missing", context)).toEqual({ ok: true, value: false });
    expect(await fs.absolutePath("../x", context)).toEqual({ ok: true, value: "/x" });
    expect(await fs.joinPath(["a", "b"], context)).toEqual({ ok: true, value: "a/b" });
  });

  test("memoryFs reports errors as values", async () => {
    const fs = memoryFs({ files: { "/d/f.txt": "x" } });
    const missing = await fs.readTextFile("/nope", context);
    expect(!missing.ok && missing.error.code).toBe("not_found");
    const dir = await fs.readTextFile("/d", context);
    expect(!dir.ok && dir.error.code).toBe("is_directory");
    const notDir = await fs.listDir("/d/f.txt", context);
    expect(!notDir.ok && notDir.error.code).toBe("not_directory");
    const underFile = await fs.writeFile("/d/f.txt/child", "x", context);
    expect(!underFile.ok && underFile.error.code).toBe("not_directory");
    const watch = await fs.watch([{ path: "/d" }], () => {}, context);
    expect(!watch.ok && watch.error.code).toBe("not_supported");
    const controller = new AbortController();
    controller.abort();
    const aborted = await fs.readTextFile("/d/f.txt", { abortSignal: controller.signal });
    expect(!aborted.ok && aborted.error.code).toBe("aborted");
  });

  test("memoryFs lists, renames and removes", async () => {
    const fs = memoryFs({ files: { "/p/a.txt": "a", "/p/sub/b.txt": "b" } });
    const listed = await fs.listDir("/p", context);
    expect(listed.ok && listed.value.map((entry) => entry.name).toSorted()).toEqual([
      "a.txt",
      "sub",
    ]);
    expect((await fs.renameFile("/p/sub", "/p/moved", context)).ok).toBe(true);
    expect(await fs.readTextFile("/p/moved/b.txt", context)).toEqual({ ok: true, value: "b" });
    const dirRemove = await fs.remove("/p/moved", undefined, context);
    expect(!dirRemove.ok && dirRemove.error.code).toBe("is_directory");
    expect((await fs.remove("/p/moved", { recursive: true }, context)).ok).toBe(true);
    expect(await fs.exists("/p/moved/b.txt", context)).toEqual({ ok: true, value: false });
    expect((await fs.remove("/p/none", { force: true }, context)).ok).toBe(true);
    const missing = await fs.remove("/p/none", undefined, context);
    expect(!missing.ok && missing.error.code).toBe("not_found");
  });

  test("memoryFs readers page directories and scan lines", async () => {
    const fs = memoryFs({
      files: { "/r/1": "x", "/r/2": "x", "/r/3": "x", "/r/lines.txt": "a\nbb\nccc" },
    });
    const reader = await fs.openDirReader("/r", context);
    if (!reader.ok) throw new Error("open failed");
    const first = await reader.value.next(3, context);
    const second = await reader.value.next(3, context);
    expect(first.ok && first.value.entries).toHaveLength(3);
    expect(first.ok && first.value.done).toBe(false);
    expect(second.ok && second.value).toMatchObject({ done: true });
    await reader.value.close(context);

    const binary = await fs.openBinaryReader("/r/lines.txt", undefined, context);
    if (!binary.ok) throw new Error("open failed");
    expect(await binary.value.read(2, 2, context)).toEqual({
      ok: true,
      value: new Uint8Array([98, 98]),
    });
    const scan = await binary.value.scanLines({ startLine: 1, endLine: 2 }, context);
    expect(scan.ok && scan.value).toMatchObject({
      newlines: 2,
      start: 2,
      end: 4,
      selectedBytes: 2,
    });
    await binary.value.close(context);
    const afterClose = await binary.value.read(0, 1, context);
    expect(!afterClose.ok && afterClose.error.code).toBe("invalid");

    const lines = await fs.openTextLineReader("/r/lines.txt", context);
    if (!lines.ok) throw new Error("open failed");
    expect(await lines.value.readLine(context)).toEqual({
      ok: true,
      value: { text: "a", terminated: true },
    });
    expect(await lines.value.readLine(context)).toEqual({
      ok: true,
      value: { text: "bb", terminated: true },
    });
    expect(await lines.value.readLine(context)).toEqual({
      ok: true,
      value: { text: "ccc", terminated: false },
    });
    expect(await lines.value.readLine(context)).toEqual({ ok: true, value: undefined });
  });

  test("memoryFs truncates and creates temp entries", async () => {
    const fs = memoryFs({ files: { "/t.bin": "abcdef" } });
    expect((await fs.truncateFile("/t.bin", 2, context)).ok).toBe(true);
    expect(await fs.readTextFile("/t.bin", context)).toEqual({ ok: true, value: "ab" });
    expect((await fs.truncateFile("/t.bin", 4, context)).ok).toBe(true);
    const grown = await fs.readBinaryFile("/t.bin", context);
    expect(grown.ok && [...grown.value]).toEqual([97, 98, 0, 0]);
    const invalid = await fs.truncateFile("/t.bin", -1, context);
    expect(!invalid.ok && invalid.error.code).toBe("invalid");
    const dir = await fs.createTempDir("job-", context);
    const file = await fs.createTempFile({ prefix: "p-", suffix: ".log" }, context);
    expect(dir.ok && dir.value).toBe("/tmp/job-1");
    expect(file.ok && file.value).toMatch(/^\/tmp\/tmp-2\/p-3\.log$/);
    expect(await fs.createDir("/x/y", undefined, context)).toEqual({ ok: true, value: undefined });
    const flat = await fs.createDir("/nope/child", { recursive: false }, context);
    expect(!flat.ok && flat.error.code).toBe("not_found");
    await fs.cleanup(context);
  });
});
