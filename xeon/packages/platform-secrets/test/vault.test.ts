import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@fresnel/contracts";
import type { ProcessRunner, RunRequest } from "../src/providers/process.ts";
import { createTokenVault, VAULT_SERVICE, type TokenVault, type VaultError } from "../src/vault.ts";
import { allZero } from "./support/value-source.ts";

// 원격 장치 토큰 보관소(src/vault.ts) 시험. 실제 security와 secret-tool은 부르지 않는다.
// 가짜 실행기가 명령 줄을 해석해 메모리의 항목을 바꾼다. 실기 확인은 macOS 키체인과 Secret Service가 있는 Linux다.

type Platform = "darwin" | "linux";
type RunReply = ReturnType<ProcessRunner>;
type RunResult = Awaited<RunReply>;

interface FakeOptions {
  /** 처음부터 있는 항목(계정 → 값) */
  readonly seed?: Readonly<Record<string, string>>;
  /** 쓰기가 성공했다고 답하지만 항목을 만들지 않는다 */
  readonly swallowWrite?: boolean;
  /** 모든 호출의 종료 코드를 이것으로 바꾼다 */
  readonly exit?: number;
  /** 모든 호출을 실행 실패로 끝낸다 */
  readonly failure?: "cancelled" | "spawn_failed";
}

interface FakeStore {
  readonly runner: ProcessRunner;
  /** 받은 요청 전부(호출 순서) */
  readonly requests: RunRequest[];
  /** 요청에 실려 온 stdin 버퍼 참조. 호출이 끝나면 0으로 덮인다 */
  readonly stdins: Uint8Array[];
  /** 호출 시점에 읽은 stdin 내용. 버퍼가 덮인 뒤에도 쓸 수 있다 */
  readonly texts: string[];
  /** 자식이 돌려준 stdout 버퍼 참조. 호출자가 읽고 0으로 덮는다 */
  readonly outputs: Uint8Array[];
  /** 가짜 저장소의 항목 */
  readonly items: Map<string, string>;
}

const SECURITY = "/usr/bin/security";
const SECRET_TOOL = "/usr/bin/secret-tool";
const ACCOUNT = "rmt.example.test:8443";
const BRACKETED_ACCOUNT = "[fe80::1]:443";
/** 가짜 토큰. 허용 문자만 쓴다 */
const TOKEN = "FAKE_tok.0123456789~abc+/=-xyz";
const OLD_TOKEN = "FAKE_old.abcdefgh12345678";
const ENV = { PATH: "/usr/bin" };
const SIGNAL = new AbortController().signal;
const PLATFORMS: readonly Platform[] = ["darwin", "linux"];
/** 키체인이 받는 줄 모양. 값 자리는 공백 없는 묶음이다 */
const ADD_LINE = /^add-generic-password (-U )?-s (\S+) -a (\S+) -l "([^"]*)" -w (\S+)\n$/;

const BAD_ACCOUNTS = [
  "",
  "a b",
  'x"y',
  "x\ny",
  "x;rm -rf",
  "ab$(id)",
  "-leading",
  "a".repeat(129),
  "tab\tx",
  "back\\slash",
  "é",
];
const BAD_VALUES = [
  "",
  "short",
  "abc def ghi",
  "abcdefgh\nrm -rf /",
  'abc"defgh',
  "abc'defgh",
  "abcdefgh\\",
  "x".repeat(513),
  "tok\tenx123",
];

const NOT_FOUND_ERROR: VaultError = { kind: "not_found" };
const BAD_ACCOUNT_ERROR: VaultError = { kind: "failed", code: "bad_account" };
const BAD_VALUE_ERROR: VaultError = { kind: "failed", code: "bad_value" };

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function argAfter(argv: readonly string[], flag: string): string {
  return argv[argv.indexOf(flag) + 1] ?? "";
}

function runFailure(failure: "cancelled" | "spawn_failed"): RunResult {
  if (failure === "cancelled") return err({ kind: "cancelled" });
  return err({ kind: "spawn_failed", code: "ENOENT" });
}

