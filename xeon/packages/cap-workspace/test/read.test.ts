import { describe, expect, test } from "bun:test";
import { createFilesApi } from "../src/service.ts";
import { DEFAULT_WORKSPACE_SETTINGS, type WorkspaceSettings } from "../src/settings.ts";
import { rejection, numbered } from "./support/assertions.ts";
import { depsFor } from "./support/fakes.ts";
import { memoryEnv } from "./support/memory-env.ts";

function limits(maxLines: number, maxBytes: number): () => WorkspaceSettings {
  return () => ({ ...DEFAULT_WORKSPACE_SETTINGS, read: { maxLines, maxBytes } });
}

function setup(settings?: () => WorkspaceSettings) {
  const env = memoryEnv({ cwd: "/work" });
  env.mkdir("/work");
  const files = createFilesApi(depsFor(env, settings === undefined ? {} : { settings }));
  return { env, files };
}

function asText(output: Awaited<ReturnType<ReturnType<typeof setup>["files"]["read"]>>) {
  if (output.kind !== "text") throw new Error("expected a text result");
  return output;
}

describe("read", () => {
  test("read returns whole small file", async () => {
    const { env, files } = setup();
    env.put("/work/a.txt", "alpha\nbeta\ngamma\n");
    const out = asText(await files.read({ path: "a.txt" }));
    expect(out.text).toBe("alpha\nbeta\ngamma\n");
    expect(out.path).toBe("/work/a.txt");
    expect(out.startLine).toBe(1);
    expect(out.endLine).toBe(3);
    expect(out.totalLines).toBe(3);
    expect(out.truncated).toBeUndefined();
  });

  test("read counts an unterminated last line and an empty file", async () => {
    const { env, files } = setup();
    env.put("/work/tail.txt", "a\nb");
    env.put("/work/empty.txt", "");
    const tail = asText(await files.read({ path: "tail.txt" }));
    expect([tail.endLine, tail.totalLines]).toEqual([2, 2]);
    const empty = asText(await files.read({ path: "empty.txt" }));
    expect([empty.text, empty.startLine, empty.endLine, empty.totalLines]).toEqual(["", 1, 0, 0]);
    expect(empty.truncated).toBeUndefined();
  });

  test("read truncates at line limit", async () => {
    const { env, files } = setup(limits(3, 10_000));
    env.put("/work/big.txt", numbered(10));
    const out = asText(await files.read({ path: "big.txt" }));
    expect(out.text).toBe("line 1\nline 2\nline 3");
    expect(out.endLine).toBe(3);
    expect(out.totalLines).toBe(10);
    expect(out.truncated).toEqual({ by: "lines", shown: 3, total: 10, nextOffset: 4 });
  });

  test("read truncates at byte limit", async () => {
    const { env, files } = setup(limits(1000, 20));
    env.put("/work/big.txt", numbered(10));
    const out = asText(await files.read({ path: "big.txt" }));
    // "line 1\nline 2\nline 3" is 20 bytes; a fourth line would pass the limit
    expect(out.text).toBe("line 1\nline 2\nline 3");
    expect(out.truncated?.by).toBe("bytes");
    expect(out.truncated?.nextOffset).toBe(out.endLine + 1);
  });

  test("read stops at an explicit limit and reports where to continue", async () => {
    const { env, files } = setup();
    env.put("/work/a.txt", numbered(5));
    const out = asText(await files.read({ path: "a.txt", limit: 2 }));
    expect(out.text).toBe("line 1\nline 2");
    expect(out.truncated).toEqual({ by: "lines", shown: 2, total: 5, nextOffset: 3 });
  });

  test("read continues from offset", async () => {
    const { env, files } = setup(limits(4, 10_000));
    const original = `${numbered(10)}\n`;
    env.put("/work/big.txt", original);
    const pieces: string[] = [];
    let offset: number | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const request = { path: "big.txt", ...(offset === undefined ? {} : { offset }) };
      // oxlint-disable-next-line no-await-in-loop -- 이어 읽기는 앞 결과의 nextOffset에 의존한다 (eng.typescript.guide TY-22)
      const out = asText(await files.read(request));
      pieces.push(out.text);
      if (out.truncated?.nextOffset === undefined) break;
      expect(out.truncated.nextOffset).toBe(out.endLine + 1);
      offset = out.truncated.nextOffset;
    }
    expect(pieces).toHaveLength(3);
    // 조각 사이의 줄바꿈은 잘린 자리에 있다
    expect(pieces.join("\n")).toBe(original);
  });

  test("read rejects offset beyond end", async () => {
    const { env, files } = setup();
    env.put("/work/a.txt", "one\ntwo\n");
    const error = await rejection(files.read({ path: "a.txt", offset: 3 }));
    expect(error.data.code).toBe("offset_beyond_end");
    expect(error.data.detail).toEqual({ totalLines: 2 });
    // 마지막 줄은 읽을 수 있다
    expect(asText(await files.read({ path: "a.txt", offset: 2 })).text).toBe("two\n");
  });

  test("read rejects binary file", async () => {
    const { env, files } = setup();
    env.put("/work/blob.bin", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    const error = await rejection(files.read({ path: "blob.bin" }));
    expect(error.data.code).toBe("read_binary");
  });

  test("read cuts a first line that alone exceeds the byte limit", async () => {
    const { env, files } = setup(limits(1000, 8));
    env.put("/work/long.txt", `${"x".repeat(30)}\nsecond\n`);
    const out = asText(await files.read({ path: "long.txt" }));
    expect(out.text).toBe("x".repeat(8));
    expect(out.truncated).toEqual({ by: "bytes", shown: 1, total: 2, nextOffset: 2 });
  });

  test("read rejects a directory and a missing file", async () => {
    const { env, files } = setup();
    env.mkdir("/work/dir");
    const directory = await rejection(files.read({ path: "dir" }));
    expect(directory.data.code).toBe("invalid_input");
    expect(directory.data.detail).toEqual({ reason: "is_directory" });
    expect((await rejection(files.read({ path: "nope.txt" }))).data.code).toBe("not_found");
  });

  test("read refuses paths outside the root, through links, and protected ones", async () => {
    const { env, files } = setup();
    env.put("/outside.txt", "secret\n");
    env.put("/etc/passwd", "root\n");
    env.symlink("/work/link", "/etc");
    const dotdot = await rejection(files.read({ path: "../outside.txt" }));
    expect(dotdot.data.code).toBe("denied");
    expect(dotdot.data.detail).toMatchObject({ reason: "outside_root" });
    const linked = await rejection(files.read({ path: "link/passwd" }));
    expect(linked.data.code).toBe("denied");
    expect((await rejection(files.read({ path: "/etc/passwd" }))).data.code).toBe("denied");
  });

  test("read strips a leading @ and folds special spaces", async () => {
    const { env, files } = setup();
    env.put("/work/a b.txt", "ok\n");
    expect(asText(await files.read({ path: "@a b.txt" })).text).toBe("ok\n");
  });

  test("read resolves screenshot name variants", async () => {
    const { env, files } = setup();
    env.put("/work/shot 9.41 AM.txt".replace(" AM.", " AM."), "narrow\n");
    env.put("/work/café.txt", "nfd\n");
    expect(asText(await files.read({ path: "shot 9.41 AM.txt" })).text).toBe("narrow\n");
    expect(asText(await files.read({ path: "café.txt" })).text).toBe("nfd\n");
  });
});
