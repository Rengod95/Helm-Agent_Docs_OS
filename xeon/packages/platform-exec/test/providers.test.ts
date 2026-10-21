import { describe, expect, test } from "bun:test";
import { darwinProvider } from "../src/providers/darwin.ts";
import { createLinuxProvider } from "../src/providers/linux.ts";
import { createWin32Provider } from "../src/providers/win32.ts";

describe("providers", () => {
  test("darwin provider enables FSEvents settle rescan", () => {
    expect(darwinProvider.fsEventsSettleRescan).toBe(true);
    expect(darwinProvider.statfsUnreliableCheck).toBe(false);
    expect(darwinProvider.perDirectoryWatchers).toBe(false);
    expect(darwinProvider.detachedSpawn).toBe(true);
    expect(darwinProvider.noFollow).toBe("open_flag");
  });

  test("linux provider checks statfs and watches per directory", () => {
    const linux = createLinuxProvider({ wsl: false });
    expect(linux.statfsUnreliableCheck).toBe(true);
    expect(linux.perDirectoryWatchers).toBe(true);
    expect(linux.fsEventsSettleRescan).toBe(false);
    expect(linux.platform).toEqual({ kind: "linux", wsl: false });
    expect(createLinuxProvider({ wsl: true }).platform).toEqual({ kind: "linux", wsl: true });
  });

  test("posix providers use /bin/bash, which and an sh fallback", () => {
    for (const provider of [darwinProvider, createLinuxProvider({ wsl: false })]) {
      expect(provider.shellCandidates()).toEqual(["/bin/bash"]);
      expect(provider.bashLookup).toEqual(["which", "bash"]);
      expect(provider.fallbackShell).toEqual({ shell: "sh", args: ["-c"] });
      expect(provider.backslashTilde).toBe(false);
      expect(provider.forcePollingWatch).toBe(false);
    }
  });

  test("win32 noFollow uses lstat precheck", () => {
    const win32 = createWin32Provider({ env: {} });
    expect(win32.noFollow).toBe("lstat_precheck");
    expect(win32.forcePollingWatch).toBe(true);
    expect(win32.backslashTilde).toBe(true);
    expect(win32.fallbackShell).toBeUndefined();
    expect(win32.bashLookup).toEqual(["where", "bash.exe"]);
  });

  test("win32 provider kills the tree with taskkill and spawns attached", () => {
    const runs: (readonly string[])[] = [];
    const win32 = createWin32Provider({ env: {}, run: (argv) => runs.push(argv) });
    win32.killProcessTree(1234);
    expect(runs).toEqual([["C:\\Windows\\System32\\taskkill.exe", "/F", "/T", "/PID", "1234"]]);
    expect(win32.detachedSpawn).toBe(false);

    const custom: (readonly string[])[] = [];
    createWin32Provider({
      env: { SystemRoot: "D:\\Win" },
      run: (argv) => custom.push(argv),
    }).killProcessTree(7);
    expect(custom[0]).toEqual(["D:\\Win\\System32\\taskkill.exe", "/F", "/T", "/PID", "7"]);
  });

  test("win32 shell candidates come from ProgramFiles and ProgramFiles(x86)", () => {
    const win32 = createWin32Provider({
      env: { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" },
    });
    expect(win32.shellCandidates()).toEqual([
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    ]);
    expect(createWin32Provider({ env: {} }).shellCandidates()).toEqual([]);
  });

  test("win32 adds its allowlist names and treats legacy WSL bash.exe as stdin transport", () => {
    const win32 = createWin32Provider({ env: {} });
    expect(win32.envAllowlistExtra).toEqual([
      "SystemRoot",
      "ComSpec",
      "PATHEXT",
      "USERPROFILE",
      "TEMP",
      "TMP",
    ]);
    expect(win32.bashConfig("C:\\Windows\\System32\\bash.exe")).toEqual({
      shell: "C:\\Windows\\System32\\bash.exe",
      args: ["-s"],
      commandTransport: "stdin",
    });
    expect(win32.bashConfig("C:/Windows/Sysnative/bash.exe").commandTransport).toBe("stdin");
    expect(win32.bashConfig("C:\\Program Files\\Git\\bin\\bash.exe")).toEqual({
      shell: "C:\\Program Files\\Git\\bin\\bash.exe",
      args: ["-c"],
    });
  });
});
