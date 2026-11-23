import { describe, expect, test } from "bun:test";
import {
  ARTIFACT_FILES_KEY,
  WorkspaceShell,
  type CallOptions,
} from "@fresnel/contracts/capabilities";
import type { ProtectedPathEntry } from "@fresnel/contracts/services";
import {
  artifactChanges,
  snapshotArtifacts,
  type ArtifactSnapshot,
  type ArtifactStamp,
} from "../src/shell/artifact-scan.ts";
import { createShellApi } from "../src/shell/run.ts";
import { callTool } from "./support/adapter.ts";
import { depsFor } from "./support/fakes.ts";
import { memoryEnv, type MemoryEnv } from "./support/memory-env.ts";

// 셸 산출물 훑기(S-08). bash 앞뒤로 작업 폴더를 견줘 새로 생기거나 바뀐 그려 볼 수 있는 파일을 `details`에 싣는다.
// 결과 글은 바뀌지 않고, 상한과 시간을 넘으면 아무것도 싣지 않는다.

const NO_SIGNAL = { abortSignal: undefined };

function setup(options: Parameters<typeof depsFor>[1] = {}) {
  const env = memoryEnv({ cwd: "/work" });
  env.mkdir("/work");
  const shell = createShellApi(depsFor(env, options));
  return { env, shell };
}

/** 파일의 현재 크기와 수정 시각(시험이 값을 견주는 기준) */
async function stampOf(env: MemoryEnv, path: string): Promise<{ size: number; mtimeMs: number }> {
  const info = await env.fileInfo(path, NO_SIGNAL);
  if (!info.ok) throw info.error;
  return { size: info.value.size, mtimeMs: info.value.mtimeMs };
}

function snapshotOf(
  entries: readonly [string, { size: number; mtimeMs: number }][],
): ArtifactSnapshot {
  return new Map(entries);
}

describe("bash artifact details", () => {
  test("a script that writes an svg puts it in details and leaves the result text alone", async () => {
    const { env, shell } = setup();
    env.reply({
      chunks: [{ text: "chart written\n" }],
      exitCode: 0,
      writes: [{ path: "/work/out/chart.svg", content: "<svg/>" }],
    });
    const result = await callTool(WorkspaceShell, shell, "bash", { command: "python3 make.py" });
    const stamp = await stampOf(env, "/work/out/chart.svg");
    expect(result.isError).toBe(false);
    expect(result.text).toBe("chart written\n");
    expect(result.details).toEqual({
      [ARTIFACT_FILES_KEY]: [{ path: "/work/out/chart.svg", op: "create", ...stamp }],
    });
  });

  test("a changed file is modify; an unchanged viewable file and a non-viewable file are not listed", async () => {
    const { env, shell } = setup();
    env.put("/work/old.svg", "<svg/>");
    env.put("/work/same.png", "png");
    env.reply({
      chunks: [{ text: "" }],
      exitCode: 0,
      writes: [
        { path: "/work/old.svg", content: "<svg>changed</svg>" },
        { path: "/work/data.json", content: "{}" },
      ],
    });
    const result = await callTool(WorkspaceShell, shell, "bash", { command: "regen" });
    const stamp = await stampOf(env, "/work/old.svg");
    expect(result.details).toEqual({
      [ARTIFACT_FILES_KEY]: [{ path: "/work/old.svg", op: "modify", ...stamp }],
    });
  });

  test("the scan skips node_modules and dot folders and stops at depth 3", async () => {
    const { env, shell } = setup();
    env.reply({
      chunks: [{ text: "" }],
      exitCode: 0,
      writes: [
        { path: "/work/a/b/deep.svg", content: "<svg/>" },
        { path: "/work/a/b/c/too-deep.svg", content: "<svg/>" },
        { path: "/work/node_modules/lib/x.svg", content: "<svg/>" },
        { path: "/work/.hidden/y.svg", content: "<svg/>" },
        { path: "/work/.git/z.html", content: "<html/>" },
      ],
    });
    const result = await callTool(WorkspaceShell, shell, "bash", { command: "gen" });
    const stamp = await stampOf(env, "/work/a/b/deep.svg");
    expect(result.details).toEqual({
      [ARTIFACT_FILES_KEY]: [{ path: "/work/a/b/deep.svg", op: "create", ...stamp }],
    });
  });

  test("a protected path is not listed", async () => {
    const protectedPaths: readonly ProtectedPathEntry[] = [
      { path: "/work/private", match: "prefix", access: "read_write", reason: "secret_key" },
    ];
    const { env, shell } = setup({ protectedPaths });
    env.reply({
      chunks: [{ text: "" }],
      exitCode: 0,
      writes: [{ path: "/work/private/key.svg", content: "<svg/>" }],
    });
    const result = await callTool(WorkspaceShell, shell, "bash", { command: "gen" });
    expect(result.details).toBeUndefined();
  });

  test("a read-only call does not scan, so it carries no list", async () => {
    const { env, shell } = setup();
    env.reply({
      chunks: [{ text: "" }],
      exitCode: 0,
      writes: [{ path: "/work/ro.svg", content: "<svg/>" }],
    });
    const options: CallOptions = {
      context: {
        caller: { kind: "model", agent: "main" },
        interactive: true,
        sandbox: "read-only",
      },
    };
    const result = await callTool(WorkspaceShell, shell, "bash", { command: "ls" }, options);
    expect(result.details).toBeUndefined();
  });
});

