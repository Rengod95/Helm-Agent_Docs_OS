import { afterEach, describe, expect, test } from "bun:test";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { err, ok } from "@fresnel/contracts";
import type { SecretError } from "@fresnel/contracts/services";
import { createDarwinKeyProvider, type DarwinKeyExec } from "../src/key/darwin.ts";
import { createFileKeyProvider } from "../src/key/file-fallback.ts";
import { createLinuxKeyProvider, type LinuxKeyExec } from "../src/key/linux.ts";
import type { ProcessRunner } from "../src/providers/process.ts";
import { createWin32KeyProvider } from "../src/key/win32.ts";
import { fakeKeychain, type FakeKeychain } from "./support/keychain.ts";
import { tempDir, type TempDir } from "./support/os.ts";
import { allZero } from "./support/value-source.ts";

// L0.secrets.spec §4.7 1번의 예외. KeyProvider의 readIdentity, storeIdentity, removeKey를 가짜 저장소로 시험한다.
// 실제 키체인과 Secret Service는 건드리지 않는다. 값은 시험이 만든 가짜이고 비교만 한다. 출력하지 않는다.

const SECURITY = "/usr/bin/security";
const SECRET_TOOL = "/usr/bin/secret-tool";

const dirs: TempDir[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => dir.remove()));
});

async function workdir(): Promise<TempDir> {
  const dir = await tempDir();
  dirs.push(dir);
  return dir;
}

async function freshIdentity(): Promise<{ readonly identity: string; readonly recipient: string }> {
  const identity = await generateIdentity();
  return { identity, recipient: await identityToRecipient(identity) };
}

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function darwinWith(keychain: FakeKeychain) {
  const exec: DarwinKeyExec = {
    runner: keychain.runner,
    env: { PATH: "/usr/bin" },
    signal: new AbortController().signal,
  };
  return createDarwinKeyProvider({ securityPath: SECURITY, exec });
}

