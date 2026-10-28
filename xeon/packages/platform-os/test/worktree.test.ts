import { afterEach, expect, test } from "bun:test";
import { mkdir, stat, symlink } from "node:fs/promises";
import { err, ok } from "@xeon/contracts";
import { createRunCommand, type RunCommand } from "../src/proc.ts";
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

/** 커밋 하나짜리 저장소를 만든다. 브랜치는 main이다 */
async function initRepo(repo: string): Promise<void> {
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
}

test("create, list and remove against a real repository", async () => {
  temp = await tempDir();
  const repo = temp.join("repo");
  const wt = temp.join("wt-feature");
  await initRepo(repo);
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

test("a failing git worktree add returns git_failed whose output is git's stderr", async () => {
  temp = await tempDir();
  const repo = temp.join("repo");
  await initRepo(repo);
  const ops = createWorktreeOps({ run: createRunCommand() });
  // main은 이미 있는 브랜치라 같은 이름으로 새 브랜치를 만들 수 없다. git은 이 오류를 stderr에 쓴다
  const failed = await ops.create(
    repo,
    { path: temp.join("wt-dup-branch"), branch: "main" },
    new AbortController().signal,
  );
  expect(failed).toEqual({
    ok: false,
    error: {
      kind: "git_failed",
      // git의 종료 코드는 버전마다 달라서 숫자인지만 보고, 핵심은 stderr 문구다
      exitCode: expect.any(Number),
      output: expect.stringContaining("already exists"),
    },
  });
});

/** 실행을 흉내 낸다. add는 성공하고 list는 `porcelain`을 돌려준다 */
function fakeGit(porcelain: string): RunCommand {
  return (argv) =>
    Promise.resolve(ok({ exitCode: 0, stdout: argv.includes("list") ? porcelain : "" }));
}

test("create fails with git_failed when the new path is not in the worktree list", async () => {
  const run = fakeGit(
    ["worktree /xeon-test/main", "HEAD aaa", "branch refs/heads/main", ""].join("\n"),
  );
  const ops = createWorktreeOps({ run });
  expect(
    await ops.create(
      "/xeon-test/main",
      { path: "/xeon-test/wt-new", branch: "b" },
      new AbortController().signal,
    ),
  ).toEqual(err({ kind: "git_failed", exitCode: 0, output: "worktree not listed after add" }));
});

test("create matches the listed path after realpath, not the last listed entry", async () => {
  temp = await tempDir();
  const real = temp.join("real");
  const link = temp.join("link");
  await mkdir(real);
  await symlink(real, link);
  const run = fakeGit(
    [
      "worktree /xeon-test/main",
      "HEAD aaa",
      "branch refs/heads/main",
      "",
      `worktree ${real}`,
      "HEAD bbb",
      "branch refs/heads/b",
      "",
      "worktree /xeon-test/other",
      "HEAD ccc",
      "detached",
      "",
    ].join("\n"),
  );
  const ops = createWorktreeOps({ run });
  const created = await ops.create(
    "/xeon-test/main",
    { path: link, branch: "b" },
    new AbortController().signal,
  );
  expect(created).toEqual(ok({ path: real, branch: "b", head: "bbb", isMain: false }));
});
