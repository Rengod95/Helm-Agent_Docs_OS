import { describe, expect, test } from "bun:test";
import { identityToRecipient } from "age-encryption";
import { err, ok } from "@xeon/contracts";
import { createDarwinKeyProvider, type DarwinKeyExec } from "../src/key/darwin.ts";
import type { ProcessRunner, RunRequest } from "../src/providers/process.ts";
import { selectKeyProvider } from "../src/select.ts";
import { allZero } from "./support/value-source.ts";

// spec §4.7 7번. macOS Keychain provision: 항목이 없을 때만 만들고, identity는 argv에 올리지 않고 `security -i`의 stdin으로만 보낸다.
// 실제 키체인은 건드리지 않는다. 가짜 `security`가 항목 하나를 메모리에 둔다. 실기 확인은 macOS M-12 재실행이다.

const SECURITY = "/usr/bin/security";

interface FakeSecurity {
  readonly runner: ProcessRunner;
  readonly requests: RunRequest[];
  /** 가짜 키체인에 저장된 identity(시험이 만든 값). 없으면 null */
  stored(): string | null;
  /** 이 요청의 stdin 버퍼. 호출이 끝나면 0으로 덮인다 */
  stdins(): Uint8Array[];
  /** 호출 시점에 읽은 stdin 명령 줄 */
  commands(): string[];
}

const done = (exitCode: number) =>
  Promise.resolve(ok({ exitCode, stdout: new Uint8Array(), stderr: "" }));

function fakeSecurity(
  options: {
    readonly existing?: string;
    readonly swallowAdd?: boolean;
    readonly findExit?: number;
  } = {},
): FakeSecurity {
  let item: string | null = options.existing ?? null;
  const requests: RunRequest[] = [];
  const stdins: Uint8Array[] = [];
  const commands: string[] = [];
  const runner: ProcessRunner = (request) => {
    requests.push(request);
    if (request.argv[1] === "find-generic-password") {
      if (options.findExit !== undefined) return done(options.findExit);
      return done(item === null ? 44 : 0);
    }
    if (request.argv[1] === "-i" && request.stdin !== undefined) {
      stdins.push(request.stdin);
      const line = new TextDecoder().decode(request.stdin);
      commands.push(line);
      const identity = /-w (AGE-SECRET-KEY-1[A-Z0-9]+)\n$/.exec(line)?.[1];
      if (identity !== undefined && options.swallowAdd !== true) item = identity;
      return done(0);
    }
    return done(2);
  };
  return { runner, requests, stored: () => item, stdins: () => stdins, commands: () => commands };
}

function exec(runner: ProcessRunner): DarwinKeyExec {
  return { runner, env: { PATH: "/usr/bin" }, signal: new AbortController().signal };
}

describe("macOS key provision", () => {
  test("creates the item once and returns the recipient of the stored identity", async () => {
    const fake = fakeSecurity();
    const provider = createDarwinKeyProvider({ securityPath: SECURITY, exec: exec(fake.runner) });
    const made = await provider.provision?.();
    expect(made?.ok).toBe(true);
    if (made === undefined || !made.ok) return;
    const identity = fake.stored();
    expect(identity?.startsWith("AGE-SECRET-KEY-1")).toBe(true);
    expect(
      identity !== null && (await identityToRecipient(identity)) === made.value.recipient,
    ).toBe(true);
    // 순서: 존재 확인, 만들기, 다시 확인
    expect(fake.requests.map((r) => r.argv.slice(1, 2).join())).toEqual([
      "find-generic-password",
      "-i",
      "find-generic-password",
    ]);
    // 존재 확인에 -w가 없다: 비밀번호 데이터를 읽지 않는다
    expect(fake.requests[0]?.argv).toEqual([
      SECURITY,
      "find-generic-password",
      "-s",
      "xeon.age",
      "-a",
      "default",
    ]);
    // identity는 어떤 argv에도 없고 stdin에만 있다
    expect(fake.requests.some((r) => r.argv.some((arg) => arg.includes("AGE-SECRET-KEY")))).toBe(
      false,
    );
    const line = fake.commands()[0] ?? "";
    expect(line.startsWith("add-generic-password -s xeon.age -a default ")).toBe(true);
    // 보낸 stdin 버퍼는 쓰고 나서 0으로 덮인다
    expect(fake.stdins().every(allZero)).toBe(true);
    expect(Object.keys(made.value)).toEqual(["recipient"]);
  });

  test("never replaces an existing item", async () => {
    const fake = fakeSecurity({ existing: "AGE-SECRET-KEY-1EXISTINGFAKEITEM" });
    const provider = createDarwinKeyProvider({ securityPath: SECURITY, exec: exec(fake.runner) });
    expect(await provider.provision?.()).toEqual({
      ok: false,
      error: { kind: "write_failed", target: "key_store", path: "keychain", code: "EEXIST" },
    });
    expect(fake.requests).toHaveLength(1);
    expect(fake.stored()).toBe("AGE-SECRET-KEY-1EXISTINGFAKEITEM");
  });

  test("reports add_failed when the item is not there after the add", async () => {
    const fake = fakeSecurity({ swallowAdd: true });
    const provider = createDarwinKeyProvider({ securityPath: SECURITY, exec: exec(fake.runner) });
    expect(await provider.provision?.()).toEqual({
      ok: false,
      error: { kind: "write_failed", target: "key_store", path: "keychain", code: "add_failed" },
    });
    expect(fake.stdins().every(allZero)).toBe(true);
  });

  test("does not try to add when the lookup itself fails", async () => {
    const fake = fakeSecurity({ findExit: 36 });
    const provider = createDarwinKeyProvider({ securityPath: SECURITY, exec: exec(fake.runner) });
    expect(await provider.provision?.()).toEqual({
      ok: false,
      error: { kind: "write_failed", target: "key_store", path: "keychain", code: "find_failed" },
    });
    expect(fake.requests).toHaveLength(1);
  });

  test("carries the spawn failure code and maps a cancelled run to cancelled", async () => {
    const spawnFailed = createDarwinKeyProvider({
      securityPath: SECURITY,
      exec: exec(() => Promise.resolve(err({ kind: "spawn_failed" as const, code: "ENOENT" }))),
    });
    expect(await spawnFailed.provision?.()).toEqual({
      ok: false,
      error: { kind: "write_failed", target: "key_store", path: "keychain", code: "ENOENT" },
    });
    const cancelled = createDarwinKeyProvider({
      securityPath: SECURITY,
      exec: exec(() => Promise.resolve(err({ kind: "cancelled" as const }))),
    });
    expect(await cancelled.provision?.()).toEqual({ ok: false, error: { kind: "cancelled" } });
  });

  test("has no provision without a security path or an exec", () => {
    const fake = fakeSecurity();
    expect(
      "provision" in createDarwinKeyProvider({ securityPath: null, exec: exec(fake.runner) }),
    ).toBe(false);
    expect("provision" in createDarwinKeyProvider({ securityPath: SECURITY })).toBe(false);
  });

  test("selection hands the exec to the macOS provider", async () => {
    const fake = fakeSecurity();
    const chosen = await selectKeyProvider({
      source: "auto",
      filePath: "/nonexistent/keys.txt",
      info: { platform: "darwin", isWsl: false },
      userId: 501,
      env: {},
      resolveTool: (name) => Promise.resolve(name === "security" ? SECURITY : null),
      pathExists: () => false,
      exec: exec(fake.runner),
    });
    expect(chosen.provider.id).toBe("darwin-keychain");
    expect("provision" in chosen.provider).toBe(true);
  });
});
