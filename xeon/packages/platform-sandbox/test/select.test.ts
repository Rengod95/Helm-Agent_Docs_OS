import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { selectSandboxProvider, type PlatformInput } from "../src/select.ts";

function input(overrides: Partial<PlatformInput>): PlatformInput {
  return {
    platform: "linux",
    arch: "x64",
    env: {},
    procVersion: "Linux version 6.1.0",
    ...overrides,
  };
}

describe("selectSandboxProvider", () => {
  test("darwin uses seatbelt and needs only rg", () => {
    const provider = selectSandboxProvider(input({ platform: "darwin", procVersion: undefined }));
    expect(provider.kind).toBe("seatbelt");
    expect(provider.platform).toBe("darwin");
    expect(provider.requiredBinaries().map((bin) => bin.name)).toEqual(["rg"]);
  });

  test("linux uses bwrap and needs bwrap, socat and rg", () => {
    const provider = selectSandboxProvider(input({}));
    expect(provider.kind).toBe("bwrap");
    expect(provider.platform).toBe("linux");
    expect(provider.requiredBinaries().map((bin) => bin.name)).toEqual(["bwrap", "socat", "rg"]);
  });

  test("WSL2 is linux with platform wsl2", () => {
    const byKernel = selectSandboxProvider(
      input({ procVersion: "Linux version 6.18.33.2-microsoft-standard-WSL2 (root@x)" }),
    );
    expect(byKernel.kind).toBe("bwrap");
    expect(byKernel.platform).toBe("wsl2");
    const byName = selectSandboxProvider(input({ env: { WSL_DISTRO_NAME: "Ubuntu" } }));
    expect(byName.platform).toBe("wsl2");
  });

  test("WSL1 has no sandbox", () => {
    const provider = selectSandboxProvider(
      input({ procVersion: "Linux version 4.4.0-19041-Microsoft (Microsoft@Microsoft.com)" }),
    );
    expect(provider.kind).toBe("none");
    expect(provider.platform).toBe("wsl1");
    expect(provider.unsupported).toBe("unsupported_os");
  });

  test("win32, unknown OS and unsupported arch map to none", () => {
    const win = selectSandboxProvider(input({ platform: "win32", procVersion: undefined }));
    expect([win.kind, win.platform, win.unsupported]).toEqual(["none", "win32", "unsupported_os"]);
    const bsd = selectSandboxProvider(input({ platform: "freebsd", procVersion: undefined }));
    expect([bsd.kind, bsd.platform, bsd.unsupported]).toEqual(["none", "other", "unsupported_os"]);
    const ia32 = selectSandboxProvider(input({ arch: "ia32" }));
    expect([ia32.kind, ia32.platform, ia32.unsupported]).toEqual([
      "none",
      "linux",
      "unsupported_os",
    ]);
  });

  test("none providers need no binaries and protect nothing extra", () => {
    const provider = selectSandboxProvider(input({ platform: "win32" }));
    expect(provider.requiredBinaries()).toEqual([]);
    expect(provider.defaultProtectedPaths({ home: "/h", data: "/d", config: "/c" })).toEqual([]);
  });

  test("darwin adds LaunchAgents and the Library sops key, linux adds systemd user units", () => {
    const dirs = { home: "/h", data: "/d", config: "/c" };
    const darwin = selectSandboxProvider(input({ platform: "darwin" })).defaultProtectedPaths(dirs);
    expect(darwin.map((entry) => entry.path)).toEqual([
      "/h/Library/Application Support/sops/age/keys.txt",
      "/h/Library/LaunchAgents",
    ]);
    const linux = selectSandboxProvider(input({})).defaultProtectedPaths(dirs);
    expect(linux.map((entry) => entry.path)).toEqual(["/h/.config/systemd/user"]);
  });
});

describe("select is the only platform reader", () => {
  test("no other source file reads process.platform, process.arch or /proc/version", () => {
    const srcDir = join(import.meta.dir, "..", "src");
    const files = readdirSync(srcDir, { recursive: true, encoding: "utf8" }).filter((name) =>
      name.endsWith(".ts"),
    );
    expect(files.length).toBeGreaterThan(5);
    const offenders = files.filter((name) => {
      if (name === "select.ts") return false;
      const text = readFileSync(join(srcDir, name), "utf8");
      return /process\.platform|process\.arch|\/proc\/version/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
