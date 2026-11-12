import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  createLogMonitorGuard,
  isLogMonitorCommand,
  parseProcessRows,
  selectLogMonitors,
} from "../src/log-monitor.ts";

const MONITOR = 'log stream --predicate (eventMessage ENDSWITH "_k3j9x2abc_SBX") --style compact';

describe("log monitor selection", () => {
  test("recognises only the srt violation monitor", () => {
    expect(isLogMonitorCommand(MONITOR)).toBe(true);
    expect(isLogMonitorCommand(`/usr/bin/${MONITOR}`)).toBe(true);
    expect(isLogMonitorCommand("log stream --style compact")).toBe(false);
    expect(isLogMonitorCommand("bun test log stream _SBX")).toBe(false);
  });

  test("parses ps rows and selects by parent", () => {
    const rows = parseProcessRows(
      ["  101     1 " + MONITOR, "  102   500 " + MONITOR, "  103   500 bun run x", "junk"].join(
        "\n",
      ),
    );
    expect(rows).toEqual([
      { pid: 101, ppid: 1, command: MONITOR },
      { pid: 102, ppid: 500, command: MONITOR },
      { pid: 103, ppid: 500, command: "bun run x" },
    ]);
    expect(selectLogMonitors(rows, 1)).toEqual([101]);
    expect(selectLogMonitors(rows, 500)).toEqual([102]);
  });

  test("sweep ends a monitor-shaped child of this process", async () => {
    // 실제 log stream 대신 같은 명령줄을 가진 자식을 띄운다
    const child = spawn(
      "sh",
      [
        "-c",
        `exec -a 'log stream --predicate (eventMessage ENDSWITH "_zz_SBX") --style compact' sleep 30`,
      ],
      {
        stdio: "ignore",
      },
    );
    const exited = new Promise<string | null>((resolve) =>
      child.on("exit", (_c, sig) => resolve(sig)),
    );
    await Bun.sleep(300);
    createLogMonitorGuard().sweep();
    const timeout = new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 5000));
    expect(await Promise.race([exited, timeout])).toBe("SIGTERM");
  });
});
