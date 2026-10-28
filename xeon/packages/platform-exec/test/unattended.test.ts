import { describe, expect, test } from "bun:test";
import { ok } from "@xeon/contracts";
import type { Shell, ShellExecOptions } from "@xeon/contracts/services";
import { createExecService } from "../src/service.ts";
import { readUnattendedTimeoutMs } from "../src/settings.ts";
import { withUnattendedTimeout } from "../src/unattended.ts";
import { hostPlatform } from "./support/platform.ts";

const none = { abortSignal: undefined };

function seenTimeouts(): {
  shell: Shell;
  timeouts: (number | undefined)[];
  others: ShellExecOptions[];
} {
  const timeouts: (number | undefined)[] = [];
  const others: ShellExecOptions[] = [];
  const shell: Shell = {
    exec: (_command, options) => {
      timeouts.push(options?.timeout);
      others.push({ ...options });
      return Promise.resolve(ok({ exitCode: 0 }));
    },
    cleanup: () => Promise.resolve(),
  };
  return { shell, timeouts, others };
}

describe("withUnattendedTimeout", () => {
  test("a missing, zero or longer timeout becomes the cap, a shorter caller value stays", async () => {
    const { shell, timeouts, others } = seenTimeouts();
    const capped = withUnattendedTimeout(shell, 60_000);
    await capped.exec("a", undefined, none);
    await capped.exec("b", { timeout: 0 }, none);
    await capped.exec("c", { timeout: 3600 }, none);
    await capped.exec("d", { timeout: 5, cwd: "/w" }, none);
    expect(timeouts).toEqual([60, 60, 60, 5]);
    expect(others[3]).toEqual({ timeout: 5, cwd: "/w" });
  });

  test("a command longer than the cap is stopped with a timeout error, ordinary calls stay unlimited", async () => {
    const service = createExecService(
      {
        cwd: process.cwd(),
        shellPath: "/bin/bash",
        defaultTimeoutMs: 0,
        outputSpillBytes: 0,
        envExtra: [],
      },
      {
        platform: hostPlatform(),
        secrets: undefined,
        parentEnv: { PATH: process.env.PATH, HOME: process.env.HOME },
      },
    );
    const capped = await withUnattendedTimeout(service, 200).exec("sleep 5", undefined, none);
    expect(!capped.ok && capped.error.code).toBe("timeout");
    // 같은 서비스를 직접 쓰면 상한이 없다
    const plain = await service.exec("sleep 0.4; echo done", undefined, none);
    expect(plain.ok).toBe(true);
  });
});

describe("readUnattendedTimeoutMs", () => {
  test("uses the setting when valid and falls back to 30 minutes otherwise", () => {
    expect(readUnattendedTimeoutMs(() => 90_000)).toBe(90_000);
    expect(readUnattendedTimeoutMs(() => undefined)).toBe(1_800_000);
    expect(readUnattendedTimeoutMs(() => 0)).toBe(1_800_000);
    expect(readUnattendedTimeoutMs(() => "5")).toBe(1_800_000);
  });
});
