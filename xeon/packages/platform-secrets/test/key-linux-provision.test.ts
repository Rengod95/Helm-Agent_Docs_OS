import { afterEach, describe, expect, test } from "bun:test";
import { chmod, stat, writeFile } from "node:fs/promises";
import { identityToRecipient } from "age-encryption";
import { ok } from "@xeon/contracts";
import { createLinuxKeyProvider, type LinuxKeyExec } from "../src/key/linux.ts";
import type { ProcessRunner, RunRequest } from "../src/providers/process.ts";
import { selectKeyProvider, type KeySelectInput } from "../src/select.ts";
import { tempDir, type TempDir } from "./support/os.ts";
import { allZero } from "./support/value-source.ts";

// M3-m2c-04 (b). Linux Secret Service에 age 키를 만든다. 실제 secret-tool은 부르지 않는다.
// 가짜 secret-tool이 항목 하나를 메모리에 둔다. 실기 확인은 Secret Service가 있는 Linux 데스크톱이다.

const SECRET_TOOL = "/usr/bin/secret-tool";

interface FakeSecretTool {
  readonly runner: ProcessRunner;
  readonly requests: RunRequest[];
  stored(): string | null;
  stdins(): Uint8Array[];
}

const done = (exitCode: number) =>
  Promise.resolve(ok({ exitCode, stdout: new Uint8Array(), stderr: "" }));

function fakeSecretTool(
  options: { readonly existing?: string; readonly swallowStore?: boolean } = {},
): FakeSecretTool {
  let item: string | null = options.existing ?? null;
  const requests: RunRequest[] = [];
  const stdins: Uint8Array[] = [];
  const runner: ProcessRunner = (request) => {
    requests.push(request);
    if (request.argv[1] === "lookup") return done(item === null ? 1 : 0);
    if (request.argv[1] === "store" && request.stdin !== undefined) {
      stdins.push(request.stdin);
      if (options.swallowStore !== true) item = new TextDecoder().decode(request.stdin);
      return done(0);
    }
    return done(2);
  };
  return { runner, requests, stored: () => item, stdins: () => stdins };
}

function exec(runner: ProcessRunner): LinuxKeyExec {
  return { runner, env: { PATH: "/usr/bin" }, signal: new AbortController().signal };
}

