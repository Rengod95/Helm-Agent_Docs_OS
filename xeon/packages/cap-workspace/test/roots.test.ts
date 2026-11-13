import { describe, expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { CancelScope, ProtectedPathEntry, ToolOutputFiles } from "@fresnel/contracts/services";
import { WorkspaceFailure } from "../src/errors.ts";
import { defaultRoots, isWithin, resolveWorkspacePath, type PathAccess } from "../src/roots.ts";
import { memoryEnv } from "./support/memory-env.ts";

const CONTEXT: CancelScope = { abortSignal: undefined };

function resolver(cwd: string, protectedPaths: readonly ProtectedPathEntry[] = []) {
  const env = memoryEnv({ cwd });
  env.mkdir(cwd);
  const deps = {
    env,
    roots: (context: CancelScope) => defaultRoots(env, context),
    protectedPaths: () => protectedPaths,
  };
  const resolve = (path: string, access: PathAccess = "read") =>
    resolveWorkspacePath(deps, path, access, CONTEXT, { variants: access === "read" });
  return { env, resolve };
}

async function failure(promise: Promise<unknown>): Promise<WorkspaceFailure> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof WorkspaceFailure) return caught;
    throw caught;
  }
  throw new Error("expected a WorkspaceFailure");
}

describe("path resolution", () => {
  test("resolves inside the root, including a not yet existing file", async () => {
    const { env, resolve } = resolver("/work");
    env.put("/work/src/a.ts", "x");
    expect(await resolve("src/a.ts")).toEqual({
      requested: "src/a.ts",
      canonical: "/work/src/a.ts",
      exists: true,
    });
    expect(await resolve("src/new/dir/b.ts", "write")).toEqual({
      requested: "src/new/dir/b.ts",
      canonical: "/work/src/new/dir/b.ts",
      exists: false,
    });
  });

  test("rejects dot-dot escape", async () => {
    const { env, resolve } = resolver("/work");
    env.put("/outside.txt", "secret");
    const denied = await failure(resolve("../outside.txt"));
    expect(denied.code).toBe("denied");
    expect(denied.detail).toEqual({
      reason: "outside_root",
      requested: "../outside.txt",
      resolved: "/outside.txt",
    });
  });

  test("rejects symlink escape", async () => {
    const { env, resolve } = resolver("/work");
    env.put("/etc/passwd", "root");
    env.symlink("/work/link", "/etc");
    const denied = await failure(resolve("link/passwd"));
    expect(denied.code).toBe("denied");
    expect(denied.detail).toMatchObject({ reason: "outside_root", resolved: "/etc/passwd" });
    // 아직 없는 새 파일도 상위 링크가 root 밖이면 거부한다
    const created = await failure(resolve("link/new.txt", "write"));
    expect(created.detail).toMatchObject({ reason: "outside_root", resolved: "/etc/new.txt" });
  });

  test("rejects traversal in missing segments", async () => {
    const { resolve } = resolver("/work");
    const denied = await failure(resolve("a/../../x", "write"));
    expect(denied.code).toBe("denied");
    expect(denied.detail).toMatchObject({ reason: "parent_traversal", requested: "a/../../x" });
  });

  test("segment-wise containment", async () => {
    expect(isWithin("/w/a", "/w/a")).toBe(true);
    expect(isWithin("/w/a", "/w/a/x")).toBe(true);
    expect(isWithin("/w/a", "/w/ab/x")).toBe(false);
    expect(isWithin("/", "/anything")).toBe(true);
    const { env, resolve } = resolver("/w/a");
    env.put("/w/ab/x", "no");
    const denied = await failure(resolve("/w/ab/x"));
    expect(denied.detail).toMatchObject({ reason: "outside_root" });
  });

  test("rejects protected path", async () => {
    const protectedPaths: readonly ProtectedPathEntry[] = [
      { path: "/work/.git/hooks", match: "prefix", access: "write", reason: "git_exec" },
      { path: "/work/private", match: "prefix", access: "read_write", reason: "secret_key" },
    ];
    const { env, resolve } = resolver("/work", protectedPaths);
    env.put("/work/.git/hooks/pre-commit", "#!/bin/sh");
    env.put("/work/private/key", "k");
    // 쓰기 전용 항목은 읽기를 막지 않는다
    expect((await resolve(".git/hooks/pre-commit")).exists).toBe(true);
    const writeDenied = await failure(resolve(".git/hooks/pre-commit", "write"));
    expect(writeDenied.detail).toMatchObject({ reason: "protected_path", protectedBy: "git_exec" });
    const readDenied = await failure(resolve("private/key"));
    expect(readDenied.detail).toMatchObject({
      reason: "protected_path",
      protectedBy: "secret_key",
    });
  });

  test("passes the allowed roots to protectedPaths so git entries exist before any bash call", async () => {
    // 샌드박스처럼 넘겨받은 root마다 .git/hooks 항목을 만드는 대역
    const env = memoryEnv({ cwd: "/work" });
    env.mkdir("/work");
    const seen: (readonly string[])[] = [];
    const deps = {
      env,
      roots: (context: CancelScope) => defaultRoots(env, context),
      protectedPaths: (roots: readonly string[]): readonly ProtectedPathEntry[] => {
        seen.push(roots);
        return roots.map((root) => ({
          path: `${root}/.git/hooks`,
          match: "prefix",
          access: "write",
          reason: "git_exec",
        }));
      },
    };
    const denied = await failure(
      resolveWorkspacePath(deps, ".git/hooks/pre-commit", "write", CONTEXT),
    );
    expect(denied.detail).toMatchObject({ reason: "protected_path", protectedBy: "git_exec" });
    expect(seen).toEqual([["/work", "/work"]]);
  });

  test("a missing path under an existing root resolves as not existing, not as denied", async () => {
    const { resolve } = resolver("/work");
    expect(await resolve("missing/file.txt")).toMatchObject({
      canonical: "/work/missing/file.txt",
      exists: false,
    });
  });
});