/** 가짜 security·secret-tool. 같은 저장소를 두 플랫폼 모양으로 흉내 낸다 */
function fakeStore(platform: Platform, options: FakeOptions = {}): FakeStore {
  const items = new Map<string, string>(Object.entries(options.seed ?? {}));
  const requests: RunRequest[] = [];
  const stdins: Uint8Array[] = [];
  const texts: string[] = [];
  const outputs: Uint8Array[] = [];

  /** 출력을 돌려준다. stdout을 읽는 호출이면 그 버퍼를 기록한다 */
  function reply(request: RunRequest, exitCode: number, text: string): RunReply {
    if (request.discardStdout === true) {
      return Promise.resolve(ok({ exitCode, stdout: new Uint8Array(), stderr: "" }));
    }
    const stdout = new TextEncoder().encode(text);
    outputs.push(stdout);
    return Promise.resolve(ok({ exitCode, stdout, stderr: "" }));
  }

  function keychain(request: RunRequest): RunReply {
    const argv = request.argv;
    const command = argv[1];
    const account = argAfter(argv, "-a");
    if (command === "find-generic-password") {
      const value = items.get(account);
      if (value === undefined) return reply(request, 44, "");
      return reply(request, 0, argv.includes("-w") ? `${value}\n` : "");
    }
    if (command === "delete-generic-password") {
      return reply(request, items.delete(account) ? 0 : 44, "");
    }
    if (command === "-i") {
      const line = ADD_LINE.exec(texts[texts.length - 1] ?? "");
      const target = line?.[3];
      const secret = line?.[5];
      // -U가 없으면 있는 항목을 바꾸지 않는다(중복 항목 오류를 흉내 낸다)
      const replaces = line?.[1] !== undefined;
      const writable = target !== undefined && (replaces || !items.has(target));
      if (
        target !== undefined &&
        secret !== undefined &&
        writable &&
        options.swallowWrite !== true
      ) {
        items.set(target, secret);
      }
      return reply(request, 0, "");
    }
    return reply(request, 2, "");
  }

  function secretService(request: RunRequest): RunReply {
    const argv = request.argv;
    const command = argv[1];
    const account = argAfter(argv, "account");
    if (command === "lookup") {
      const value = items.get(account);
      if (value === undefined) return reply(request, 1, "");
      return reply(request, 0, value);
    }
    if (command === "store") {
      if (options.swallowWrite !== true) items.set(account, texts[texts.length - 1] ?? "");
      return reply(request, 0, "");
    }
    if (command === "clear") {
      items.delete(account);
      return reply(request, 0, "");
    }
    return reply(request, 2, "");
  }

  const runner: ProcessRunner = (request) => {
    requests.push(request);
    if (request.stdin !== undefined) {
      stdins.push(request.stdin);
      texts.push(decode(request.stdin));
    }
    if (options.failure !== undefined) return Promise.resolve(runFailure(options.failure));
    if (options.exit !== undefined) return reply(request, options.exit, "");
    return platform === "darwin" ? keychain(request) : secretService(request);
  };
  return { runner, requests, stdins, texts, outputs, items };
}

function vaultFor(platform: Platform, fake: FakeStore): TokenVault {
  return createTokenVault({
    platform,
    securityPath: SECURITY,
    secretToolPath: SECRET_TOOL,
    runner: fake.runner,
    env: ENV,
    signal: SIGNAL,
  });
}

/** 실패 결과의 오류 값. 성공이면 undefined */
function errorOf(result: Result<unknown, VaultError>): VaultError | undefined {
  return result.ok ? undefined : result.error;
}

/** 버퍼 목록이 비어 있지 않고 모두 0인가 */
function zeroed(buffers: readonly Uint8Array[]): boolean {
  return buffers.length > 0 && buffers.every(allZero);
}