describe("snapshot limits", () => {
  test("the scan gives up when the file count passes the cap", async () => {
    const env = memoryEnv({ cwd: "/work" });
    env.put("/work/a.svg", "1");
    env.put("/work/b.txt", "2");
    env.put("/work/c.html", "3");
    const limits = { maxDepth: 3, maxFiles: 2, timeoutMs: 1000 };
    expect(await snapshotArtifacts(env, "/work", () => false, limits)).toBeNull();
    const fits = await snapshotArtifacts(env, "/work", () => false, { ...limits, maxFiles: 3 });
    expect([...(fits?.keys() ?? [])].toSorted()).toEqual(["/work/a.svg", "/work/c.html"]);
  });

  test("files below the depth limit are not seen", async () => {
    const env = memoryEnv({ cwd: "/work" });
    env.put("/work/top.svg", "1");
    env.put("/work/x/y.svg", "2");
    const shallow = await snapshotArtifacts(env, "/work", () => false, {
      maxDepth: 1,
      maxFiles: 10,
      timeoutMs: 1000,
    });
    expect([...(shallow?.keys() ?? [])]).toEqual(["/work/top.svg"]);
  });

  test("a listing that never returns gives up at the time limit", async () => {
    const hanging = { listDir: () => new Promise<never>(() => {}) };
    const snapshot = await snapshotArtifacts(hanging, "/work", () => false, {
      maxDepth: 3,
      maxFiles: 10,
      timeoutMs: 20,
    });
    expect(snapshot).toBeNull();
  });
});

describe("artifact changes", () => {
  test("create, modify by size, modify by time, and unchanged files", () => {
    const before = snapshotOf([
      ["/w/same.svg", { size: 1, mtimeMs: 10 }],
      ["/w/size.svg", { size: 1, mtimeMs: 10 }],
      ["/w/time.html", { size: 1, mtimeMs: 10 }],
    ]);
    const after = snapshotOf([
      ["/w/same.svg", { size: 1, mtimeMs: 10 }],
      ["/w/size.svg", { size: 2, mtimeMs: 10 }],
      ["/w/time.html", { size: 1, mtimeMs: 11 }],
      ["/w/new.md", { size: 3, mtimeMs: 12 }],
    ]);
    expect(artifactChanges(before, after)).toEqual([
      { path: "/w/new.md", op: "create", size: 3, mtimeMs: 12 },
      { path: "/w/size.svg", op: "modify", size: 2, mtimeMs: 10 },
      { path: "/w/time.html", op: "modify", size: 1, mtimeMs: 11 },
    ]);
  });

  test("the list keeps the first 32 in path order", () => {
    const after = snapshotOf(
      Array.from({ length: 40 }, (_, index): [string, ArtifactStamp] => [
        `/w/f${String(index).padStart(2, "0")}.svg`,
        { size: 1, mtimeMs: 1 },
      ]),
    );
    const changed = artifactChanges(new Map<string, ArtifactStamp>(), after);
    expect(changed.length).toBe(32);
    expect(changed[0]?.path).toBe("/w/f00.svg");
    expect(changed[31]?.path).toBe("/w/f31.svg");
  });
});
