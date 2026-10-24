import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attempt, parseJson } from "@xeon/contracts";
import type { HookRawRun, HookRunSpec } from "@xeon/contracts/extensions";
import { createHookRunner, detectProcessPlatform, type HookRunner } from "../src/index.ts";
import { memoryLogger } from "./support/fakes.ts";
import { realScheduler, waitFor } from "./support/real-time.ts";

// L0.process.plan PR-21, spec §4.8 run, §9 14·15: 실제 자식 프로세스로 외부 훅 실행 규칙을 확인한다.

const CHILD = `${import.meta.dir}/fixtures/hook-child.ts`;

function isAlive(pid: number): boolean {
  return attempt(() => process.kill(pid, 0)).ok;
}

const platform = detectProcessPlatform();
if (!platform.ok) throw new Error("this test needs a supported platform");

function makeRunner(
  graceMs = 500,
  shutdownSignal: AbortSignal = new AbortController().signal,
): HookRunner {
  return createHookRunner({
    platform: platform.ok ? platform.value : undefined,
    scheduler: realScheduler(),
    graceMs,
    shutdownSignal,
    logger: memoryLogger(),
  });
}

function spec(overrides: Partial<HookRunSpec> & { readonly args: readonly string[] }): HookRunSpec {
  const { args, ...rest } = overrides;
  return {
    argv: [process.execPath, CHILD, ...args],
    cwd: import.meta.dir,
    env: { XEON_FROM_SPEC: "1" },
    stdin: "",
    maxStdoutChars: 10_000,
    maxStderrChars: 10_000,
    signal: new AbortController().signal,
    ...rest,
  };
}

function jsonOf(text: string): unknown {
  const parsed = parseJson(text.trim().split("\n")[0] ?? "");
  return parsed.ok ? parsed.value : undefined;
}

describe("hook run", () => {
  test("hook run does not inherit parent env", async () => {
    // 부모에는 있고 spec.env에는 없는 이름이 훅 프로세스에 보이지 않아야 한다(spec §9 15). PATH와 HOME은 시험 부모에 항상 있다
    const run = await makeRunner().run(spec({ args: ["env"] }));
    const names = jsonOf(run.stdout);
    expect(Array.isArray(names)).toBe(true);
    expect(names).toContain("XEON_FROM_SPEC");
    expect(names).not.toContain("PATH");
    expect(names).not.toContain("HOME");
    expect(run.exitCode).toBe(0);
    expect(run.timedOut).toBe(false);
  });

  test("stdin is written and closed, stdout and stderr and the exit code come back", async () => {
    const echoed = await makeRunner().run(spec({ args: ["stdin"], stdin: "hello 훅\n" }));
    expect(echoed).toMatchObject({
      exitCode: 0,
      signal: null,
      stdout: "HELLO 훅\n",
      timedOut: false,
    });
    const failed = await makeRunner().run(spec({ args: ["exit", "7"] }));
    expect(failed).toMatchObject({ exitCode: 7, stderr: "bye\n", stdoutTruncated: false });
  });

  test("hook run reports spawn errors without rejecting", async () => {
    const run = await makeRunner().run(
      spec({ args: [], argv: [`${import.meta.dir}/fixtures/does-not-exist`] }),
    );
    expect(run).toEqual({
      exitCode: null,
      signal: null,
      stdout: "",
      stdoutTruncated: false,
      stderr: "",
      timedOut: false,
      spawnError: "ENOENT",
    });
    const empty = await makeRunner().run(spec({ args: [], argv: [] }));
    expect(empty.spawnError).toBe("EINVAL");
  });

  test("arguments the runtime refuses synchronously come back as spawnError, not as a rejection", async () => {
    // argv의 NUL 바이트는 spawn이 동기로 던진다
    const run = await makeRunner().run(spec({ args: [], argv: [process.execPath, "bad\0arg"] }));
    expect(run.exitCode).toBeNull();
    expect(run.timedOut).toBe(false);
    expect(typeof run.spawnError).toBe("string");
  });

  test("hook run truncates output and flags only stdout truncation", async () => {
    const run = await makeRunner().run(
      spec({ args: ["big", "50000"], maxStdoutChars: 100, maxStderrChars: 10 }),
    );
    expect(run.stdout).toBe("x".repeat(100));
    expect(run.stdoutTruncated).toBe(true);
    expect(run.exitCode).toBe(0);
  });

  test("multibyte output is cut on characters, not bytes", async () => {
    const run = await makeRunner().run(
      spec({ args: ["stdin"], stdin: "가나다라마바사", maxStdoutChars: 4 }),
    );
    expect(run.stdout).toBe("가나다라");
    expect(run.stdoutTruncated).toBe(true);
  });

  test("hook run stops the whole tree on abort and reports timedOut", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xeon-hook-"));
    const marker = join(dir, "pids.json");
    const controller = new AbortController();
    const running = makeRunner(300).run(
      spec({ args: ["tree", marker], signal: controller.signal }),
    );
    // 자식과 손자가 모두 떴을 때(표식 파일이 생겼을 때) 중단한다
    expect(await waitFor(() => existsSync(marker), 5000)).toBe(true);
    const pids = jsonOf(readFileSync(marker, "utf8"));
    const parent =
      typeof pids === "object" && pids !== null ? Reflect.get(pids, "parent") : undefined;
    const leaf = typeof pids === "object" && pids !== null ? Reflect.get(pids, "leaf") : undefined;
    if (typeof parent !== "number" || typeof leaf !== "number") throw new Error("pids missing");
    expect(isAlive(leaf)).toBe(true);
    controller.abort();
    const run = await running;
    rmSync(dir, { recursive: true, force: true });
    expect(run.timedOut).toBe(true);
    // SIGTERM을 무시하는 손자도 graceMs 뒤 force로 사라진다
    expect(await waitFor(() => !isAlive(parent) && !isAlive(leaf), 3000)).toBe(true);
  });
});

describe("hook run and shutdown", () => {
  test("an already aborted budget does not start the process", async () => {
    const controller = new AbortController();
    controller.abort();
    const run: HookRawRun = await makeRunner().run(
      spec({ args: ["wait"], signal: controller.signal }),
    );
    expect(run).toMatchObject({ exitCode: null, timedOut: true });
    expect(run.spawnError).toBeUndefined();
  });

  test("a shutdown request stops a running hook and drain waits for it", async () => {
    const shutdown = new AbortController();
    const runner = makeRunner(300, shutdown.signal);
    const running = runner.run(spec({ args: ["wait"] }));
    shutdown.abort();
    await runner.drain();
    const run = await running;
    expect(run).toMatchObject({ timedOut: true, signal: "SIGTERM" });
  });
});
