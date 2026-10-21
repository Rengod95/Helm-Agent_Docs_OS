import { describe, expect, test } from "bun:test";
import { WorkspaceFiles } from "@xeon/contracts/capabilities";
import { createFilesApi } from "../src/service.ts";
import { DEFAULT_WORKSPACE_SETTINGS } from "../src/settings.ts";
import { rejection } from "./support/assertions.ts";
import { depsFor } from "./support/fakes.ts";
import { memoryEnv } from "./support/memory-env.ts";

function setup(maxEntries = DEFAULT_WORKSPACE_SETTINGS.list.maxEntries) {
  const env = memoryEnv({ cwd: "/work" });
  env.mkdir("/work");
  const files = createFilesApi(
    depsFor(env, {
      settings: () => ({ ...DEFAULT_WORKSPACE_SETTINGS, list: { maxEntries } }),
    }),
  );
  return { env, files };
}

describe("ls", () => {
  test("ls sorts by bytes and marks dirs", async () => {
    const { env, files } = setup();
    env.put("/work/b.txt", "");
    env.put("/work/B.txt", "");
    env.put("/work/.hidden", "");
    env.put("/work/é.txt", "");
    env.mkdir("/work/src");
    env.symlink("/work/link", "/work/src");
    // UTF-16 순서와 UTF-8 바이트 순서가 갈리는 이름: U+FF5E(EF BD 9E)와 U+1F600(F0 9F 98 80)
    env.put("/work/～", "");
    env.put("/work/\u{1F600}", "");
    const out = await files.list({});
    expect(out.path).toBe("/work");
    expect(out.entries.map((entry) => entry.name)).toEqual([
      ".hidden",
      "B.txt",
      "b.txt",
      "link",
      "src",
      "é.txt",
      "～",
      "\u{1F600}",
    ]);
    expect(out.entries.find((entry) => entry.name === "src")?.kind).toBe("directory");
    expect(out.entries.find((entry) => entry.name === "link")?.kind).toBe("symlink");
    expect(out.truncated).toBeUndefined();
    // 도구 쪽 렌더링은 디렉터리에 `/`를 붙이고 점 파일을 포함한다
    const tool = WorkspaceFiles.tools[3];
    expect(tool.name).toBe("ls");
    const text = tool.toContent?.(out).content[0];
    expect(text?.type === "text" ? text.text.split("\n").slice(0, 5) : []).toEqual([
      ".hidden",
      "B.txt",
      "b.txt",
      "link",
      "src/",
    ]);
  });

  test("ls truncates at entry limit", async () => {
    const { env, files } = setup(3);
    for (const name of ["a", "b", "c", "d", "e"]) env.put(`/work/${name}`, "");
    const out = await files.list({});
    expect(out.entries.map((entry) => entry.name)).toEqual(["a", "b", "c"]);
    expect(out.truncated).toEqual({ by: "entries", shown: 3, total: 5 });
  });

  test("ls takes an explicit limit over the setting default", async () => {
    const { env, files } = setup(2);
    for (const name of ["a", "b", "c", "d"]) env.put(`/work/${name}`, "");
    const out = await files.list({ limit: 4 });
    expect(out.entries).toHaveLength(4);
    expect(out.truncated).toBeUndefined();
  });

  test("ls truncates at the byte limit", async () => {
    const { env, files } = setup(10_000);
    for (let index = 0; index < 100; index++) {
      env.put(`/work/${String(index).padStart(3, "0")}${"n".repeat(1000)}`, "");
    }
    const out = await files.list({});
    expect(out.truncated?.by).toBe("bytes");
    expect(out.truncated?.total).toBe(100);
    expect(out.entries.length).toBeLessThan(100);
    expect(out.truncated?.shown).toBe(out.entries.length);
  });

  test("ls lists an empty directory, a subdirectory, and rejects bad targets", async () => {
    const { env, files } = setup();
    env.mkdir("/work/empty");
    env.put("/work/sub/x.txt", "");
    env.put("/work/file.txt", "");
    expect((await files.list({ path: "empty" })).entries).toEqual([]);
    expect((await files.list({ path: "sub" })).entries).toEqual([{ name: "x.txt", kind: "file" }]);
    expect((await rejection(files.list({ path: "file.txt" }))).data.code).toBe("invalid_input");
    expect((await rejection(files.list({ path: "nope" }))).data.code).toBe("not_found");
    expect((await rejection(files.list({ path: ".." }))).data.code).toBe("denied");
  });
});
