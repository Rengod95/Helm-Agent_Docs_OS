import { afterEach, expect, test } from "bun:test";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// scripts/guard.sh on its supervised path (no systemd: WS_GUARD_NO_SYSTEMD=1) and scripts/orphans.sh. Every probe process
// writes its pid to a file in the test's own temp dir, so the tests never look at processes they did not start.
const GUARD = join(import.meta.dir, "..", "..", "scripts", "guard.sh");
const ORPHANS = join(import.meta.dir, "..", "..", "scripts", "orphans.sh");
const PROBE = "zz-orphan-probe";

const dirs: string[] = [];
const pids: number[] = [];
const callers: ChildProcess[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "guard-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const caller of callers.splice(0)) caller.kill("SIGKILL");
  for (const pid of pids.splice(0)) spawnSync("kill", ["-KILL", String(pid)]);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** a live process; a zombie waiting for its parent to collect it counts as gone */
function alive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  const ps = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
  const stat = ps.stdout.trim();
  return ps.status === 0 && stat !== "" && !stat.startsWith("Z");
}

/** waits (bounded) until the condition holds; the test's own timeout is the outer limit */
async function until(condition: () => boolean, ms = 15_000): Promise<boolean> {
  if (condition()) return true;
  if (ms <= 0) return false;
  await Bun.sleep(50);
  return until(condition, ms - 50);
}

/** the pid a probe wrote to `file`, undefined until it has written one */
function probePid(file: string): number | undefined {
  const text = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  return text === "" ? undefined : Number(text);
}

/** records probe pids for cleanup; called before any assertion, so a failed test still kills what it started */
function keep(...found: (number | undefined)[]): void {
  for (const pid of found) if (pid !== undefined) pids.push(pid);
}

/**
 * the environment of a guard call made by a test. bun test runs inside `guard.sh run` (test-capped.sh), which exports
 * WS_GUARD_ACTIVE, and a guard that sees it runs the command directly, with no supervisor. So every WS_GUARD_* variable is
 * dropped here and the test sets only the ones it needs: each guard call starts as if from a shell outside any guarded run.
 */
function guardEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("WS_GUARD_")) env[key] = value;
  }
  return { ...env, WS_GUARD_NO_SYSTEMD: "1", WS_GUARD_GRACE_SEC: "1", ...extra };
}

test("a time limit ends the whole group, also a descendant that left it", () => {
  const dir = tempDir();
  const inGroup = join(dir, "in-group.pid");
  const escaped = join(dir, "escaped.pid");
  const script = [
    `sleep 300 & echo $! > ${inGroup}`,
    `perl -e 'use POSIX; POSIX::setsid(); open(my $f, ">", $ARGV[0]); print $f $$; close $f; exec "sleep", "301"' ${escaped} &`,
    "wait",
  ].join("\n");
  const run = spawnSync(GUARD, ["run", "--", "sh", "-c", script], {
    encoding: "utf8",
    env: guardEnv({ WS_GUARD_TIMEOUT_SEC: "3" }),
    timeout: 60_000,
  });
  const first = probePid(inGroup);
  const second = probePid(escaped);
  keep(first, second);
  expect(run.status).toBe(124);
  expect(run.stderr).toContain("time limit 3s passed");
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  expect(alive(first)).toBe(false);
  expect(alive(second)).toBe(false);
}, 30_000);

test("what a command leaves in its group ends with it, and its exit code is kept", () => {
  const dir = tempDir();
  const leftover = join(dir, "leftover.pid");
  const run = spawnSync(
    GUARD,
    ["run", "--", "sh", "-c", `sleep 300 & echo $! > ${leftover}; exit 7`],
    {
      encoding: "utf8",
      env: guardEnv({}),
      timeout: 60_000,
    },
  );
  const pid = probePid(leftover);
  keep(pid);
  expect(run.status).toBe(7);
  expect(pid).toBeDefined();
  expect(alive(pid)).toBe(false);
}, 30_000);