describe("saved tool output (read root)", () => {
  const SHA = "b".repeat(64);
  const DIR = "/state/spill/tool-output";
  const PATH = `${DIR}/thr_1/${SHA}.txt`;

  function withOutputs(blobs: Record<string, string>) {
    const env = memoryEnv({ cwd: "/work" });
    env.mkdir("/work");
    env.mkdir(DIR);
    const outputs: ToolOutputFiles = {
      dir: DIR,
      pathFor: (threadId, sha256) => `${DIR}/${threadId}/${sha256}.txt`,
      write: () => Promise.resolve(err({ kind: "io", cause: "unused" })),
      restore: (path) => {
        const sha256 = path.slice(path.lastIndexOf("/") + 1, -".txt".length);
        const text = blobs[sha256];
        if (!path.startsWith(`${DIR}/`)) return Promise.resolve(ok(false));
        if (text === undefined) return Promise.resolve(err({ kind: "blob_missing", sha256 }));
        env.put(path, text);
        return Promise.resolve(ok(true));
      },
      removeThread: () => Promise.resolve(),
      sweep: () => Promise.resolve(0),
    };
    const deps = {
      env,
      roots: (context: CancelScope) => defaultRoots(env, context, outputs),
      protectedPaths: () => [],
      outputs,
    };
    return { env, deps };
  }

  test("the folder is a read root but not a write root", async () => {
    const { env, deps } = withOutputs({});
    env.put(PATH, "kept");
    expect(await deps.roots(CONTEXT)).toEqual({ read: ["/work", DIR], write: ["/work"] });
    expect((await resolveWorkspacePath(deps, PATH, "read", CONTEXT)).canonical).toBe(PATH);
    const denied = await failure(resolveWorkspacePath(deps, PATH, "write", CONTEXT));
    expect(denied.detail).toMatchObject({ reason: "outside_root" });
  });

  test("a copy that is gone is rebuilt from the blob right before the read", async () => {
    const { env, deps } = withOutputs({ [SHA]: "full text" });
    expect((await env.canonicalPath(PATH, CONTEXT)).ok).toBe(false);
    const resolved = await resolveWorkspacePath(deps, PATH, "read", CONTEXT);
    expect(resolved).toEqual({ requested: PATH, canonical: PATH, exists: true });
  });

  test("a copy whose blob is gone resolves as a missing file inside the root", async () => {
    const { deps } = withOutputs({});
    const resolved = await resolveWorkspacePath(deps, PATH, "read", CONTEXT);
    expect(resolved.exists).toBe(false);
  });

  test("other folders outside the workspace stay denied", async () => {
    const { env, deps } = withOutputs({});
    env.put("/state/config.json", "{}");
    const denied = await failure(resolveWorkspacePath(deps, "/state/config.json", "read", CONTEXT));
    expect(denied.detail).toMatchObject({ reason: "outside_root" });
  });
});
