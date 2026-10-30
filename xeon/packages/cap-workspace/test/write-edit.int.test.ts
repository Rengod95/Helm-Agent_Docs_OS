import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createFilesApi } from "../src/service.ts";
import { rejection } from "./support/assertions.ts";
import { override, realDeps, realEnv } from "./support/real-env.ts";

// L2.workspace.spec §4.3(쓰기 root 검사), §4.4(원자적 쓰기, 동시 변경 감지). 실제 파일 시스템과 실제 프로세스 종료로 확인한다.

const dirs: string[] = [];

function tempRoot(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "xeon-ws-int-")));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function filesAt(root: string) {
  return createFilesApi(realDeps(realEnv(root)));
}

describe("write and edit on a real file system", () => {
  test("write creates parents, replaces atomically and leaves no temp file", async () => {
    const root = tempRoot();
    const files = filesAt(root);
    const created = await files.write({ path: "deep/er/a.txt", content: "one\n" });
    expect(readFileSync(join(root, "deep/er/a.txt"), "utf8")).toBe("one\n");
    expect(created.bytes).toBe(4);
    expect(created.change.existed).toBe(false);
    expect(created.change.path).toBe(join(root, "deep/er/a.txt"));
    const replaced = await files.write({ path: "deep/er/a.txt", content: "two\n" });
    expect(replaced.change.existed).toBe(true);
    expect(replaced.change.diff).toBe(
      "--- a/deep/er/a.txt\n+++ b/deep/er/a.txt\n@@ -1 +1 @@\n-one\n+two\n",
    );
    expect(readdirSync(join(root, "deep/er"))).toEqual(["a.txt"]);
  });

  test("edit applies and reports the change", async () => {
    const root = tempRoot();
    writeFileSync(join(root, "f.txt"), "a\nb\nc\n");
    const out = await filesAt(root).edit({
      path: "f.txt",
      edits: [{ oldText: "b", newText: "B" }],
    });
    expect(readFileSync(join(root, "f.txt"), "utf8")).toBe("a\nB\nc\n");
    expect(out.applied).toBe(1);
    expect(out.matchMode).toBe("exact");
    expect(out.change.added).toBe(1);
    expect(out.change.removed).toBe(1);
    expect(out.change.firstChangedLine).toBe(2);
  });

  test("two edits of one file in one round run in order", async () => {
    const root = tempRoot();
    writeFileSync(join(root, "f.txt"), "x\n");
    const files = filesAt(root);
    const first = files.edit({ path: "f.txt", edits: [{ oldText: "x", newText: "y" }] });
    const second = files.edit({ path: "f.txt", edits: [{ oldText: "y", newText: "z" }] });
    await Promise.all([first, second]);
    expect(readFileSync(join(root, "f.txt"), "utf8")).toBe("z\n");
  });

  test("edits of one file run in call order even when the first path resolves later", async () => {
    const root = tempRoot();
    writeFileSync(join(root, "f.txt"), "x\n");
    const base = realEnv(root);
    let resolutions = 0;
    const env = override(base, {
      // 첫 호출의 경로 해석만 늦춰, 두 번째 호출이 먼저 해석을 마치는 상황을 만든다
      canonicalPath: async (path, context) => {
        resolutions += 1;
        if (resolutions === 1) await new Promise((resolve) => setTimeout(resolve, 40));
        return base.canonicalPath(path, context);
      },
    });
    const files = createFilesApi(realDeps(env));
    const first = files.edit({ path: "f.txt", edits: [{ oldText: "x", newText: "y" }] });
    const second = files.edit({ path: "f.txt", edits: [{ oldText: "y", newText: "z" }] });
    await Promise.all([first, second]);
    expect(readFileSync(join(root, "f.txt"), "utf8")).toBe("z\n");
  });

  test("edit is refused when the file changed after it was read", async () => {
    const root = tempRoot();
    const target = join(root, "f.txt");
    writeFileSync(target, "alpha\nbeta\n");
    let reads = 0;
    const base = realEnv(root);
    const env = override(base, {
      // 두 번째 읽기(이름 바꾸기 직전 확인) 직전에 다른 프로세스가 파일을 바꾼 상황을 만든다
      readTextFile: async (path, context) => {
        reads += 1;
        if (reads === 2) writeFileSync(target, "alpha\nother writer\n");
        return base.readTextFile(path, context);
      },
    });
    const refused = await rejection(
      createFilesApi(realDeps(env)).edit({
        path: "f.txt",
        edits: [{ oldText: "beta", newText: "BETA" }],
      }),
    );
    expect(refused.data.code).toBe("edit_conflict");
    expect(refused.data.retryable).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("alpha\nother writer\n");
    expect(readdirSync(root)).toEqual(["f.txt"]);
  });

  test("edit is refused when the file was removed after it was read", async () => {
    const root = tempRoot();
    const target = join(root, "f.txt");
    writeFileSync(target, "alpha\n");
    let reads = 0;
    const base = realEnv(root);
    const env = override(base, {
      readTextFile: async (path, context) => {
        reads += 1;
        if (reads === 2) rmSync(target);
        return base.readTextFile(path, context);
      },
    });
    const refused = await rejection(
      createFilesApi(realDeps(env)).edit({
        path: "f.txt",
        edits: [{ oldText: "alpha", newText: "beta" }],
      }),
    );
    expect(refused.data.code).toBe("edit_conflict");
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });
});