test("the group ends when the process that started the guard is killed", async () => {
  const dir = tempDir();
  const child = join(dir, "child.pid");
  const inner = `sleep 300 & echo $! > ${child}; wait`;
  // the trailing `:` keeps bash as the parent of guard.sh instead of exec-ing it
  const caller = spawn("bash", ["-c", `${GUARD} run -- sh -c '${inner}'; :`], {
    env: guardEnv({}),
    stdio: "ignore",
  });
  callers.push(caller);
  expect(await until(() => probePid(child) !== undefined)).toBe(true);
  const pid = probePid(child);
  keep(pid);
  expect(pid).toBeDefined();
  expect(alive(pid)).toBe(true);
  caller.kill("SIGKILL");
  expect(await until(() => !alive(pid))).toBe(true);
}, 30_000);

/** the parent pid of `pid` (0 when it has none to report, e.g. it is gone) */
function ppidOf(pid: number): number {
  const ps = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" });
  return Number(ps.stdout.trim()) || 0;
}

/** an orphan (parent pid 1) in `cwd` that ignores SIGTERM, found by the probe word in its command line */
async function startOrphan(cwd: string, name: string): Promise<number> {
  const file = join(tempDir(), `${name}.pid`);
  const body = `trap "" TERM; echo $$ > ${file}; while :; do sleep 1; done # ${PROBE}`;
  // a simple background command with the cwd set on the starter: the starter exits at once and the orphan is reparented to pid 1.
  // (A `( cd && sh -c ... &)` starter keeps a subshell between them as the parent, which stays alive, so the orphan is never pid 1.)
  const starter = spawn("sh", ["-c", `sh -c '${body}' </dev/null >/dev/null 2>&1 &`], {
    cwd,
    stdio: "ignore",
  });
  await new Promise((resolve) => starter.once("exit", resolve));
  expect(await until(() => probePid(file) !== undefined)).toBe(true);
  const pid = probePid(file);
  keep(pid);
  if (pid === undefined) throw new Error(`${name}: the probe wrote no pid`);
  expect(await until(() => ppidOf(pid) === 1)).toBe(true);
  return pid;
}

/** orphans.sh with the probe pattern and `root` as its only worktree root: it can never reach another worktree's processes */
function orphans(args: string[], root: string) {
  const env = { ...process.env, ORPHANS_PATTERN: PROBE, ORPHANS_ROOTS: root };
  return spawnSync(ORPHANS, args, { encoding: "utf8", env, timeout: 60_000 });
}

test("an orphan that ignores its parent's death is listed, reaped only with --yes, and only inside a worktree", async () => {
  const root = tempDir();
  const outside = tempDir();
  const mine = await startOrphan(root, "mine");
  const theirs = await startOrphan(outside, "theirs");

  // --min-age 0: the orphan is seconds old, and the default 600 s would (rightly) call it too young to reap
  const list = orphans(["--min-age", "0"], root);
  expect(list.status).toBe(0);
  const mineLine = list.stdout.split("\n").find((line) => line.startsWith(`${mine} `)) ?? "";
  expect(mineLine).toContain(root.split("/").pop() ?? "never");
  expect(mineLine).toContain("[reapable");
  const theirLine = list.stdout.split("\n").find((line) => line.startsWith(`${theirs} `)) ?? "";
  expect(theirLine).toContain("left alone");

  const dry = orphans(["--reap", "--min-age", "0", "--grace", "1"], root);
  expect(dry.status).toBe(3);
  expect(alive(mine)).toBe(true);

  const young = orphans(["--reap", "--yes", "--min-age", "100000", "--grace", "1"], root);
  expect(young.status).toBe(0);
  expect(alive(mine)).toBe(true);

  const reap = orphans(["--reap", "--yes", "--min-age", "0", "--grace", "1"], root);
  expect(reap.status).toBe(0);
  expect(await until(() => !alive(mine))).toBe(true);
  expect(alive(theirs)).toBe(true);
}, 90_000);
