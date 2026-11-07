import { afterEach, describe, expect, test } from "bun:test";
import { chmod, writeFile } from "node:fs/promises";
import { ok } from "@fresnel/contracts";
import type { DarwinKeyExec } from "../src/key/darwin.ts";
import { keyCommand, shlexQuote } from "../src/key/provider.ts";
import type { ProcessRunner } from "../src/providers/process.ts";
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
          "'/usr/bin/secret-tool' 'lookup' 'service' 'fresnel.age' 'account' 'default'",
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
          "'/usr/bin/security' 'find-generic-password' '-s' 'fresnel.age' '-a' 'default' '-w'",
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

/** 가짜 `security`: `find-generic-password`의 종료 코드만 답한다(0 항목 있음, 44 없음). 실제 키체인은 건드리지 않는다 */
function securityAnswering(exitCode: number): DarwinKeyExec {
  const runner: ProcessRunner = () =>
    Promise.resolve(ok({ exitCode, stdout: new Uint8Array(), stderr: "" }));
  return { runner, env: {}, signal: new AbortController().signal };
}

const MAC: KeySelectInput["info"] = { platform: "darwin", isWsl: false };

describe("macOS key selection when the Keychain item may be missing (spec §4.7 9번)", () => {
  test("no Keychain item and no key file: the first key goes to the 0600 file", async () => {
    const chosen = await selectKeyProvider(
      input({ info: MAC, exec: securityAnswering(44), stat: () => null }),
    );
    expect(chosen.provider.id).toBe("file");
    expect(chosen.newFileKey).toBe(true);
    expect(chosen.unconfirmedFallback).toBe(false);
    expect(chosen.fileNotice).toBe(true);
  });

  test("no Keychain item but a key file exists: the file is used and nothing is created", async () => {
    const chosen = await selectKeyProvider(
      input({
        info: MAC,
        userId: 501,
        exec: securityAnswering(44),
        stat: () => ({ mode: 0o600, uid: 501 }),
      }),
    );
    expect(chosen.provider.id).toBe("file");
    expect(chosen.newFileKey).toBe(false);
    expect(chosen.unconfirmedFallback).toBe(false);
    expect(chosen.fileNotice).toBe(true);
    expect(chosen.provider.sopsKeyEnv()).toEqual({
      ok: true,
      value: { SOPS_AGE_KEY_FILE: "/nonexistent/keys.txt" },
    });
  });

  test("no Keychain item and a key file with the wrong mode: refused, not replaced", async () => {
    const chosen = await selectKeyProvider(
      input({
        info: MAC,
        userId: 501,
        exec: securityAnswering(44),
        stat: () => ({ mode: 0o644, uid: 501 }),
      }),
    );
    expect(chosen.provider.id).toBe("file");
    expect(chosen.newFileKey).toBe(false);
    expect(chosen.provider.sopsKeyEnv()).toEqual({
      ok: false,
      error: { kind: "key_unavailable", key: "file", reason: "file_mode" },
    });
  });

  test("a Keychain item that exists keeps the macOS provider and its key", async () => {
    const chosen = await selectKeyProvider(
      input({ info: MAC, exec: securityAnswering(0), stat: () => null }),
    );
    expect(chosen.provider.id).toBe("darwin-keychain");
    expect(chosen.newFileKey).toBe(false);
    expect(chosen.fileNotice).toBe(false);
    expect(chosen.unconfirmedFallback).toBe(false);
  });

  test("a Keychain lookup that fails is unknown, so the macOS provider stays", async () => {
    const chosen = await selectKeyProvider(
      input({ info: MAC, exec: securityAnswering(1), stat: () => null }),
    );
    expect(chosen.provider.id).toBe("darwin-keychain");
    expect(chosen.newFileKey).toBe(false);
  });

  test("source keychain and auto-file never switch to the file for a missing item", async () => {
    const keychain = await selectKeyProvider(
      input({ source: "keychain", info: MAC, exec: securityAnswering(44), stat: () => null }),
    );
    expect(keychain.provider.id).toBe("darwin-keychain");
    expect(keychain.newFileKey).toBe(false);
    const remote = await selectKeyProvider(
      input({ source: "auto-file", info: MAC, exec: securityAnswering(44), stat: () => null }),
    );
    expect(remote.provider.id).toBe("darwin-keychain");
    expect(remote.newFileKey).toBe(false);
    expect(remote.unconfirmedFallback).toBe(false);
  });

  test("source file uses the file provider and is never a first key", async () => {
    const chosen = await selectKeyProvider(
      input({
        source: "file",
        info: MAC,
        userId: 501,
        exec: securityAnswering(44),
        stat: () => null,
      }),
    );
    expect(chosen.provider.id).toBe("file");
    expect(chosen.newFileKey).toBe(false);
    expect(chosen.fileNotice).toBe(true);
    expect(chosen.unconfirmedFallback).toBe(false);
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
