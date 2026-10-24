import { afterEach, describe, expect, test } from "bun:test";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { createFileKeyProvider } from "../src/key/file-fallback.ts";
import { tempDir, type TempDir } from "./support/os.ts";

// plan SC-13, SEC.5: age-encryption으로 identity를 만들어 0600 키 파일로 쓴다. 파일 내용(개인 키)은 출력하지 않는다.

const dirs: TempDir[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => dir.remove()));
});

async function workdir(): Promise<TempDir> {
  const dir = await tempDir();
  dirs.push(dir);
  return dir;
}

describe("file fallback provision (spec §4.7)", () => {
  test("creates a 0600 key file in a private directory and returns only the recipient", async () => {
    const dir = await workdir();
    const path = dir.join("secrets", "age", "keys.txt");
    const provider = createFileKeyProvider({ path, uid: null });
    expect(await provider.probe()).toEqual({ available: false, reason: "item_missing" });

    const provisioned = await provider.provision?.();
    expect(provisioned?.ok).toBe(true);
    if (provisioned === undefined || !provisioned.ok) return;
    const recipient = provisioned.value.recipient;
    expect(recipient.startsWith("age1")).toBe(true);
    expect(Object.keys(provisioned.value)).toEqual(["recipient"]);

    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(dir.join("secrets", "age"))).mode & 0o077).toBe(0);
    const body = await readFile(path, "utf8");
    expect(body.includes(`# public key: ${recipient}`)).toBe(true);
    expect(/^AGE-SECRET-KEY-1[A-Z0-9]+$/m.test(body)).toBe(true);
    // 개인 키는 반환값에 없다
    const identity = body.split("\n").find((line) => line.startsWith("AGE-SECRET-KEY-"));
    expect(identity !== undefined && JSON.stringify(provisioned).includes(identity)).toBe(false);

    expect(await provider.probe()).toEqual({ available: true, reason: "ok" });
    expect(provider.sopsKeyEnv()).toEqual({ ok: true, value: { SOPS_AGE_KEY_FILE: path } });
  });

  test("never overwrites an existing key file and leaves it untouched", async () => {
    const dir = await workdir();
    const path = dir.join("keys.txt");
    await writeFile(path, "existing key file marker\n", { mode: 0o600 });
    await chmod(path, 0o600);
    const provider = createFileKeyProvider({ path, uid: null });
    const result = await provider.provision?.();
    expect(result).toEqual({
      ok: false,
      error: { kind: "write_failed", target: "key_file", path, code: "EEXIST" },
    });
    expect(await readFile(path, "utf8")).toBe("existing key file marker\n");
  });

  test("a write failure keeps the OS code and leaves no key file", async () => {
    const dir = await workdir();
    // 부모 자리에 일반 파일을 둬서 디렉터리를 만들 수 없게 한다
    await writeFile(dir.join("blocker"), "not a directory");
    const path = dir.join("blocker", "keys.txt");
    const result = await createFileKeyProvider({ path, uid: null }).provision?.();
    // 부모가 일반 파일일 때 runtime마다 ENOTDIR이나 EEXIST를 준다. 코드 이름이 그대로 실리는지만 본다
    expect(result?.ok).toBe(false);
    if (result === undefined || result.ok) return;
    expect(result.error).toMatchObject({ kind: "write_failed", target: "key_file", path });
    expect(result.error.kind === "write_failed" ? result.error.code : "").toMatch(/^E[A-Z]+$/);
    expect((await stat(dir.join("blocker"))).isFile()).toBe(true);
  });

  test("two provisions create different identities", async () => {
    const dir = await workdir();
    const first = await createFileKeyProvider({ path: dir.join("a.txt"), uid: null }).provision?.();
    const second = await createFileKeyProvider({
      path: dir.join("b.txt"),
      uid: null,
    }).provision?.();
    expect(first?.ok && second?.ok && first.value.recipient !== second.value.recipient).toBe(true);
  });
});
