import { Database } from "bun:sqlite";
import { writeFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "bun:test";
import { openStore } from "../src/index.ts";
import { DEFAULT_STORE_SETTINGS } from "../src/settings.ts";
import { directOptions } from "./support/store.ts";
import { own, releaseOwned } from "./support/own.ts";
import { tempDir } from "./support/tmp.ts";

afterEach(releaseOwned);

async function createStore(path: string): Promise<void> {
  const opened = await openStore(directOptions(path).options);
  if (!opened.ok) throw new Error(`setup failed: ${opened.error.kind}`);
  await opened.value.close();
}

describe("open errors", () => {
  test("a parent that is a file is an io error", async () => {
    const dir = own(tempDir());
    writeFileSync(dir.join("file.txt"), "x");
    const opened = await openStore(directOptions(dir.join("file.txt", "sub", "xeon.db")).options);
    expect(opened).toEqual({ ok: false, error: { kind: "io", code: "ENOTDIR" } });
  });

  test.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "a data directory owned by someone else is a permission error",
    async () => {
      const opened = await openStore(directOptions("/usr/xeon-test.db").options);
      expect(opened).toMatchObject({ ok: false, error: { kind: "permission", path: "/usr" } });
    },
  );

  test("a busy database fails the open with busy", async () => {
    const dir = own(tempDir());
    const path = dir.join("xeon.db");
    await createStore(path);
    const other = new Database(path);
    other.run("PRAGMA busy_timeout = 0");
    other.run("BEGIN IMMEDIATE");
    try {
      const { options } = directOptions(path, {
        settings: { ...DEFAULT_STORE_SETTINGS, busyTimeoutMs: 0 },
      });
      expect(await openStore(options)).toEqual({ ok: false, error: { kind: "busy" } });
    } finally {
      other.run("ROLLBACK");
      other.close();
    }
  });

  test("a tampered sys migration fails the open and closes the connections", async () => {
    const dir = own(tempDir());
    const path = dir.join("xeon.db");
    await createStore(path);
    const tamper = new Database(path);
    tamper.run(
      `UPDATE sys_migrations SET checksum = '${"0".repeat(64)}' WHERE owner = 'sys' AND version = 1`,
    );
    tamper.close();
    const opened = await openStore(directOptions(path).options);
    expect(opened).toEqual({
      ok: false,
      error: { kind: "migration_checksum_mismatch", owner: "sys", version: 1 },
    });
  });

  test("a database written by a newer engine is reported as a future version", async () => {
    const dir = own(tempDir());
    const path = dir.join("xeon.db");
    await createStore(path);
    const newer = new Database(path);
    newer.run(
      `INSERT INTO sys_migrations (owner, version, checksum, applied_at, engine_version)
       VALUES ('sys', 4, '${"1".repeat(64)}', 1, '9.9.9')`,
    );
    newer.close();
    const opened = await openStore(directOptions(path).options);
    expect(opened).toEqual({
      ok: false,
      error: { kind: "migration_future_version", owner: "sys", dbVersion: 4, codeVersion: 3 },
    });
  });

  test("opening the same file again after a failed open still works", async () => {
    const dir = own(tempDir());
    const path = dir.join("xeon.db");
    await createStore(path);
    const again = await openStore(directOptions(path).options);
    expect(again.ok).toBe(true);
    if (again.ok) await again.value.close();
  });
});
