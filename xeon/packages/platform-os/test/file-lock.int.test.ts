import { afterEach, describe, expect, test } from "bun:test";
import { attemptAsync, repeatAsync } from "@xeon/contracts";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempDir, type TempDir } from "../src/testing/index.ts";
import type { HolderSignal } from "./fixtures/lock-holder.ts";
import type { UpdaterSignal } from "./fixtures/lock-updater.ts";
import { processOnlyFileLock, realFileLock } from "./support/file-lock.ts";

// L0.os.spec §3.11, L0.os.plan OS-20: 실제 파일과 자식 프로세스로 파일 잠금을 확인한다.

const HOLDER = join(import.meta.dir, "fixtures", "lock-holder.ts");
const UPDATER = join(import.meta.dir, "fixtures", "lock-updater.ts");

let temp: TempDir | undefined;
const children: Bun.Subprocess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  await temp?.remove();
  temp = undefined;
});

async function workDir(): Promise<TempDir> {
  temp = await tempDir();
  return temp;
}

function spawnScript(script: string, args: readonly string[]): Bun.Subprocess<"ignore", "pipe"> {
  const child = Bun.spawn([process.execPath, script, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });
  children.push(child);
  return child;
}

async function firstLine(child: Bun.Subprocess<"ignore", "pipe">): Promise<string> {
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let text = "";
  return repeatAsync<string>(async () => {
    const chunk = await reader.read();
    if (chunk.done) return { value: text.trim() };
    text += decoder.decode(chunk.value, { stream: true });
    const end = text.indexOf("\n");
    if (end === -1) return undefined;
    reader.releaseLock();
    return { value: text.slice(0, end) };
  });
}

const lock = realFileLock();
const crossProcess = lock === undefined ? test.skip : test;

describe("FileLock in one process", () => {
  test("critical sections for one path never overlap and run in arrival order", async () => {
    const dir = await workDir();
    const target = dir.join("trust.json");
    const fileLock = processOnlyFileLock();
    const events: string[] = [];
    const section = (name: string, ms: number) => async (): Promise<string> => {
      events.push(`${name}:in`);
      await new Promise<void>((resolve) => setTimeout(resolve, ms));
      events.push(`${name}:out`);
      return name;
    };
    const results = await Promise.all([
      fileLock.withLock(target, section("a", 40)),
      fileLock.withLock(target, section("b", 5)),
    ]);
    expect(results).toEqual([
      { ok: true, value: "a" },
      { ok: true, value: "b" },
    ]);
    expect(events).toEqual(["a:in", "a:out", "b:in", "b:out"]);
    expect(fileLock.scope).toBe("process");
  });

  test("different paths do not block each other", async () => {
    const dir = await workDir();
    const fileLock = processOnlyFileLock();
    const events: string[] = [];
    const gate = Promise.withResolvers<void>();
    const first = fileLock.withLock(dir.join("a.json"), async () => {
      events.push("a:in");
      await gate.promise;
      events.push("a:out");
    });
    const second = await fileLock.withLock(dir.join("b.json"), () => {
      events.push("b");
      return Promise.resolve(2);
    });
    gate.resolve();
    await first;
    expect(second).toEqual({ ok: true, value: 2 });
    expect(events).toEqual(["a:in", "b", "a:out"]);
  });

  test("waiting longer than timeoutMs is a timeout value naming the path", async () => {
    const dir = await workDir();
    const target = dir.join("trust.json");
    const fileLock = processOnlyFileLock();
    const gate = Promise.withResolvers<void>();
    const holder = fileLock.withLock(target, () => gate.promise);
    const waiting = await fileLock.withLock(target, () => Promise.resolve(1), { timeoutMs: 60 });
    expect(waiting.ok).toBe(false);
    if (!waiting.ok && waiting.error.kind === "timeout") {
      expect(waiting.error.path).toBe(target);
      expect(waiting.error.waitedMs).toBeGreaterThanOrEqual(60);
    } else {
      throw new Error(`expected a timeout, got ${JSON.stringify(waiting)}`);
    }
    gate.resolve();
    await holder;
    // 놓은 뒤에는 바로 얻는다
    expect(await fileLock.withLock(target, () => Promise.resolve(3))).toEqual({
      ok: true,
      value: 3,
    });
  });

  test("an aborted signal is cancelled, and a throwing section still releases the lock", async () => {
    const dir = await workDir();
    const target = dir.join("trust.json");
    const fileLock = processOnlyFileLock();
    const gate = Promise.withResolvers<void>();
    const holder = fileLock.withLock(target, () => gate.promise);
    const controller = new AbortController();
    const waiting = fileLock.withLock(target, () => Promise.resolve(1), {
      timeoutMs: 5000,
      signal: controller.signal,
    });
    controller.abort();
    expect(await waiting).toEqual({ ok: false, error: { kind: "cancelled" } });
    gate.resolve();
    await holder;
    const thrown = await attemptAsync(() =>
      fileLock.withLock(target, () => Promise.reject(new Error("boom"))),
    );
    expect(!thrown.ok && thrown.error.cause instanceof Error && thrown.error.cause.message).toBe(
      "boom",
    );
    expect(await fileLock.withLock(target, () => Promise.resolve(7))).toEqual({
      ok: true,
      value: 7,
    });
  });

  test("updateText hands the current text to the callback and replaces the file privately", async () => {
    const dir = await workDir();
    const target = dir.join("config", "trust.json");
    const fileLock = processOnlyFileLock();
    const seen: (string | null)[] = [];
    const replaceWith = (next: string) =>
      fileLock.updateText(target, (current) => {
        seen.push(current);
        return next;
      });
    expect(await replaceWith("one")).toEqual({ ok: true, value: undefined });
    expect(await replaceWith("two")).toEqual({ ok: true, value: undefined });
    expect(seen).toEqual([null, "one"]);
    expect(await readFile(target, "utf8")).toBe("two");
    if (process.platform !== "win32") {
      expect((await stat(target)).mode & 0o777).toBe(0o600);
      expect((await stat(dir.join("config"))).mode & 0o777).toBe(0o700);
    }
    // 임시 파일이 남지 않는다. 잠금 파일은 지우지 않는다
    expect((await readdir(dir.join("config"))).toSorted()).toEqual(["trust.json"]);
  });

  test("a callback that throws leaves the file untouched and rejects", async () => {
    const dir = await workDir();
    const target = dir.join("trust.json");
    await writeFile(target, "keep");
    const fileLock = processOnlyFileLock();
    const thrown = await attemptAsync(() =>
      fileLock.updateText(target, () => {
        throw new Error("corrupt");
      }),
    );
    expect(!thrown.ok && thrown.error.cause instanceof Error && thrown.error.cause.message).toBe(
      "corrupt",
    );
    expect(await readFile(target, "utf8")).toBe("keep");
    expect(await fileLock.updateText(target, () => "after")).toEqual({
      ok: true,
      value: undefined,
    });
  });

  test("an unreadable target is an io value with the errno code", async () => {
    const dir = await workDir();
    const fileLock = processOnlyFileLock();
    // 대상 경로가 디렉터리면 읽기가 EISDIR로 실패한다
    const result = await fileLock.updateText(dir.path, () => "x");
    expect(result).toEqual({
      ok: false,
      error: { kind: "io", path: dir.path, code: "EISDIR" },
    });
  });
});

