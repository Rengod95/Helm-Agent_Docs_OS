import { afterEach, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
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

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "guard-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const pid of pids.splice(0)) spawnSync("kill", ["-KILL", String(pid)]);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** a live process; a zombie waiting for its parent to collect it counts as gone */
function alive(pid: number): boolean {
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

function readPid(file: string): number {
  return Number(readFileSync(file, "utf8").trim());
}

const SUPERVISED = { WS_GUARD_NO_SYSTEMD: "1", WS_GUARD_GRACE_SEC: "1" };

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
    env: { ...process.env, ...SUPERVISED, WS_GUARD_TIMEOUT_SEC: "2" },
    timeout: 60_000,
  });
  expect(run.status).toBe(124);
  expect(run.stderr).toContain("time limit 2s passed");
  const first = readPid(inGroup);
  const second = readPid(escaped);
  pids.push(first, second);
  expect(alive(first)).toBe(false);
  expect(alive(second)).toBe(false);
});

test("what a command leaves in its group ends with it, and its exit code is kept", () => {
  const dir = tempDir();
  const leftover = join(dir, "leftover.pid");
  const run = spawnSync(
    GUARD,
    ["run", "--", "sh", "-c", `sleep 300 & echo $! > ${leftover}; exit 7`],
    {
      encoding: "utf8",
      env: { ...process.env, ...SUPERVISED },
      timeout: 60_000,
    },
  );
  expect(run.status).toBe(7);
  const pid = readPid(leftover);
  pids.push(pid);
  expect(alive(pid)).toBe(false);
});

test("the group ends when the process that started the guard is killed", async () => {
  const dir = tempDir();
  const child = join(dir, "child.pid");
  const inner = `sleep 300 & echo $! > ${child}; wait`;
  // the trailing `:` keeps bash as the parent of guard.sh instead of exec-ing it
  const caller = spawn("bash", ["-c", `${GUARD} run -- sh -c '${inner}'; :`], {
    env: { ...process.env, ...SUPERVISED },
    stdio: "ignore",
  });
  expect(await until(() => existsSync(child))).toBe(true);
  const pid = readPid(child);
  pids.push(pid);
  expect(alive(pid)).toBe(true);
  caller.kill("SIGKILL");
  expect(await until(() => !alive(pid))).toBe(true);
}, 60_000);

/** an orphan (parent pid 1) in `cwd` that ignores SIGTERM, found by the probe word in its command line */
async function startOrphan(cwd: string, name: string): Promise<number> {
  const file = join(tempDir(), `${name}.pid`);
  const body = `trap "" TERM; echo $$ > ${file}; while :; do sleep 1; done # ${PROBE}`;
  const starter = spawn(
    "sh",
    ["-c", `(cd "$1" && sh -c '${body}' </dev/null >/dev/null 2>&1 &)`, "sh", cwd],
    {
      stdio: "ignore",
    },
  );
  await new Promise((resolve) => starter.once("exit", resolve));
  expect(await until(() => existsSync(file))).toBe(true);
  const pid = readPid(file);
  pids.push(pid);
  // reparented to pid 1 once the starter is gone
  const parentIsInit = (): boolean => {
    const ps = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" });
    return ps.stdout.trim() === "1";
  };
  expect(await until(parentIsInit)).toBe(true);
  return pid;
}

function orphans(args: string[], root: string | undefined) {
  const env: Record<string, string | undefined> = { ...process.env, ORPHANS_PATTERN: PROBE };
  if (root !== undefined) env["ORPHANS_ROOTS"] = root;
  return spawnSync(ORPHANS, args, { encoding: "utf8", env, timeout: 60_000 });
}

test("an orphan that ignores its parent's death is listed, reaped only with --yes, and only inside a worktree", async () => {
  const root = tempDir();
  const outside = tempDir();
  const mine = await startOrphan(root, "mine");
  const theirs = await startOrphan(outside, "theirs");

  const list = orphans([], root);
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
