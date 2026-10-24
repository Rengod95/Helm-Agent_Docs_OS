import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { NodeExecutionEnv } from "../src/upstream/env/node.ts";
import { groupProcessCount, pollUntil } from "./support/process.ts";
import { hostPlatform } from "./support/platform.ts";

// EX-10: Bun 동작 스파이크 겸 회귀 시험. spawn(detached: true) + process.kill(-pid, "SIGKILL")이 손자까지 끝내는가.

const platform = hostPlatform();
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xeon-exec-group-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function readPgid(pidFile: string): Promise<number> {
  expect(
    await pollUntil(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "", 200),
  ).toBe(true);
  return Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
}

function command(pidFile: string): string {
  return `echo $$ > '${pidFile}'; sleep 30 & sleep 30 & wait`;
}

describe.skipIf(platform.platform.kind === "win32")("process group", () => {
  test("abort kills the whole process group", async () => {
    const root = tempDir();
    const pidFile = join(root, "pgid");
    const env = new NodeExecutionEnv({ cwd: root, platform });
    const controller = new AbortController();
    const running = env.exec(command(pidFile), undefined, { abortSignal: controller.signal });
    const pgid = await readPgid(pidFile);
    expect(pgid).toBeGreaterThan(0);
    expect(await pollUntil(() => groupProcessCount(pgid) >= 3, 200)).toBe(true);

    controller.abort();
    const result = await running;
    expect(!result.ok && result.error.code).toBe("aborted");
    expect(await pollUntil(() => groupProcessCount(pgid) === 0, 50)).toBe(true);
  });

  test("timeout kills the process group and reports timeout", async () => {
    const root = tempDir();
    const pidFile = join(root, "pgid");
    const env = new NodeExecutionEnv({ cwd: root, platform });
    const result = await env.exec(command(pidFile), { timeout: 0.5 }, { abortSignal: undefined });
    expect(!result.ok && result.error.code).toBe("timeout");
    const pgid = await readPgid(pidFile);
    expect(await pollUntil(() => groupProcessCount(pgid) === 0, 50)).toBe(true);
  });

  test("cleanup kills the running commands of the env", async () => {
    const root = tempDir();
    const pidFile = join(root, "pgid");
    const env = new NodeExecutionEnv({ cwd: root, platform });
    const running = env.exec(command(pidFile), undefined, { abortSignal: undefined });
    const pgid = await readPgid(pidFile);
    await env.cleanup({ abortSignal: undefined });
    const result = await running;
    expect(result.ok).toBe(true);
    expect(await pollUntil(() => groupProcessCount(pgid) === 0, 50)).toBe(true);
  });
});
