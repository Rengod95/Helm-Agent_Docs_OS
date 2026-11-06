import { spawn, spawnSync } from "node:child_process";
import { pollUntil } from "./support/process.ts";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir, uptime } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createChildLedger } from "../src/child-ledger.ts";
import { hostPlatform } from "./support/platform.ts";

// L0.exec.spec §3.8, PATCHES P20: 비정상 종료한 호스트가 남긴 자식 그룹을 다음 시작에서 거둔다.

const platform = hostPlatform();
const dirs: string[] = [];
const pids: number[] = [];

afterEach(() => {
  for (const pid of pids.splice(0)) platform.killProcessTree(pid);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fresnel-ledger-"));
  dirs.push(dir);
  return dir;
}

function groupLeader(): number {
  const child = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
  child.unref();
  const pid = child.pid;
  if (pid === undefined) throw new Error("spawn failed");
  pids.push(pid);
  return pid;
}

function alive(pid: number): boolean {
  return spawnSync("kill", ["-0", String(pid)]).status === 0;
}

async function deadPid(): Promise<number> {
  const quick = spawn("true", [], { stdio: "ignore" });
  const pid = quick.pid;
  if (pid === undefined) throw new Error("spawn failed");
  await new Promise<void>((resolve) => quick.once("exit", () => resolve()));
  return pid;
}

function writeEntry(root: string, hostPid: number, pid: number, bootMs: number): void {
  const dir = join(root, "fresnel-exec-children");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${String(hostPid)}-${String(pid)}.json`),
    JSON.stringify({ hostPid, pid, bootMs }),
  );
}

function waitDead(pid: number): Promise<boolean> {
  return pollUntil(() => !alive(pid), 100);
}

const bootNow = (): number => Date.now() - Math.round(uptime() * 1000);

describe.skipIf(platform.platform.kind === "win32")("child ledger", () => {
  test("sweep kills the group a dead host left behind and removes its line", async () => {
    const root = tempDir();
    const child = groupLeader();
    writeEntry(root, await deadPid(), child, bootNow());
    const ledger = createChildLedger({ dir: join(root, "tmp"), platform });
    expect(ledger.sweep()).toBe(1);
    expect(await waitDead(child)).toBe(true);
    expect(readdirSync(join(root, "fresnel-exec-children"))).toEqual([]);
  });

  test("sweep leaves a live host's child and a line from another boot alone", async () => {
    const root = tempDir();
    const mine = groupLeader();
    const stale = groupLeader();
    writeEntry(root, process.pid, mine, bootNow());
    writeEntry(root, await deadPid(), stale, bootNow() - 3_600_000);
    const ledger = createChildLedger({ dir: join(root, "tmp"), platform });
    expect(ledger.sweep()).toBe(0);
    expect(alive(mine)).toBe(true);
    expect(alive(stale)).toBe(true);
  });

  test("killAll kills the groups it tracks and add/remove keep the ledger in step", async () => {
    const root = tempDir();
    const child = groupLeader();
    const ledger = createChildLedger({ dir: join(root, "tmp"), platform });
    ledger.add(child);
    expect(readdirSync(join(root, "fresnel-exec-children"))).toEqual([
      `${String(process.pid)}-${String(child)}.json`,
    ]);
    ledger.killAll();
    expect(await waitDead(child)).toBe(true);
    ledger.remove(child);
    expect(readdirSync(join(root, "fresnel-exec-children"))).toEqual([]);
  });
});
