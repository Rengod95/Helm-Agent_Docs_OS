import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { identityToRecipient, generateIdentity } from "age-encryption";
import { err, ok, type Result } from "@fresnel/contracts";
import type { SecretError } from "@fresnel/contracts/services";
import { createSecretsRuntime, type KeyCommit, type SecretsRuntime } from "../src/assemble.ts";
import { DEFAULT_SECRETS_CONFIG, type SecretsConfig } from "../src/config.ts";
import { createFileKeyProvider } from "../src/key/file-fallback.ts";
import { readRecipient, recipientPath, writeRecipient } from "../src/key/recipient.ts";
import { defaultAgeKeyPath } from "../src/protected-paths.ts";
import { manualClock } from "./support/clock.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { fakeKeychain, type FakeKeychain, type FakeKeychainOptions } from "./support/keychain.ts";
import {
  fakeOs,
  recordingLogger,
  tempDir,
  type RecordingLogger,
  type TempDir,
} from "./support/os.ts";

// L0.secrets.spec §4.7 1번 예외와 9번. keys.status와 keys.move를 실제 제공자와 임시 폴더로 시험한다.
// OS 키 저장소는 가짜 저장소(메모리 한 칸)다. 실제 security와 secret-tool은 부르지 않는다. 값은 시험이 만든 가짜다.

const SECURITY = "/usr/bin/security";
const SECRET_TOOL = "/usr/bin/secret-tool";
const USER_ID = process.getuid?.() ?? null;

const dirs: TempDir[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => dir.remove()));
});

async function workdir(): Promise<TempDir> {
  const dir = await tempDir();
  dirs.push(dir);
  return dir;
}

interface Setup {
  readonly runtime: SecretsRuntime;
  readonly keychain: FakeKeychain;
  readonly config: string;
  readonly logger: RecordingLogger;
  readonly keyPath: string;
  readonly dir: TempDir;
}

interface SetupOptions {
  readonly source: SecretsConfig["ageKey"]["source"];
  readonly platform?: "darwin" | "linux";
  /** false면 OS 키 저장소 도구(security, secret-tool)가 없다고 해석한다 */
  readonly tool?: boolean;
  readonly filePath?: string | null;
  readonly keychain?: FakeKeychainOptions;
}

async function setup(options: SetupOptions): Promise<Setup> {
  const dir = await workdir();
  const config = dir.join("config");
  const platform = options.platform ?? "darwin";
  const keychain = fakeKeychain(options.keychain);
  const logger = recordingLogger();
  const tool = options.tool ?? true;
  const binaries =
    platform === "darwin"
      ? { security: [SECURITY, "1"] as const }
      : { "secret-tool": [SECRET_TOOL, "1"] as const };
  const runtime = createSecretsRuntime({
    os: fakeOs({
      config,
      clock: manualClock(),
      platform,
      isWsl: false,
      userId: USER_ID,
      binaries: tool ? binaries : {},
      logger,
    }),
    ids: fixedLocalIds(),
    config: () => ({
      ...DEFAULT_SECRETS_CONFIG,
      ageKey: { source: options.source, filePath: options.filePath ?? null },
    }),
    env: {
      PATH: "/usr/bin:/bin",
      HOME: dir.path,
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    },
    runner: keychain.runner,
  });
  const keyPath = options.filePath ?? defaultAgeKeyPath(config);
  return { runtime, keychain, config, logger, keyPath, dir };
}

/** 파일 쪽 키를 만든다(첫 쓰기와 같은 제공자). 식별자와 수신자를 돌려준다 */
async function provisionFile(
  path: string,
): Promise<{ readonly identity: string; readonly recipient: string }> {
  const provider = createFileKeyProvider({ path, uid: USER_ID });
  const made = await provider.provision?.();
  expect(made?.ok).toBe(true);
  const read = await provider.readIdentity?.();
  expect(read?.ok).toBe(true);
  if (made === undefined || !made.ok || read === undefined || !read.ok) {
    throw new Error("fixture: file key was not provisioned");
  }
  const identity = new TextDecoder().decode(read.value);
  read.value.fill(0);
  return { identity, recipient: made.value.recipient };
}

