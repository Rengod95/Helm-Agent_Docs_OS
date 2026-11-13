import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { createToolOutputFiles } from "../src/tool-output-files.ts";

// L0.exec.spec §3.8.3: 잘린 출력의 파일 사본은 blob에서 언제든 다시 만들 수 있다.

const THREAD = "thr_000000000000000000000000A1";
const OTHER = "thr_000000000000000000000000B2";
const SHA = "a".repeat(64);
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(blobs: Record<string, string> = {}) {
  const base = mkdtempSync(join(tmpdir(), "fresnel-tool-output-"));
  dirs.push(base);
  const dir = join(base, "tool-output");
  const files = createToolOutputFiles({
    dir,
    readBlobByHash: (sha256) => {
      const text = blobs[sha256];
      return text === undefined
        ? err({ kind: "blob_missing", sha256 })
        : ok(new TextEncoder().encode(text));
    },
  });
  return { dir, files };
}

describe("tool output files", () => {
  test("writes <dir>/<thread>/<sha>.txt with the original bytes", async () => {
    const { dir, files } = setup();
    const written = await files.write(THREAD, SHA, new TextEncoder().encode("line 1\nline 2\n"));
    expect(written).toEqual({ ok: true, value: join(dir, THREAD, `${SHA}.txt`) });
    expect(readFileSync(files.pathFor(THREAD, SHA), "utf8")).toBe("line 1\nline 2\n");
  });

  test("rejects keys that could leave the folder", async () => {
    const { files } = setup();
    expect((await files.write("../evil", SHA, new Uint8Array())).ok).toBe(false);
    expect((await files.write(THREAD, "../x", new Uint8Array())).ok).toBe(false);
  });

  test("restore rebuilds a missing copy from the blob, also after the folder was removed", async () => {
    const { files } = setup({ [SHA]: "original text" });
    const path = files.pathFor(THREAD, SHA);
    expect(await files.restore(path)).toEqual({ ok: true, value: true });
    expect(readFileSync(path, "utf8")).toBe("original text");
    await files.removeThread(THREAD);
    expect(existsSync(path)).toBe(false);
    expect(await files.restore(path)).toEqual({ ok: true, value: true });
    expect(readFileSync(path, "utf8")).toBe("original text");
  });

  test("restore reports a missing blob and ignores paths that are not copies", async () => {
    const { dir, files } = setup();
    expect(await files.restore(files.pathFor(THREAD, SHA))).toEqual({
      ok: false,
      error: { kind: "blob_missing", sha256: SHA },
    });
    expect(await files.restore("/etc/passwd")).toEqual({ ok: true, value: false });
    expect(await files.restore(join(dir, THREAD, "sub", `${SHA}.txt`))).toEqual({
      ok: true,
      value: false,
    });
    expect(await files.restore(join(dir, THREAD, "notes.txt"))).toEqual({ ok: true, value: false });
  });

  test("removeThread drops one thread and sweep drops threads that are not live", async () => {
    const { dir, files } = setup();
    for (const thread of [THREAD, OTHER]) {
      mkdirSync(join(dir, thread), { recursive: true });
      writeFileSync(join(dir, thread, `${SHA}.txt`), "x");
    }
    await files.removeThread(OTHER);
    expect(existsSync(join(dir, OTHER))).toBe(false);
    expect(existsSync(join(dir, THREAD))).toBe(true);
    expect(await files.sweep(() => false)).toBe(1);
    expect(existsSync(join(dir, THREAD))).toBe(false);
  });
});
