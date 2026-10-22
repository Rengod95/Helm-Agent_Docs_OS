import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { Logger, LogFields } from "@xeon/contracts";
import type { CancelScope } from "@xeon/contracts/services";
import { closeBestEffort } from "../src/upstream/env/index.ts";
import { NodeExecutionEnv } from "../src/upstream/env/node.ts";
import { hostPlatform } from "./support/platform.ts";
import { pollUntil } from "./support/process.ts";

// PATCHES.md P16 (open-issues N-10): 정리 단계 close 실패와 감시 콜백 예외는 Logger에 남는다. 동작(감시 계속, 원래 결과 보존)은 그대로다.

const none: CancelScope = { abortSignal: undefined };
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface LogRecord {
  readonly level: string;
  readonly event: string;
  readonly fields: LogFields | undefined;
}

function recordingLogger(): { readonly logger: Logger; readonly records: LogRecord[] } {
  const records: LogRecord[] = [];
  const write =
    (level: string) =>
    (event: string, fields?: LogFields): void => {
      records.push({ level, event, fields });
    };
  const logger: Logger = {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    child: () => logger,
  };
  return { logger, records };
}

describe("closeBestEffort", () => {
  test("a failing close is logged and does not throw", async () => {
    const { logger, records } = recordingLogger();
    await closeBestEffort(
      { close: () => Promise.reject(new Error("EBADF: bad file descriptor")) },
      logger,
    );
    expect(records).toEqual([
      {
        level: "warn",
        event: "exec.close_failed",
        fields: { error: "EBADF: bad file descriptor" },
      },
    ]);
  });

  test("a failing close without a logger and a missing handle are quiet", async () => {
    await closeBestEffort({ close: () => Promise.reject(new Error("x")) });
    await closeBestEffort(undefined);
    await closeBestEffort({ close: () => Promise.resolve() }, recordingLogger().logger);
  });
});

describe("watch callback failures", () => {
  test("a throwing change callback is logged and watching continues", async () => {
    const root = mkdtempSync(join(tmpdir(), "xeon-exec-watch-"));
    dirs.push(root);
    const { logger, records } = recordingLogger();
    const env = new NodeExecutionEnv({
      cwd: root,
      platform: hostPlatform(),
      logger,
      watch: { mode: "polling", pollIntervalMs: 30 },
    });
    let calls = 0;
    const watched = await env.watch(
      [{ path: ".", recursive: true }],
      () => {
        calls += 1;
        throw new Error("callback broke");
      },
      none,
    );
    if (!watched.ok) throw watched.error;
    writeFileSync(join(root, "one.txt"), "1");
    expect(await pollUntil(() => calls >= 1, 200)).toBe(true);
    writeFileSync(join(root, "two.txt"), "2");
    expect(await pollUntil(() => calls >= 2, 200)).toBe(true);
    await watched.value.close(none);
    const failures = records.filter((record) => record.event === "exec.watch_callback_failed");
    expect(failures.length).toBe(calls);
    expect(failures[0]).toEqual({
      level: "error",
      event: "exec.watch_callback_failed",
      fields: { error: "callback broke" },
    });
  });
});
