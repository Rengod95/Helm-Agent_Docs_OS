import { afterEach, describe, expect, test } from "bun:test";
import { chmod, writeFile } from "node:fs/promises";
import { keyCommand, shlexQuote } from "../src/key/provider.ts";
import { selectKeyProvider, type KeySelectInput } from "../src/select.ts";
import { tempDir, type TempDir } from "./support/os.ts";

const TOOLS: Record<string, string> = {
  "secret-tool": "/usr/bin/secret-tool",
  security: "/usr/bin/security",
};

function input(overrides: Partial<KeySelectInput> = {}): KeySelectInput {
  return {
    source: "auto",
    filePath: "/nonexistent/keys.txt",
    info: { platform: "linux", isWsl: false },
    userId: 1000,
    env: {},
    resolveTool: (name) => Promise.resolve(TOOLS[name] ?? null),
    pathExists: () => false,
    ...overrides,
  };
}

const dirs: TempDir[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => dir.remove()));
});

describe("key provider selection (spec §3.7)", () => {
  test("auto falls back to file when secret service missing", async () => {
    const chosen = await selectKeyProvider(input());
    expect(chosen.provider.id).toBe("file");
    expect(chosen.fileNotice).toBe(true);
    expect(chosen.unconfirmedFallback).toBe(true);
  });

  test("auto falls back to file on WSL even when a session bus exists", async () => {
    const chosen = await selectKeyProvider(
      input({
        info: { platform: "linux", isWsl: true },
        env: { DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus" },
      }),
    );
    expect(chosen.provider.id).toBe("file");
    expect(chosen.unconfirmedFallback).toBe(true);
  });

  test("auto uses Secret Service when secret-tool and a session bus exist", async () => {
    const chosen = await selectKeyProvider(
      input({ env: { DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus" } }),
    );
    expect(chosen.provider.id).toBe("linux-secret-service");
    expect(chosen.fileNotice).toBe(false);
    expect(chosen.unconfirmedFallback).toBe(false);
    const env = chosen.provider.sopsKeyEnv();
    expect(env).toEqual({
      ok: true,
      value: {
        SOPS_AGE_KEY_CMD:
          "'/usr/bin/secret-tool' 'lookup' 'service' 'xeon.age' 'account' 'default'",
      },
    });
  });

  test("session bus socket under XDG_RUNTIME_DIR counts as a bus", async () => {
    const chosen = await selectKeyProvider(
      input({
        env: { XDG_RUNTIME_DIR: "/run/user/1000" },
        pathExists: (p) => p === "/run/user/1000/bus",
      }),
    );
    expect(chosen.provider.id).toBe("linux-secret-service");
  });

  test("source keychain picks the OS provider even when it cannot be used", async () => {
    const chosen = await selectKeyProvider(input({ source: "keychain" }));
    expect(chosen.provider.id).toBe("linux-secret-service");
    const noTool = await selectKeyProvider(
      input({
        source: "keychain",
        env: { DBUS_SESSION_BUS_ADDRESS: "x" },
        resolveTool: () => Promise.resolve(null),
      }),
    );
    expect(noTool.provider.sopsKeyEnv()).toEqual({
      ok: false,
      error: { kind: "key_unavailable", key: "linux-secret-service", reason: "no_secret_service" },
    });
  });

  test("macOS builds the Keychain command", async () => {
    const chosen = await selectKeyProvider(input({ info: { platform: "darwin", isWsl: false } }));
    expect(chosen.provider.id).toBe("darwin-keychain");
    expect(chosen.provider.sopsKeyEnv()).toEqual({
      ok: true,
      value: {
        SOPS_AGE_KEY_CMD:
          "'/usr/bin/security' 'find-generic-password' '-s' 'xeon.age' '-a' 'default' '-w'",
      },
    });
    const missing = await selectKeyProvider(
      input({
        info: { platform: "darwin", isWsl: false },
        resolveTool: () => Promise.resolve(null),
      }),
    );
    expect(missing.provider.id).toBe("file");
  });

  test("win32 is a stub: auto goes to file, keychain reports not implemented", async () => {
    const auto = await selectKeyProvider(input({ info: { platform: "win32", isWsl: false } }));
    expect(auto.provider.id).toBe("file");
    const keychain = await selectKeyProvider(
      input({ source: "keychain", info: { platform: "win32", isWsl: false } }),
    );
    expect(keychain.provider.id).toBe("win32-credential");
    expect(await keychain.provider.probe()).toEqual({
      available: false,
      reason: "not_implemented",
    });
    expect(keychain.provider.sopsKeyEnv().ok).toBe(false);
  });
});

describe("shlex quoting (spec §3.7 key command)", () => {
  test("quotes key command for shlex", () => {
    expect(shlexQuote("a b")).toBe("'a b'");
    expect(shlexQuote("C:\\Users\\me\\key")).toBe("'C:\\Users\\me\\key'");
    expect(shlexQuote("it's")).toBe("'it'\\''s'");
    expect(keyCommand(["/opt/my tool/bin", "lookup", "a\\b"])).toBe(
      "'/opt/my tool/bin' 'lookup' 'a\\b'",
    );
  });
});

describe("file fallback (spec §4.7 4번)", () => {
  test("source file confirms the fallback and returns SOPS_AGE_KEY_FILE for a 0600 file", async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const path = dir.join("keys.txt");
    await writeFile(path, "not-a-real-key-file\n");
    await chmod(path, 0o600);
    const chosen = await selectKeyProvider(input({ source: "file", filePath: path, userId: null }));
    expect(chosen.provider.id).toBe("file");
    expect(chosen.fileNotice).toBe(true);
    expect(chosen.unconfirmedFallback).toBe(false);
    expect(chosen.provider.sopsKeyEnv()).toEqual({ ok: true, value: { SOPS_AGE_KEY_FILE: path } });
    expect(await chosen.provider.probe()).toEqual({ available: true, reason: "ok" });
  });

  test("rejects a file readable by others, a missing file and a foreign owner", async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const path = dir.join("keys.txt");
    await writeFile(path, "x\n");
    await chmod(path, 0o644);
    const open = await selectKeyProvider(input({ source: "file", filePath: path, userId: null }));
    expect(open.provider.sopsKeyEnv()).toEqual({
      ok: false,
      error: { kind: "key_unavailable", key: "file", reason: "file_mode" },
    });
    expect(await open.provider.probe()).toEqual({ available: false, reason: "file_mode" });

    const missing = await selectKeyProvider(
      input({ source: "file", filePath: dir.join("absent.txt"), userId: null }),
    );
    expect(missing.provider.sopsKeyEnv()).toEqual({
      ok: false,
      error: { kind: "key_unavailable", key: "file", reason: "item_missing" },
    });

    const foreign = await selectKeyProvider(
      input({
        source: "file",
        filePath: "/any/path",
        userId: 1000,
        stat: () => ({ mode: 0o100600, uid: 0 }),
      }),
    );
    expect(foreign.provider.sopsKeyEnv()).toEqual({
      ok: false,
      error: { kind: "key_unavailable", key: "file", reason: "file_mode" },
    });
    const mine = await selectKeyProvider(
      input({
        source: "file",
        filePath: "/any/path",
        userId: 1000,
        stat: () => ({ mode: 0o100600, uid: 1000 }),
      }),
    );
    expect(mine.provider.sopsKeyEnv().ok).toBe(true);
  });
});