describe("atomic write under SIGKILL", () => {
  test("killing the writer before the rename keeps the original file", async () => {
    const root = tempRoot();
    const target = join(root, "keep.txt");
    writeFileSync(target, "original\n");
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        join(import.meta.dir, "support/atomic-victim.ts"),
        root,
        "keep.txt",
        "replacement\n",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = child.stdout.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("ready\n");
    // 이 시점에 새 내용은 임시 파일에만 있다
    const tempNames = readdirSync(root).filter((name) => name !== "keep.txt");
    expect(tempNames.length).toBe(1);
    expect(readFileSync(join(root, tempNames[0] ?? ""), "utf8")).toBe("replacement\n");
    child.kill("SIGKILL");
    await child.exited;
    expect(readFileSync(target, "utf8")).toBe("original\n");
    // 죽은 쓰기가 남긴 임시 파일이 다음 쓰기를 막지 않는다
    await filesAt(root).write({ path: "keep.txt", content: "next\n" });
    expect(readFileSync(target, "utf8")).toBe("next\n");
  }, 20_000);
});

describe("writes outside the sandbox root are refused", () => {
  test("write and edit refuse paths outside the working directory", async () => {
    const root = tempRoot();
    const outside = tempRoot();
    writeFileSync(join(outside, "victim.txt"), "safe\n");
    mkdirSync(join(root, "inside"));
    symlinkSync(outside, join(root, "link"));
    symlinkSync(join(outside, "victim.txt"), join(root, "victim-link.txt"));
    const files = filesAt(root);
    const attempts: readonly (() => Promise<unknown>)[] = [
      () => files.write({ path: join(outside, "new.txt"), content: "x" }),
      () => files.write({ path: "../escape.txt", content: "x" }),
      () => files.write({ path: "link/new.txt", content: "x" }),
      () => files.write({ path: "victim-link.txt", content: "x" }),
      () => files.write({ path: "inside/missing/../../../escape.txt", content: "x" }),
      () => files.edit({ path: "victim-link.txt", edits: [{ oldText: "safe", newText: "owned" }] }),
    ];
    const refusals = await Promise.all(attempts.map((attempt) => rejection(attempt())));
    const codes = refusals.map((refused) => refused.data.code);
    expect(codes).toEqual(["denied", "denied", "denied", "denied", "denied", "denied"]);
    expect(readFileSync(join(outside, "victim.txt"), "utf8")).toBe("safe\n");
    expect(readdirSync(outside)).toEqual(["victim.txt"]);
    expect(existsSync(join(root, "escape.txt"))).toBe(false);
  });
});