describe("token vault on macOS Keychain", () => {
  test("get reads the item with -w and drops one trailing newline", async () => {
    const fake = fakeStore("darwin", { seed: { [ACCOUNT]: TOKEN } });
    expect(await vaultFor("darwin", fake).get(ACCOUNT)).toEqual({ ok: true, value: TOKEN });
    expect(fake.requests.map((r) => r.argv)).toEqual([
      [SECURITY, "find-generic-password", "-s", VAULT_SERVICE, "-a", ACCOUNT, "-w"],
    ]);
  });

  test("get zero-fills the stdout bytes it read", async () => {
    const fake = fakeStore("darwin", { seed: { [ACCOUNT]: TOKEN } });
    await vaultFor("darwin", fake).get(ACCOUNT);
    expect(fake.outputs).toHaveLength(1);
    expect(zeroed(fake.outputs)).toBe(true);
  });

  test("get maps exit 44 to not_found, and an empty item to not_found as well", async () => {
    const missing = await vaultFor("darwin", fakeStore("darwin")).get(ACCOUNT);
    expect(errorOf(missing)).toEqual(NOT_FOUND_ERROR);
    const empty = fakeStore("darwin", { seed: { [ACCOUNT]: "" } });
    expect(errorOf(await vaultFor("darwin", empty).get(ACCOUNT))).toEqual(NOT_FOUND_ERROR);
  });

  test("get maps other exit codes to find_failed", async () => {
    const fake = fakeStore("darwin", { exit: 36 });
    expect(errorOf(await vaultFor("darwin", fake).get(ACCOUNT))).toEqual({
      kind: "failed",
      code: "find_failed",
    });
  });

  test("set sends one add line on stdin with -U, then checks the item without -w", async () => {
    const fake = fakeStore("darwin");
    expect(await vaultFor("darwin", fake).set(ACCOUNT, TOKEN)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(fake.requests.map((r) => r.argv)).toEqual([
      [SECURITY, "-i"],
      [SECURITY, "find-generic-password", "-s", VAULT_SERVICE, "-a", ACCOUNT],
    ]);
    expect(fake.texts).toEqual([
      `add-generic-password -U -s ${VAULT_SERVICE} -a ${ACCOUNT} -l "fresnel remote device" -w ${TOKEN}\n`,
    ]);
  });

  test("remove runs delete-generic-password with the exact argv, and a missing item is ok", async () => {
    const fake = fakeStore("darwin", { seed: { [ACCOUNT]: TOKEN } });
    const vault = vaultFor("darwin", fake);
    expect(await vault.remove(ACCOUNT)).toEqual({ ok: true, value: undefined });
    expect(fake.requests.map((r) => r.argv)).toEqual([
      [SECURITY, "delete-generic-password", "-s", VAULT_SERVICE, "-a", ACCOUNT],
    ]);
    expect(await vault.remove(ACCOUNT)).toEqual({ ok: true, value: undefined });
    expect(errorOf(await vault.get(ACCOUNT))).toEqual(NOT_FOUND_ERROR);
  });

  test("remove maps other exit codes to delete_failed", async () => {
    const fake = fakeStore("darwin", { exit: 36 });
    expect(errorOf(await vaultFor("darwin", fake).remove(ACCOUNT))).toEqual({
      kind: "failed",
      code: "delete_failed",
    });
  });
});

describe("token vault on Linux Secret Service", () => {
  test("get runs lookup with the output kept, returns the value, and zero-fills the output", async () => {
    const fake = fakeStore("linux", { seed: { [ACCOUNT]: TOKEN } });
    expect(await vaultFor("linux", fake).get(ACCOUNT)).toEqual({ ok: true, value: TOKEN });
    expect(fake.requests.map((r) => r.argv)).toEqual([
      [SECRET_TOOL, "lookup", "service", VAULT_SERVICE, "account", ACCOUNT],
    ]);
    expect(fake.requests[0]?.discardStdout).toBeUndefined();
    expect(zeroed(fake.outputs)).toBe(true);
  });

  test("get maps exit 1 and an empty secret to not_found, and other exit codes to lookup_failed", async () => {
    expect(errorOf(await vaultFor("linux", fakeStore("linux")).get(ACCOUNT))).toEqual(
      NOT_FOUND_ERROR,
    );
    const empty = fakeStore("linux", { seed: { [ACCOUNT]: "" } });
    expect(errorOf(await vaultFor("linux", empty).get(ACCOUNT))).toEqual(NOT_FOUND_ERROR);
    const broken = fakeStore("linux", { exit: 2 });
    expect(errorOf(await vaultFor("linux", broken).get(ACCOUNT))).toEqual({
      kind: "failed",
      code: "lookup_failed",
    });
  });

  test("set sends the value only on stdin, with the label in argv, then checks with a discarded lookup", async () => {
    const fake = fakeStore("linux");
    expect(await vaultFor("linux", fake).set(ACCOUNT, TOKEN)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(fake.requests.map((r) => r.argv)).toEqual([
      [
        SECRET_TOOL,
        "store",
        "--label=fresnel remote device",
        "service",
        VAULT_SERVICE,
        "account",
        ACCOUNT,
      ],
      [SECRET_TOOL, "lookup", "service", VAULT_SERVICE, "account", ACCOUNT],
    ]);
    expect(fake.texts).toEqual([TOKEN]);
    expect(fake.requests[1]?.discardStdout).toBe(true);
  });

  test("set reports store_failed when the store exits non-zero", async () => {
    const fake = fakeStore("linux", { exit: 1 });
    expect(errorOf(await vaultFor("linux", fake).set(ACCOUNT, TOKEN))).toEqual({
      kind: "failed",
      code: "store_failed",
    });
  });

  test("remove runs clear with the exact argv, and a missing item is ok", async () => {
    const fake = fakeStore("linux", { seed: { [ACCOUNT]: TOKEN } });
    const vault = vaultFor("linux", fake);
    expect(await vault.remove(ACCOUNT)).toEqual({ ok: true, value: undefined });
    expect(fake.requests.map((r) => r.argv)).toEqual([
      [SECRET_TOOL, "clear", "service", VAULT_SERVICE, "account", ACCOUNT],
    ]);
    expect(await vault.remove(ACCOUNT)).toEqual({ ok: true, value: undefined });
  });

  test("remove maps a non-zero clear exit to clear_failed", async () => {
    const fake = fakeStore("linux", { exit: 5 });
    expect(errorOf(await vaultFor("linux", fake).remove(ACCOUNT))).toEqual({
      kind: "failed",
      code: "clear_failed",
    });
  });
});

describe("token vault on both platforms", () => {
  test.each(PLATFORMS)(
    "%s: the token is on stdin only, never in any argv element",
    async (platform) => {
      const fake = fakeStore(platform);
      await vaultFor(platform, fake).set(ACCOUNT, TOKEN);
      expect(fake.requests.some((r) => r.argv.some((arg) => arg.includes(TOKEN)))).toBe(false);
      expect(fake.texts.some((text) => text.includes(TOKEN))).toBe(true);
    },
  );

  test.each(PLATFORMS)("%s: the stdin buffer is zero-filled once set returns", async (platform) => {
    const fake = fakeStore(platform);
    await vaultFor(platform, fake).set(ACCOUNT, TOKEN);
    expect(fake.stdins).toHaveLength(1);
    expect(zeroed(fake.stdins)).toBe(true);
  });

  test.each(PLATFORMS)(
    "%s: set overwrites an existing item and get returns the new value",
    async (platform) => {
      const fake = fakeStore(platform, { seed: { [ACCOUNT]: OLD_TOKEN } });
      const vault = vaultFor(platform, fake);
      expect(await vault.set(ACCOUNT, TOKEN)).toEqual({ ok: true, value: undefined });
      expect(await vault.get(ACCOUNT)).toEqual({ ok: true, value: TOKEN });
    },
  );

  test.each(PLATFORMS)(
    "%s: a write that does not take effect is add_failed, and the token stays out of the error",
    async (platform) => {
      const fake = fakeStore(platform, { swallowWrite: true });
      const result = await vaultFor(platform, fake).set(ACCOUNT, TOKEN);
      expect(errorOf(result)).toEqual({ kind: "failed", code: "add_failed" });
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    },
  );

  test.each(PLATFORMS)("%s: a cancelled run maps to cancelled for every call", async (platform) => {
    const vault = vaultFor(platform, fakeStore(platform, { failure: "cancelled" }));
    expect(errorOf(await vault.get(ACCOUNT))).toEqual({ kind: "cancelled" });
    expect(errorOf(await vault.set(ACCOUNT, TOKEN))).toEqual({ kind: "cancelled" });
    expect(errorOf(await vault.remove(ACCOUNT))).toEqual({ kind: "cancelled" });
  });

  test.each(PLATFORMS)(
    "%s: a spawn failure maps to failed with the spawn code",
    async (platform) => {
      const vault = vaultFor(platform, fakeStore(platform, { failure: "spawn_failed" }));
      expect(errorOf(await vault.get(ACCOUNT))).toEqual({ kind: "failed", code: "ENOENT" });
      expect(errorOf(await vault.remove(ACCOUNT))).toEqual({ kind: "failed", code: "ENOENT" });
    },
  );

  test.each(PLATFORMS)("%s: round trip through an in-memory store", async (platform) => {
    const fake = fakeStore(platform);
    const vault = vaultFor(platform, fake);
    expect(errorOf(await vault.get(ACCOUNT))).toEqual(NOT_FOUND_ERROR);
    expect(await vault.set(ACCOUNT, OLD_TOKEN)).toEqual({ ok: true, value: undefined });
    expect(await vault.set(ACCOUNT, TOKEN)).toEqual({ ok: true, value: undefined });
    expect(await vault.get(ACCOUNT)).toEqual({ ok: true, value: TOKEN });
    expect(await vault.remove(ACCOUNT)).toEqual({ ok: true, value: undefined });
    expect(errorOf(await vault.get(ACCOUNT))).toEqual(NOT_FOUND_ERROR);
    expect(fake.items.has(ACCOUNT)).toBe(false);
  });

  test.each(PLATFORMS)("%s: accepts a bracketed host:port account", async (platform) => {
    const vault = vaultFor(platform, fakeStore(platform));
    expect(await vault.set(BRACKETED_ACCOUNT, TOKEN)).toEqual({ ok: true, value: undefined });
    expect(await vault.get(BRACKETED_ACCOUNT)).toEqual({ ok: true, value: TOKEN });
  });

  test.each(PLATFORMS)(
    "%s: a bad account is rejected for every call before any runner call",
    async (platform) => {
      const fake = fakeStore(platform);
      const vault = vaultFor(platform, fake);
      const results = await Promise.all(
        BAD_ACCOUNTS.flatMap((account) => [
          vault.get(account),
          vault.set(account, TOKEN),
          vault.remove(account),
        ]),
      );
      expect(results.map((result) => errorOf(result))).toEqual(
        BAD_ACCOUNTS.flatMap(() => [BAD_ACCOUNT_ERROR, BAD_ACCOUNT_ERROR, BAD_ACCOUNT_ERROR]),
      );
      expect(fake.requests).toHaveLength(0);
    },
  );

  test.each(PLATFORMS)("%s: a bad value is rejected before any runner call", async (platform) => {
    const fake = fakeStore(platform);
    const vault = vaultFor(platform, fake);
    const results = await Promise.all(BAD_VALUES.map((value) => vault.set(ACCOUNT, value)));
    expect(results.map((result) => errorOf(result))).toEqual(BAD_VALUES.map(() => BAD_VALUE_ERROR));
    expect(fake.requests).toHaveLength(0);
  });

  test.each(PLATFORMS)(
    "%s: the 8 and 512 character value bounds are accepted",
    async (platform) => {
      const vault = vaultFor(platform, fakeStore(platform));
      expect(await vault.set(ACCOUNT, "abcdefgh")).toEqual({ ok: true, value: undefined });
      expect(await vault.set(ACCOUNT, "x".repeat(512))).toEqual({ ok: true, value: undefined });
    },
  );

  test.each(PLATFORMS)("%s: every call carries the given env and signal", async (platform) => {
    const fake = fakeStore(platform);
    await vaultFor(platform, fake).get(ACCOUNT);
    expect(fake.requests.map((r) => r.env)).toEqual([ENV]);
    expect(fake.requests[0]?.signal).toBe(SIGNAL);
  });
});

describe("token vault without a usable keystore", () => {
  test("platform other is unavailable for every call and never runs the runner", async () => {
    const fake = fakeStore("darwin");
    const vault = createTokenVault({
      platform: "other",
      securityPath: SECURITY,
      secretToolPath: SECRET_TOOL,
      runner: fake.runner,
      env: ENV,
      signal: SIGNAL,
    });
    expect(errorOf(await vault.get(ACCOUNT))).toEqual({ kind: "unavailable" });
    expect(errorOf(await vault.set(ACCOUNT, TOKEN))).toEqual({ kind: "unavailable" });
    expect(errorOf(await vault.remove(ACCOUNT))).toEqual({ kind: "unavailable" });
    expect(fake.requests).toHaveLength(0);
  });

  test("darwin without a security path is unavailable and runs nothing", async () => {
    const fake = fakeStore("darwin");
    const vault = createTokenVault({
      platform: "darwin",
      securityPath: null,
      secretToolPath: SECRET_TOOL,
      runner: fake.runner,
      env: ENV,
      signal: SIGNAL,
    });
    expect(errorOf(await vault.get(ACCOUNT))).toEqual({ kind: "unavailable" });
    expect(fake.requests).toHaveLength(0);
  });

  test("linux without a secret-tool path is unavailable and runs nothing", async () => {
    const fake = fakeStore("linux");
    const vault = createTokenVault({
      platform: "linux",
      securityPath: SECURITY,
      secretToolPath: null,
      runner: fake.runner,
      env: ENV,
      signal: SIGNAL,
    });
    expect(errorOf(await vault.set(ACCOUNT, TOKEN))).toEqual({ kind: "unavailable" });
    expect(fake.requests).toHaveLength(0);
  });
});
