import { afterEach, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import type { BackgroundStopper } from "@xeon/contracts/services";
import { createBackgroundRegistry } from "../src/index.ts";
import { manualClock } from "./support/clock.ts";
import { memoryLogger, sequentialLocalIds } from "./support/fakes.ts";
import { realScheduler, waitFor } from "./support/real-time.ts";

const TREE = `${import.meta.dir}/fixtures/tree.ts`;

interface Tree {
  readonly child: ChildProcess;
  readonly parentPid: number;
  readonly leafPid: number;
  readonly stopper: BackgroundStopper;
  /** 프로세스 그룹에 보낸 시그널 */
  readonly signals: readonly string[];
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 등록자 쪽 BackgroundStopper: 프로세스 그룹 전체에 시그널을 보낸다(spec §4.3, plan PR-06) */
async function startTree(...flags: readonly string[]): Promise<Tree> {
  const child = spawn(process.execPath, [TREE, ...flags], {
    detached: true,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error("tree did not start");
  const line = await new Promise<string>((resolve, reject) => {
    child.once("error", reject);
    child.stdout.once("data", (chunk: Buffer) => {
      resolve(chunk.toString("utf8"));
    });
  });
  const parsed: unknown = JSON.parse(line);
  const leafPid =
    typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "leaf") : undefined;
  if (typeof leafPid !== "number") throw new Error("tree did not report the leaf pid");
  const signals: string[] = [];
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
  const stopper: BackgroundStopper = {
    exited,
    stop(mode) {
      const signal = mode === "graceful" ? "SIGTERM" : "SIGKILL";
      signals.push(signal);
      try {
        process.kill(-pid, signal);
      } catch {
        // 이미 끝난 그룹
      }
      return Promise.resolve();
    },
  };
  return { child, parentPid: pid, leafPid, stopper, signals };
}

const started: Tree[] = [];

afterEach(() => {
  for (const tree of started.splice(0)) {
    try {
      process.kill(-tree.parentPid, "SIGKILL");
    } catch {
      // 이미 정리됨
    }
  }
});

function makeRegistry() {
  return createBackgroundRegistry({
    clock: manualClock(),
    scheduler: realScheduler(),
    ids: sequentialLocalIds(),
    logger: memoryLogger(),
  });
}

describe("registry with real process trees", () => {
  test("registry stops the whole process tree", async () => {
    const registry = makeRegistry();
    const tree = await startTree();
    started.push(tree);
    expect(isAlive(tree.parentPid)).toBe(true);
    expect(isAlive(tree.leafPid)).toBe(true);
    const registered = registry.register({
      label: "tree",
      owner: { kind: "tool", threadId: "thr_tree", ref: null },
      pid: tree.parentPid,
      stopper: tree.stopper,
    });
    if (!registered.ok) throw new Error("register failed");
    expect(await registry.stopOwnedBy("thr_tree", { graceMs: 2000 })).toBe(1);
    expect(registry.get(registered.value)?.state).toBe("exited");
    expect(tree.signals).toEqual(["SIGTERM"]);
    expect(await waitFor(() => !isAlive(tree.parentPid) && !isAlive(tree.leafPid), 3000)).toBe(
      true,
    );
  });

  test("a tree that ignores SIGTERM is force-killed and ends as killed", async () => {
    const registry = makeRegistry();
    const tree = await startTree("ignore-term");
    started.push(tree);
    const registered = registry.register({
      label: "stubborn tree",
      owner: { kind: "tool", threadId: "thr_stubborn", ref: null },
      pid: tree.parentPid,
      stopper: tree.stopper,
    });
    if (!registered.ok) throw new Error("register failed");
    const result = await registry.stop(registered.value, { graceMs: 300 });
    expect(result).toEqual({ ok: true, value: "killed" });
    expect(tree.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(await waitFor(() => !isAlive(tree.parentPid) && !isAlive(tree.leafPid), 3000)).toBe(
      true,
    );
  });

  test("registry stops everything on shutdown", async () => {
    const registry = makeRegistry();
    const trees = await Promise.all([startTree(), startTree()]);
    started.push(...trees);
    for (const tree of trees) {
      registry.register({
        label: "tree",
        owner: { kind: "mcp", threadId: null, ref: null },
        pid: tree.parentPid,
        stopper: tree.stopper,
      });
    }
    expect(await registry.close({ graceMs: 2000 })).toBe(2);
    expect(registry.list().map((info) => info.state)).toEqual(["exited", "exited"]);
    const gone = await Promise.all(
      trees.map((tree) => waitFor(() => !isAlive(tree.parentPid) && !isAlive(tree.leafPid), 3000)),
    );
    expect(gone).toEqual([true, true]);
  });
});
