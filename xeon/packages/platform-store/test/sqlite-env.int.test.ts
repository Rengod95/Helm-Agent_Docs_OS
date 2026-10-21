import { afterEach, describe, expect, test } from "bun:test";
import { openStore } from "../src/index.ts";
import { initSqlite, loadedSqlitePath, probeFts5, probeSqlite } from "../src/sqlite-env.ts";
import { openTestStore } from "../src/testing/index.ts";
import { DEFAULT_STORE_SETTINGS } from "../src/settings.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { directOptions } from "./support/store.ts";
import { tempDir } from "./support/tmp.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

const WITHOUT_FTS5 = {
  fts5: false,
  sqliteVersion: "3.0.0-test",
  compileOptionFts5: false,
} as const;

describe("sqlite environment", () => {
  test("probe returns true with bundled sqlite", () => {
    const probe = probeSqlite();
    expect(probe.fts5).toBe(true);
    expect(probe.compileOptionFts5).toBe(true);
    expect(probe.sqliteVersion).toMatch(/^3\.\d+\.\d+/);
  });

  test("probe returns false when fts5 module is missing", () => {
    const result = probeFts5({
      run: (sql) => {
        if (sql.includes("fts5")) throw new Error("no such module: fts5");
      },
      query: () => ({ n: 1 }),
    });
    expect(result).toEqual({ ok: false, error: { kind: "fts5_missing" } });
  });

  test("probe is false when the match does not return exactly one row", () => {
    const result = probeFts5({ run: () => {}, query: () => ({ n: 0 }) });
    expect(result.ok).toBe(false);
  });

  test("missing fts5 opens store with capability off", async () => {
    const clock = manualClock();
    const store = own(
      await openTestStore({
        clock,
        ids: fixedIdFactory(clock),
        probe: () => WITHOUT_FTS5,
      }),
    );
    expect(store.service.capabilities.fts5).toBe(false);
    expect(store.opened.warnings).toContainEqual({ kind: "fts5_missing" });
  });

  test("missing fts5 fails when requireFts5 is set", async () => {
    const dir = own(tempDir());
    const { options } = directOptions(dir.join("xeon.db"), {
      probe: () => WITHOUT_FTS5,
      settings: { ...DEFAULT_STORE_SETTINGS, requireFts5: true },
    });
    expect(await openStore(options)).toEqual({ ok: false, error: { kind: "fts5_missing" } });
  });

  test("capabilities report the loaded sqlite", async () => {
    const clock = manualClock();
    const store = own(await openTestStore({ clock, ids: fixedIdFactory(clock) }));
    const { capabilities } = store.service;
    expect(capabilities.fts5).toBe(true);
    expect(capabilities.sqliteVersion).toMatch(/^3\./);
    expect(capabilities.customSqlitePath).toBeNull();
    expect(capabilities.lockProvider).toBe("flock");
  });

  test("initializing sqlite twice with the same path is a no-op", () => {
    initSqlite(null);
    initSqlite(null);
    expect(loadedSqlitePath()).toBeNull();
  });
});