async function freshIdentity(): Promise<{ readonly identity: string; readonly recipient: string }> {
  const identity = await generateIdentity();
  return { identity, recipient: await identityToRecipient(identity) };
}

/** 옮기기 설정 전환 대역. 호출 횟수와 호출 때 두 곳에 키가 있었는지를 남긴다 */
function recordingCommit(result: Result<void, SecretError> = ok(undefined), probe?: () => boolean) {
  let count = 0;
  let sawBothSides: boolean | null = null;
  const commit: KeyCommit = () => {
    count += 1;
    if (probe !== undefined) sawBothSides = probe();
    return Promise.resolve(result);
  };
  return {
    commit,
    count: () => count,
    sawBothSides: () => sawBothSides,
  };
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

describe("keys.status (spec §4.7 9번, 1번의 예외 밖)", () => {
  test("reports where the key is without reading it, and the filePath it would use", async () => {
    const env = await setup({ source: "file" });
    const made = await provisionFile(env.keyPath);
    const status = await env.runtime.keys.status();
    expect(status).toEqual({
      source: "file",
      in: "file",
      filePath: env.keyPath,
      keychainUsable: true,
      fallbackUnconfirmed: false,
      fileMissing: false,
    });
    expect(JSON.stringify(status).includes(made.identity)).toBe(false);
  });

  test("a configured key file that is missing is fileMissing with in none; a default path with no key is not", async () => {
    const custom = await setup({
      source: "file",
      filePath: "/nonexistent/fresnel-custom/keys.txt",
    });
    expect(await custom.runtime.keys.status()).toEqual({
      source: "file",
      in: "none",
      filePath: "/nonexistent/fresnel-custom/keys.txt",
      keychainUsable: true,
      fallbackUnconfirmed: false,
      fileMissing: true,
    });
    const fresh = await setup({ source: "auto" });
    const status = await fresh.runtime.keys.status();
    expect(status.in).toBe("none");
    expect(status.fileMissing).toBe(false);
  });

  test("a key that is only in the keychain is reported as keychain even when the source names the file", async () => {
    const { identity } = await freshIdentity();
    const env = await setup({ source: "file", keychain: { existing: identity } });
    const status = await env.runtime.keys.status();
    expect(status.in).toBe("keychain");
    expect(status.fileMissing).toBe(false);
  });

  test("auto without an OS key store tool is flagged as an unconfirmed fallback; auto-file is not", async () => {
    const auto = await setup({ source: "auto", platform: "linux", tool: false });
    const autoStatus = await auto.runtime.keys.status();
    expect(autoStatus.keychainUsable).toBe(false);
    expect(autoStatus.fallbackUnconfirmed).toBe(true);
    const diag = await auto.runtime.service.diagnose();
    expect(diag.hints.join("\n")).toContain("fresnel secret key use file");

    const autoFile = await setup({ source: "auto-file", platform: "linux", tool: false });
    expect((await autoFile.runtime.keys.status()).fallbackUnconfirmed).toBe(false);
    const diagFile = await autoFile.runtime.service.diagnose();
    expect(diagFile.hints.join("\n")).not.toContain("fresnel secret key use file");
  });
});

describe("keys.move (spec §4.7 1번의 예외, 9번)", () => {
  test("file to keychain: both sides hold the key during commit, then the file goes, the record is copied, and the identity is the same", async () => {
    const env = await setup({ source: "file" });
    const made = await provisionFile(env.keyPath);
    const copy = recipientPath(env.config, "darwin-keychain");
    // commit 시점에 새 쪽에도 옛 쪽에도 같은 키가 있어야 한다(설정 전환 전에 옛 쪽을 지우지 않는다)
    const seen = recordingCommit(
      ok(undefined),
      () => env.keychain.stored() === made.identity && existsSync(env.keyPath),
    );

    const moved = await env.runtime.keys.move("keychain", seen.commit);
    expect(moved).toEqual({
      ok: true,
      value: { moved: true, created: true, oldRemoved: true },
    });
    expect(seen.count()).toBe(1);
    expect(seen.sawBothSides()).toBe(true);
    expect(env.keychain.stored()).toBe(made.identity);
    expect(await exists(env.keyPath)).toBe(false);
    expect(await readRecipient(copy)).toBe(made.recipient);
    expect((await env.runtime.keys.status()).in).toBe("keychain");
  });

  test("keychain to file: writes a 0600 key file with the same identity, removes the keychain item, and records the recipient under the file id", async () => {
    const { identity, recipient } = await freshIdentity();
    const env = await setup({ source: "keychain", keychain: { existing: identity } });
    const commit = recordingCommit();

    const moved = await env.runtime.keys.move("file", commit.commit);
    expect(moved).toEqual({
      ok: true,
      value: { moved: true, created: true, oldRemoved: true },
    });
    expect(commit.count()).toBe(1);
    expect(env.keychain.stored()).toBeNull();
    expect((await stat(env.keyPath)).mode & 0o777).toBe(0o600);
    const back = await createFileKeyProvider({ path: env.keyPath, uid: USER_ID }).readIdentity?.();
    expect(back?.ok).toBe(true);
    if (back !== undefined && back.ok) {
      expect(new TextDecoder().decode(back.value) === identity).toBe(true);
      back.value.fill(0);
    }
    expect(await readRecipient(recipientPath(env.config, "file"))).toBe(recipient);
  });

  test("with no key anywhere nothing moves and commit is not called", async () => {
    const env = await setup({ source: "auto" });
    const commit = recordingCommit();
    expect(await env.runtime.keys.move("file", commit.commit)).toEqual({
      ok: true,
      value: { moved: false, created: false, oldRemoved: false },
    });
    expect(commit.count()).toBe(0);
    expect(await exists(env.keyPath)).toBe(false);
  });

  test("a key already on the target side is not moved and commit is not called", async () => {
    const env = await setup({ source: "file" });
    await provisionFile(env.keyPath);
    const commit = recordingCommit();
    expect(await env.runtime.keys.move("file", commit.commit)).toEqual({
      ok: true,
      value: { moved: false, created: false, oldRemoved: false },
    });
    expect(commit.count()).toBe(0);
    expect(await exists(env.keyPath)).toBe(true);
  });

  test("an identical key already on the target side is adopted without a second write", async () => {
    const env = await setup({ source: "file" });
    const made = await provisionFile(env.keyPath);
    env.keychain.set(made.identity);
    const commit = recordingCommit();
    expect(await env.runtime.keys.move("keychain", commit.commit)).toEqual({
      ok: true,
      value: { moved: true, created: false, oldRemoved: true },
    });
    expect(env.keychain.stored()).toBe(made.identity);
    expect(await exists(env.keyPath)).toBe(false);
  });

  test("a different key already on the target side is never overwritten", async () => {
    const env = await setup({ source: "file" });
    const made = await provisionFile(env.keyPath);
    const other = await freshIdentity();
    env.keychain.set(other.identity);
    const commit = recordingCommit();
    const result = await env.runtime.keys.move("keychain", commit.commit);
    expect(result).toEqual({
      ok: false,
      error: { kind: "write_failed", target: "key_store", path: "keychain", code: "EEXIST" },
    });
    expect(env.keychain.stored()).toBe(other.identity);
    expect(await exists(env.keyPath)).toBe(true);
    expect(commit.count()).toBe(0);
    expect(JSON.stringify(result).includes(made.identity)).toBe(false);
  });

  test("a failed write on the new side leaves the old side untouched and never calls commit", async () => {
    const env = await setup({ source: "file", keychain: { failAdd: true } });
    const made = await provisionFile(env.keyPath);
    const commit = recordingCommit();
    const result = await env.runtime.keys.move("keychain", commit.commit);
    expect(result).toEqual({
      ok: false,
      error: { kind: "write_failed", target: "key_store", path: "keychain", code: "EPERM" },
    });
    expect(commit.count()).toBe(0);
    expect(env.keychain.stored()).toBeNull();
    expect(await exists(env.keyPath)).toBe(true);
    expect(JSON.stringify(result).includes(made.identity)).toBe(false);
  });

  test("a failed commit rolls the new side back, keeps the old side, and never carries the identity in the error or the log", async () => {
    const env = await setup({ source: "file" });
    const made = await provisionFile(env.keyPath);
    const cancelled: SecretError = { kind: "cancelled" };
    const commit = recordingCommit(err(cancelled));
    const result = await env.runtime.keys.move("keychain", commit.commit);
    expect(result).toEqual({ ok: false, error: { kind: "cancelled" } });
    expect(commit.count()).toBe(1);
    expect(env.keychain.stored()).toBeNull();
    expect(await exists(env.keyPath)).toBe(true);
    expect(await readRecipient(recipientPath(env.config, "darwin-keychain"))).toBeNull();
    expect(JSON.stringify(result).includes(made.identity)).toBe(false);
    expect(JSON.stringify(env.logger.lines).includes(made.identity)).toBe(false);
  });

  test("a recipient that does not match the recorded one is caught before the copy, and the new side is removed", async () => {
    const env = await setup({ source: "file" });
    await provisionFile(env.keyPath);
    const impostor = await freshIdentity();
    await writeRecipient(recipientPath(env.config, "file"), impostor.recipient);
    const commit = recordingCommit();
    expect(await env.runtime.keys.move("keychain", commit.commit)).toEqual({
      ok: false,
      error: {
        kind: "write_failed",
        target: "key_store",
        path: "darwin-keychain",
        code: "recipient_mismatch",
      },
    });
    expect(commit.count()).toBe(0);
    expect(env.keychain.stored()).toBeNull();
    expect(await exists(env.keyPath)).toBe(true);
    expect(await readRecipient(recipientPath(env.config, "darwin-keychain"))).toBeNull();
  });

  test("a failed removal of the old side keeps the new side and reports oldRemoved false", async () => {
    const { identity, recipient } = await freshIdentity();
    const env = await setup({
      source: "keychain",
      keychain: { existing: identity, failDelete: true },
    });
    const commit = recordingCommit();
    expect(await env.runtime.keys.move("file", commit.commit)).toEqual({
      ok: true,
      value: { moved: true, created: true, oldRemoved: false },
    });
    expect(commit.count()).toBe(1);
    expect(env.keychain.stored()).toBe(identity);
    expect(await exists(env.keyPath)).toBe(true);
    expect(await readRecipient(recipientPath(env.config, "file"))).toBe(recipient);
    expect(env.logger.lines.some((line) => line.event === "secrets.key.move.old_kept")).toBe(true);
  });

  test("two moves at once run one after the other: exactly one moves", async () => {
    const env = await setup({ source: "file" });
    await provisionFile(env.keyPath);
    const [first, second] = await Promise.all([
      env.runtime.keys.move("keychain", recordingCommit().commit),
      env.runtime.keys.move("keychain", recordingCommit().commit),
    ]);
    const outcomes = [first, second].map((r) => (r.ok ? r.value.moved : "error"));
    expect(outcomes.filter((moved) => moved === true)).toHaveLength(1);
    expect(outcomes.filter((moved) => moved === false)).toHaveLength(1);
    expect(env.keychain.stored() !== null).toBe(true);
    expect(await exists(env.keyPath)).toBe(false);
  });

  test("an unreadable keychain blocks the move instead of reading as no key", async () => {
    const dir = await workdir();
    const config = dir.join("config");
    const keyPath = defaultAgeKeyPath(config);
    const made = await provisionFile(keyPath);
    // 키 저장소 조회가 실패하는 실행기(종료 코드 2). 없다고 보고 새 키를 만들면 안 된다
    const failing = createSecretsRuntime({
      os: fakeOs({
        config,
        clock: manualClock(),
        platform: "darwin",
        isWsl: false,
        userId: USER_ID,
        binaries: { security: [SECURITY, "1"] },
      }),
      ids: fixedLocalIds(),
      config: () => ({ ...DEFAULT_SECRETS_CONFIG, ageKey: { source: "file", filePath: null } }),
      env: { PATH: "/usr/bin:/bin", HOME: dir.path },
      runner: () => Promise.resolve(ok({ exitCode: 2, stdout: new Uint8Array(), stderr: "" })),
    });
    const commit = recordingCommit();
    const result = await failing.keys.move("keychain", commit.commit);
    expect(result).toEqual({
      ok: false,
      error: { kind: "key_unavailable", key: "darwin-keychain", reason: "locked" },
    });
    expect(commit.count()).toBe(0);
    expect(await exists(keyPath)).toBe(true);
    expect(JSON.stringify(result).includes(made.identity)).toBe(false);
  });
});