function linuxWith(keychain: FakeKeychain) {
  const exec: LinuxKeyExec = {
    runner: keychain.runner,
    env: { PATH: "/usr/bin", DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus" },
    signal: new AbortController().signal,
  };
  return createLinuxKeyProvider({
    secretToolPath: SECRET_TOOL,
    isWsl: false,
    env: exec.env,
    pathExists: () => false,
    exec,
  });
}

/** 승인 대화상자에서 거절되면 security는 0이 아닌 종료 코드만 남긴다 */
const denyingRunner: ProcessRunner = () =>
  Promise.resolve(ok({ exitCode: 128, stdout: new Uint8Array(), stderr: "" }));

const leaksIn = (keychain: FakeKeychain, identity: string): boolean =>
  keychain.requests.some((r) => r.argv.some((arg) => arg.includes(identity)));

describe("file key identity (spec §4.7 1번 예외)", () => {
  test("reads back the identity that provision wrote, matching the recorded recipient", async () => {
    const dir = await workdir();
    const path = dir.join("secrets", "age", "keys.txt");
    const provider = createFileKeyProvider({ path, uid: null });
    const provisioned = await provider.provision?.();
    expect(provisioned?.ok).toBe(true);
    if (provisioned === undefined || !provisioned.ok) return;

    const read = await provider.readIdentity?.();
    expect(read?.ok).toBe(true);
    if (read === undefined || !read.ok) return;
    const identity = textOf(read.value);
    expect(identity.startsWith("AGE-SECRET-KEY-1")).toBe(true);
    expect(await identityToRecipient(identity)).toBe(provisioned.value.recipient);
    // 호출자가 쓴 뒤 덮는다. 시험도 같은 방식으로 덮어 남은 값이 없는지 본다
    read.value.fill(0);
    expect(allZero(read.value)).toBe(true);
  });

  test("stores an identity once at 0600 and refuses to overwrite it, leaving the caller's buffer intact", async () => {
    const dir = await workdir();
    const path = dir.join("keys.txt");
    const provider = createFileKeyProvider({ path, uid: null });
    const first = await freshIdentity();
    const buffer = bytesOf(first.identity);

    expect(await provider.storeIdentity?.(buffer)).toEqual({ ok: true, value: undefined });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const body = await readFile(path, "utf8");
    expect(body.includes(`# public key: ${first.recipient}`)).toBe(true);
    // 제공자는 호출자의 버퍼를 덮지 않는다(복사본만 덮는다)
    expect(allZero(buffer)).toBe(false);

    const second = await freshIdentity();
    const again = await provider.storeIdentity?.(bytesOf(second.identity));
    expect(again).toEqual({
      ok: false,
      error: { kind: "write_failed", target: "key_file", path, code: "EEXIST" },
    });
    expect(await readFile(path, "utf8")).toBe(body);
  });

  test("refuses to read a file whose mode is not exactly 0600 and does not open its content", async () => {
    const dir = await workdir();
    const path = dir.join("keys.txt");
    const provider = createFileKeyProvider({ path, uid: null });
    await provider.provision?.();
    await chmod(path, 0o644);
    expect(await provider.readIdentity?.()).toEqual({
      ok: false,
      error: { kind: "key_unavailable", key: "file", reason: "file_mode" },
    });
  });

  test("a missing file reads as item_missing; a file without an identity line also reads as item_missing", async () => {
    const dir = await workdir();
    const path = dir.join("keys.txt");
    const provider = createFileKeyProvider({ path, uid: null });
    expect(await provider.readIdentity?.()).toEqual({
      ok: false,
      error: { kind: "key_unavailable", key: "file", reason: "item_missing" },
    });
    await writeFile(path, "# only a comment line\n", { mode: 0o600 });
    await chmod(path, 0o600);
    expect(await provider.readIdentity?.()).toEqual({
      ok: false,
      error: { kind: "key_unavailable", key: "file", reason: "item_missing" },
    });
  });

  test("removeKey deletes the file and is idempotent", async () => {
    const dir = await workdir();
    const path = dir.join("keys.txt");
    const provider = createFileKeyProvider({ path, uid: null });
    await provider.provision?.();
    expect(await provider.removeKey?.()).toEqual({ ok: true, value: undefined });
    expect(
      await stat(path).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect(await provider.removeKey?.()).toEqual({ ok: true, value: undefined });
  });
});

describe("macOS Keychain identity (spec §4.7 1번 예외)", () => {
  test("readIdentity reads the password with -w and the identity never appears in argv", async () => {
    const { identity } = await freshIdentity();
    const keychain = fakeKeychain({ existing: identity });
    const read = await darwinWith(keychain).readIdentity?.();
    expect(read?.ok).toBe(true);
    if (read === undefined || !read.ok) return;
    expect(textOf(read.value)).toBe(identity);
    const lookup = keychain.requests.find((r) => r.argv.includes("-w"));
    expect(lookup?.argv).toEqual([
      SECURITY,
      "find-generic-password",
      "-s",
      "fresnel.age",
      "-a",
      "default",
      "-w",
    ]);
    expect(leaksIn(keychain, identity)).toBe(false);
  });

  test("an absent item is item_missing and a denied read is access_denied", async () => {
    const empty = fakeKeychain();
    expect(await darwinWith(empty).readIdentity?.()).toEqual({
      ok: false,
      error: { kind: "key_unavailable", key: "darwin-keychain", reason: "item_missing" },
    });
    const provider = createDarwinKeyProvider({
      securityPath: SECURITY,
      exec: { runner: denyingRunner, env: {}, signal: new AbortController().signal },
    });
    expect(await provider.readIdentity?.()).toEqual({
      ok: false,
      error: { kind: "key_unavailable", key: "darwin-keychain", reason: "access_denied" },
    });
  });

  test("storeIdentity adds through security -i with the identity on stdin only, and refuses to replace", async () => {
    const first = await freshIdentity();
    const keychain = fakeKeychain();
    const provider = darwinWith(keychain);
    const buffer = bytesOf(first.identity);

    expect(await provider.storeIdentity?.(buffer)).toEqual({ ok: true, value: undefined });
    expect(keychain.stored()).toBe(first.identity);
    expect(leaksIn(keychain, first.identity)).toBe(false);
    // 제공자가 만든 stdin 버퍼는 쓴 뒤 0으로 덮인다. 호출자의 버퍼는 그대로다
    expect(keychain.stdins().every(allZero)).toBe(true);
    expect(allZero(buffer)).toBe(false);

    const second = await freshIdentity();
    expect(await provider.storeIdentity?.(bytesOf(second.identity))).toEqual({
      ok: false,
      error: { kind: "write_failed", target: "key_store", path: "keychain", code: "EEXIST" },
    });
    expect(keychain.stored()).toBe(first.identity);
  });

  test("a failed add reports the OS code and the error never carries the identity", async () => {
    const { identity } = await freshIdentity();
    const keychain = fakeKeychain({ failAdd: true });
    const result = await darwinWith(keychain).storeIdentity?.(bytesOf(identity));
    expect(result).toEqual({
      ok: false,
      error: { kind: "write_failed", target: "key_store", path: "keychain", code: "EPERM" },
    });
    expect(JSON.stringify(result).includes(identity)).toBe(false);
    expect(keychain.stored()).toBeNull();
  });

  test("removeKey deletes the item, counts an absent item as removed, and reports a failed delete", async () => {
    const { identity } = await freshIdentity();
    const keychain = fakeKeychain({ existing: identity });
    const provider = darwinWith(keychain);
    expect(await provider.removeKey?.()).toEqual({ ok: true, value: undefined });
    expect(keychain.stored()).toBeNull();
    expect(await provider.removeKey?.()).toEqual({ ok: true, value: undefined });

    const stuck = fakeKeychain({ existing: identity, failDelete: true });
    expect(await darwinWith(stuck).removeKey?.()).toEqual({
      ok: false,
      error: { kind: "write_failed", target: "key_store", path: "keychain", code: "delete_failed" },
    });
    expect(stuck.stored()).toBe(identity);
  });
});

describe("Linux Secret Service identity (spec §4.7 1번 예외)", () => {
  test("readIdentity reads the lookup output; an absent item is item_missing", async () => {
    const { identity } = await freshIdentity();
    const keychain = fakeKeychain({ existing: identity });
    const read = await linuxWith(keychain).readIdentity?.();
    expect(read?.ok).toBe(true);
    if (read === undefined || !read.ok) return;
    expect(textOf(read.value)).toBe(identity);
    expect(leaksIn(keychain, identity)).toBe(false);
    expect(await linuxWith(fakeKeychain()).readIdentity?.()).toEqual({
      ok: false,
      error: { kind: "key_unavailable", key: "linux-secret-service", reason: "item_missing" },
    });
  });

  test("storeIdentity sends the identity on stdin only, refuses to replace, and checks the item afterwards", async () => {
    const first = await freshIdentity();
    const keychain = fakeKeychain();
    const provider = linuxWith(keychain);
    expect(await provider.storeIdentity?.(bytesOf(first.identity))).toEqual({
      ok: true,
      value: undefined,
    });
    expect(keychain.stored()).toBe(first.identity);
    expect(leaksIn(keychain, first.identity)).toBe(false);
    expect(keychain.stdins().every(allZero)).toBe(true);

    const second = await freshIdentity();
    expect(await provider.storeIdentity?.(bytesOf(second.identity))).toEqual({
      ok: false,
      error: { kind: "write_failed", target: "key_store", path: "secret-service", code: "EEXIST" },
    });
    expect(keychain.stored()).toBe(first.identity);
  });

  test("a failed store reports the OS code without the identity", async () => {
    const { identity } = await freshIdentity();
    const keychain = fakeKeychain({ failAdd: true });
    const result = await linuxWith(keychain).storeIdentity?.(bytesOf(identity));
    expect(result).toEqual({
      ok: false,
      error: { kind: "write_failed", target: "key_store", path: "secret-service", code: "EPERM" },
    });
    expect(JSON.stringify(result).includes(identity)).toBe(false);
  });

  test("removeKey succeeds only when clear exits 0 and the item is gone", async () => {
    const { identity } = await freshIdentity();
    const keychain = fakeKeychain({ existing: identity });
    expect(await linuxWith(keychain).removeKey?.()).toEqual({ ok: true, value: undefined });
    expect(keychain.stored()).toBeNull();

    const stuck = fakeKeychain({ existing: identity, failDelete: true });
    expect(await linuxWith(stuck).removeKey?.()).toEqual({
      ok: false,
      error: {
        kind: "write_failed",
        target: "key_store",
        path: "secret-service",
        code: "clear_failed",
      },
    });
    expect(stuck.stored()).toBe(identity);
  });
});

describe("Windows key identity stub", () => {
  test("every identity method refuses with the same unsupported error", async () => {
    const provider = createWin32KeyProvider();
    const refusal: SecretError = {
      kind: "key_unavailable",
      key: "win32-credential",
      reason: "no_secret_service",
    };
    expect(await provider.readIdentity?.()).toEqual(err(refusal));
    expect(await provider.storeIdentity?.(bytesOf("AGE-SECRET-KEY-1FAKE"))).toEqual(err(refusal));
    expect(await provider.removeKey?.()).toEqual(err(refusal));
  });
});
