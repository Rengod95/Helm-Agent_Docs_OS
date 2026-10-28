import { afterEach, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { createRunCommand } from "../src/proc.ts";
import { tempDir, type TempDir } from "../src/testing/index.ts";
import { createWorktreeOps, parseWorktreeList } from "../src/worktree.ts";

let temp: TempDir | undefined;
afterEach(async () => {
  await temp?.remove();
  temp = undefined;
});

test("porcelain output is parsed with the first entry as main and detached heads as null branch", () => {
  const out = [
    "worktree /r",
    "HEAD aaa",
    "branch refs/heads/main",
    "",
    "worktree /r-wt",
    "HEAD bbb",
    "detached",
    "",
  ].join("\n");
  expect(parseWorktreeList(out)).toEqual([
    { path: "/r", branch: "main", head: "aaa", isMain: true },
    { path: "/r-wt", branch: null, head: "bbb", isMain: false },
  ]);
});

test("relative paths are rejected before git runs", async () => {
  const ops = createWorktreeOps({ run: () => Promise.reject(new Error("must not run")) });
  const signal = new AbortController().signal;
  expect(await ops.list("rel", signal)).toEqual({
    ok: false,
    error: { kind: "not_absolute", path: "rel" },
  });
  expect(await ops.create("/r", { path: "wt", branch: "b" }, signal)).toEqual({
    ok: false,
    error: { kind: "not_absolute", path: "wt" },
  });
});

async function git(cwd: string, args: readonly string[]): Promise<void> {
  const proc = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

test("create, list and remove against a real repository", async () => {
  temp = await tempDir();
  const repo = temp.join("repo");
  const wt = temp.join("wt-feature");
  await Bun.spawn(["git", "init", "-q", "-b", "main", repo]).exited;
  await git(repo, [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  ]);
  const ops = createWorktreeOps({ run: createRunCommand() });
  const signal = new AbortController().signal;

  const created = await ops.create(repo, { path: wt, branch: "feature" }, signal);
  expect(created.ok && { branch: created.value.branch, isMain: created.value.isMain }).toEqual({
    branch: "feature",
    isMain: false,
  });
  const listed = await ops.list(repo, signal);
  expect(listed.ok && listed.value.map((w) => [w.branch, w.isMain])).toEqual([
    ["main", true],
    ["feature", false],
  ]);

  const dup = await ops.create(repo, { path: wt, branch: "feature" }, signal);
  expect(!dup.ok && dup.error.kind).toBe("git_failed");

  expect(await ops.remove(repo, wt, {}, signal)).toEqual({ ok: true, value: undefined });
  expect(
    await stat(wt).then(
      () => true,
      () => false,
    ),
  ).toBe(false);
  const after = await ops.list(repo, signal);
  expect(after.ok && after.value.length).toBe(1);
});
