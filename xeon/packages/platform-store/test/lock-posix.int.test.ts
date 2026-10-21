import { readFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createNoneLockProvider } from "../src/lock/none.ts";
import { createPosixLockProvider, type PosixLockProvider } from "../src/lock/posix.ts";
import { createLockProvider, selectPlatformPolicy, toStorePlatform } from "../src/select.ts";
import type { HolderSignal } from "./fixtures/holder.ts";
import { startChild } from "./support/child.ts";
import { currentPlatform } from "./support/store.ts";
import { tempDir } from "./support/tmp.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

function posixProvider(dir: string): PosixLockProvider {
  const selection = selectPlatformPolicy(currentPlatform()).lock;
  if (selection.kind !== "flock") throw new Error("flock is not selected on this platform");
  const created = createPosixLockProvider({
    dir,
    libName: selection.libName,
    errnoSymbol: selection.errno.errnoSymbol,
    wouldBlockErrno: selection.errno.wouldBlockErrno,
  });
  if (!created.ok) throw new Error("flock provider failed to load");
  return created.value;
}

function lockDir(root: string): string {
  const dir = join(root, "locks");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

describe("posix flock provider", () => {
  test("a second acquisition of the same key is held until release", () => {
    const root = own(tempDir());
    const provider = posixProvider(lockDir(root.path));
    const first = provider.tryAcquire("session:a");
    expect(first.ok).toBe(true);
    expect(provider.tryAcquire("session:a")).toEqual({ ok: false, error: { kind: "held" } });
    expect(provider.tryAcquire("session:b").ok).toBe(true);
    if (first.ok) {
      first.value.release();
      first.value.release();
    }
    expect(provider.tryAcquire("session:a").ok).toBe(true);
  });

  test("independent providers still contend through the kernel", () => {
    const root = own(tempDir());
    const dir = lockDir(root.path);
    const one = posixProvider(dir);
    const two = posixProvider(dir);
    const held = one.tryAcquire("service");
    expect(held.ok).toBe(true);
    expect(two.tryAcquire("service")).toEqual({ ok: false, error: { kind: "held" } });
    if (held.ok) held.value.release();
    expect(two.tryAcquire("service").ok).toBe(true);
  });

  test("flock is released on SIGKILL", async () => {
    const root = own(tempDir());
    const dir = lockDir(root.path);
    const provider = posixProvider(dir);
    const holder = startChild(join(import.meta.dir, "fixtures", "holder.ts"), [
      dir,
      "session:kill",
    ]);
    const ready: HolderSignal = "READY";
    expect(await holder.nextLine()).toBe(ready);
    expect(provider.tryAcquire("session:kill")).toEqual({ ok: false, error: { kind: "held" } });
    holder.kill("SIGKILL");
    await holder.exited;
    // 대기 없이 바로 얻는다(OS가 프로세스 종료 때 푼다)
    expect(provider.tryAcquire("session:kill").ok).toBe(true);
  });

  test.skipIf(process.platform !== "linux")("lock fd is close-on-exec", () => {
    const root = own(tempDir());
    const provider = posixProvider(lockDir(root.path));
    const handle = provider.tryAcquire("session:cloexec");
    if (!handle.ok) throw new Error("acquire failed");
    const info = readFileSync(`/proc/self/fdinfo/${handle.value.fd}`, "utf8");
    const flags = /flags:\s*([0-7]+)/.exec(info)?.[1];
    expect(flags).toBeDefined();
    // O_CLOEXEC = 02000000(8진수)
    expect(Number.parseInt(flags ?? "0", 8) & 0o2000000).not.toBe(0);
    handle.value.release();
  });

  test("lock files are never deleted", () => {
    const root = own(tempDir());
    const dir = lockDir(root.path);
    const provider = posixProvider(dir);
    const handle = provider.tryAcquire("session:keep");
    if (!handle.ok) throw new Error("acquire failed");
    handle.value.release();
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{32}\.lock$/);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, files[0] ?? "")).mode & 0o777).toBe(0o600);
  });

  test("a missing lock directory is an io error", () => {
    const root = own(tempDir());
    const provider = posixProvider(join(root.path, "missing"));
    expect(provider.tryAcquire("session:x")).toEqual({
      ok: false,
      error: { kind: "io", code: "ENOENT" },
    });
  });

  test("a library that cannot be loaded is unsupported and falls back to none", () => {
    const root = own(tempDir());
    const broken = {
      dir: root.path,
      libName: "libxeon-does-not-exist.so",
      errnoSymbol: "__errno_location",
      wouldBlockErrno: 11,
    } as const;
    expect(createPosixLockProvider(broken)).toEqual({ ok: false, error: { kind: "unsupported" } });
    const fallback = createLockProvider(
      { kind: "flock", libName: broken.libName, errno: broken },
      root.path,
    );
    expect(fallback.kind).toBe("none");
  });
});

describe("platform selection", () => {
  test("maps supported platforms and rejects the rest", () => {
    expect(toStorePlatform("darwin")).toBe("darwin");
    expect(toStorePlatform("linux")).toBe("linux");
    expect(toStorePlatform("win32")).toBe("win32");
    expect(toStorePlatform("freebsd")).toBeUndefined();
  });

  test("policies differ by platform", () => {
    expect(selectPlatformPolicy("darwin")).toMatchObject({ customSqlite: true, fullFsync: true });
    expect(selectPlatformPolicy("darwin").lock).toMatchObject({ libName: "libSystem.B.dylib" });
    expect(selectPlatformPolicy("linux")).toMatchObject({ customSqlite: false, fullFsync: false });
    expect(selectPlatformPolicy("win32")).toMatchObject({
      posixPermissions: false,
      directoryFsync: false,
      lock: { kind: "none" },
    });
  });

  test("the none provider always grants", () => {
    const provider = createNoneLockProvider();
    expect(provider.kind).toBe("none");
    expect(provider.tryAcquire("a").ok).toBe(true);
    expect(provider.tryAcquire("a").ok).toBe(true);
  });
});