describe("FileLock across processes", () => {
  crossProcess(
    "reports cross_process scope and refuses while another process holds the lock",
    async () => {
      const dir = await workDir();
      const target = dir.join("trust.json");
      const holder = spawnScript(HOLDER, [target]);
      const ready: HolderSignal = "READY";
      expect(await firstLine(holder)).toBe(ready);
      const fileLock = lock;
      if (fileLock === undefined) throw new Error("flock is unavailable");
      expect(fileLock.scope).toBe("cross_process");
      const refused = await fileLock.withLock(target, () => Promise.resolve(1), { timeoutMs: 150 });
      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.error.kind).toBe("timeout");
      // 쥔 프로세스가 SIGKILL로 죽으면 OS가 잠금을 푼다
      holder.kill("SIGKILL");
      await holder.exited;
      expect(
        await fileLock.withLock(target, () => Promise.resolve(2), { timeoutMs: 1000 }),
      ).toEqual({
        ok: true,
        value: 2,
      });
      // 잠금 파일은 지우지 않는다
      expect(await readdir(dir.path)).toEqual(["trust.json.lock"]);
    },
  );

  crossProcess("concurrent processes updating one file lose no update", async () => {
    const dir = await workDir();
    const target = dir.join("trust.json");
    const names = ["p1", "p2", "p3", "p4"];
    const perProcess = 25;
    const kids = names.map((name) => spawnScript(UPDATER, [target, name, String(perProcess)]));
    const outcomes = await Promise.all(kids.map((kid) => firstLine(kid)));
    const done: UpdaterSignal = "DONE";
    expect(outcomes).toEqual(names.map(() => done));
    const lines = (await readFile(target, "utf8")).split("\n").filter((line) => line !== "");
    // 읽기-수정-쓰기가 서로를 덮어쓰면 줄이 줄어든다
    expect(lines).toHaveLength(names.length * perProcess);
    for (const name of names) {
      expect(lines.filter((line) => line === name)).toHaveLength(perProcess);
    }
  });
});