function provider(fake: FakeSecretTool) {
  return createLinuxKeyProvider({
    secretToolPath: SECRET_TOOL,
    isWsl: false,
    env: { DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus" },
    pathExists: () => false,
    exec: exec(fake.runner),
  });
}

describe("Linux Secret Service key provision", () => {
  test("creates the item once and returns the recipient of the stored identity", async () => {
    const fake = fakeSecretTool();
    const made = await provider(fake).provision?.();
    expect(made?.ok).toBe(true);
    if (made === undefined || !made.ok) return;
    const identity = fake.stored();
    expect(identity?.startsWith("AGE-SECRET-KEY-1")).toBe(true);
    expect(
      identity !== null && (await identityToRecipient(identity)) === made.value.recipient,
    ).toBe(true);
    // 순서: 존재 확인, 만들기, 다시 확인
    expect(fake.requests.map((r) => r.argv[1])).toEqual(["lookup", "store", "lookup"]);
    // 존재 확인은 stdout을 버린다: identity 바이트를 받지 않는다
    expect(fake.requests.filter((r) => r.argv[1] === "lookup").every((r) => r.discardStdout)).toBe(
      true,
    );
    expect(fake.requests[1]?.argv).toEqual([
      SECRET_TOOL,
      "store",
      "--label=xeon age key",
      "service",
      "xeon.age",
      "account",
      "default",
    ]);
  });

  test("the identity never appears in argv and the stdin buffer is zeroed afterwards", async () => {
    const fake = fakeSecretTool();
    await provider(fake).provision?.();
    const identity = fake.stored();
    expect(identity).not.toBeNull();
    for (const request of fake.requests) {
      expect(request.argv.some((arg) => identity !== null && arg.includes(identity))).toBe(false);
    }
    expect(fake.stdins().length).toBe(1);
    expect(fake.stdins().every(allZero)).toBe(true);
  });

  test("an existing item is never overwritten (EEXIST)", async () => {
    const fake = fakeSecretTool({ existing: "AGE-SECRET-KEY-1EXISTING" });
    const made = await provider(fake).provision?.();
    expect(made).toEqual({
      ok: false,
      error: { kind: "write_failed", target: "key_store", path: "secret-service", code: "EEXIST" },
    });
    expect(fake.requests.map((r) => r.argv[1])).toEqual(["lookup"]);
    expect(fake.stored()).toBe("AGE-SECRET-KEY-1EXISTING");
  });

  test("a store that did not take effect is reported even when the exit code is 0", async () => {
    const fake = fakeSecretTool({ swallowStore: true });
    const made = await provider(fake).provision?.();
    expect(made).toEqual({
      ok: false,
      error: {
        kind: "write_failed",
        target: "key_store",
        path: "secret-service",
        code: "add_failed",
      },
    });
  });

  test("without an exec port, or on WSL, there is no provision", () => {
    const base = {
      secretToolPath: SECRET_TOOL,
      env: { DBUS_SESSION_BUS_ADDRESS: "x" },
      pathExists: () => false,
    };
    const plain = createLinuxKeyProvider({ ...base, isWsl: false });
    expect("provision" in plain).toBe(false);
    const wsl = createLinuxKeyProvider({
      ...base,
      isWsl: true,
      exec: exec(fakeSecretTool().runner),
    });
    expect("provision" in wsl).toBe(false);
  });
});

function input(overrides: Partial<KeySelectInput>): KeySelectInput {
  return {
    source: "auto-file",
    filePath: "/nonexistent/keys.txt",
    info: { platform: "linux", isWsl: false },
    userId: null,
    env: {},
    resolveTool: (name) => Promise.resolve(name === "secret-tool" ? SECRET_TOOL : null),
    pathExists: () => false,
    ...overrides,
  };
}

describe("remote host key file fallback (auto-file)", () => {
  const dirs: TempDir[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => dir.remove()));
  });

  test("tries the Secret Service first and only falls back to the file when it is absent", async () => {
    const withService = await selectKeyProvider(
      input({ env: { DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus" } }),
    );
    expect(withService.provider.id).toBe("linux-secret-service");
    expect(withService.unconfirmedFallback).toBe(false);

    const headless = await selectKeyProvider(input({}));
    expect(headless.provider.id).toBe("file");
    // 원격 호스트는 사람 확인 없이 파일 폴백을 쓰되 위험 고지는 낸다
    expect(headless.unconfirmedFallback).toBe(false);
    expect(headless.fileNotice).toBe(true);
    // 같은 조건의 auto는 확인 전까지 쓰지 않는다
    const auto = await selectKeyProvider(input({ source: "auto" }));
    expect(auto.unconfirmedFallback).toBe(true);
  });

  test.each([0o640, 0o644, 0o666, 0o400, 0o700])(
    "a key file with mode %o is refused",
    async (mode) => {
      const dir = await tempDir();
      dirs.push(dir);
      const path = dir.join("keys.txt");
      await writeFile(path, "x\n");
      await chmod(path, mode);
      const chosen = await selectKeyProvider(input({ filePath: path }));
      expect(chosen.provider.id).toBe("file");
      expect(chosen.provider.sopsKeyEnv()).toEqual({
        ok: false,
        error: { kind: "key_unavailable", key: "file", reason: "file_mode" },
      });
    },
  );

  test("mode 0600 is accepted, and a key file made by provision has exactly mode 0600", async () => {
    const dir = await tempDir();
    dirs.push(dir);
    const path = dir.join("keys.txt");
    const chosen = await selectKeyProvider(input({ filePath: path }));
    const made = await chosen.provider.provision?.();
    expect(made?.ok).toBe(true);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(chosen.provider.sopsKeyEnv()).toEqual({ ok: true, value: { SOPS_AGE_KEY_FILE: path } });
  });
});
