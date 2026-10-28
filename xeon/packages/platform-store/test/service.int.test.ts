import { Database } from "bun:sqlite";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { PlatformContext } from "@xeon/ext-host";
import { openStore, storePlugin } from "../src/index.ts";
import { DEFAULT_STORE_SETTINGS } from "../src/settings.ts";
import { openTestStore } from "../src/testing/index.ts";
import type { DarwinCustomReport } from "./fixtures/darwin-custom.ts";
import { runScript } from "./support/spawn.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { directOptions } from "./support/store.ts";
import { tempDir } from "./support/tmp.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

describe("store identity", () => {
  test("storeId is a sto_ULID and survives reopening", async () => {
    const dir = own(tempDir());
    const path = dir.join("xeon.db");
    const first = await openStore(directOptions(path).options);
    if (!first.ok) throw new Error("open failed");
    const id = first.value.service.storeId;
    expect(id).toMatch(/^sto_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    await first.value.close();
    const second = await openStore(directOptions(path, { engineVersion: "0.0.1-next" }).options);
    if (!second.ok) throw new Error("reopen failed");
    expect(second.value.service.storeId).toBe(id);
    const meta = second.value.root.read((tx) =>
      tx.all("SELECT key, value FROM sys_meta ORDER BY key"),
    );
    expect(meta.ok && meta.value.map((row) => row["key"])).toEqual([
      "created_at",
      "created_by",
      "last_opened_by",
      "store_id",
    ]);
    const byKey = new Map(meta.ok ? meta.value.map((row) => [row["key"], row["value"]]) : []);
    expect(byKey.get("created_by")).toBe("0.0.0-test");
    expect(byKey.get("last_opened_by")).toBe("0.0.1-next");
    await second.value.close();
  });

  test("data and extension bookkeeping survive reopening", async () => {
    const dir = own(tempDir());
    const path = dir.join("xeon.db");
    const first = await openStore(directOptions(path).options);
    if (!first.ok) throw new Error("open failed");
    first.value.service.extensions.register("acme-notes");
    first.value.root.write((tx) => {
      tx.run("CREATE TABLE p_probe (a TEXT) STRICT");
      tx.run("INSERT INTO p_probe (a) VALUES ('kept')");
    });
    await first.value.close();
    const second = await openStore(directOptions(path).options);
    if (!second.ok) throw new Error("reopen failed");
    expect(second.value.root.read((tx) => tx.all("SELECT a FROM p_probe"))).toEqual({
      ok: true,
      value: [{ a: "kept" }],
    });
    expect(second.value.service.scoped("ext.acme-notes")).toBeDefined();
    await second.value.close();
  });

  test("core owners are registered in sys_prefixes", async () => {
    const clock = manualClock();
    const store = own(await openTestStore({ clock, ids: fixedIdFactory(clock) }));
    const rows = store.root.read((tx) =>
      tx.all("SELECT owner, kind, names FROM sys_prefixes ORDER BY owner"),
    );
    if (!rows.ok) throw new Error("read failed");
    const owners = new Map(rows.value.map((row) => [row["owner"], row]));
    expect(owners.get("cap.knowledge")).toMatchObject({
      kind: "core",
      names: '["cap_knowledge_"]',
    });
    expect(owners.get("sys")).toMatchObject({ kind: "core", names: '["sys_"]' });
    expect(String(owners.get("core.persistence")?.["names"])).toContain('"events"');
    expect(rows.value.every((row) => row["kind"] === "core")).toBe(true);
  });
});

describe("close", () => {
  test("is idempotent and truncates the wal", async () => {
    const dir = own(tempDir());
    const path = dir.join("xeon.db");
    const opened = await openStore(directOptions(path).options);
    if (!opened.ok) throw new Error("open failed");
    opened.value.root.write((tx) => {
      tx.run("CREATE TABLE p_probe (a TEXT) STRICT");
      tx.run("INSERT INTO p_probe (a) VALUES ('x')");
    });
    await opened.value.close();
    await opened.value.close();
    const wal = `${path}-wal`;
    expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true);
    expect(opened.value.warnings.filter((w) => w.kind === "checkpoint_incomplete")).toEqual([]);
  });

  test("a reader holding an old snapshot leaves a checkpoint_incomplete warning", async () => {
    const dir = own(tempDir());
    const path = dir.join("xeon.db");
    const { options } = directOptions(path, {
      settings: { ...DEFAULT_STORE_SETTINGS, busyTimeoutMs: 20 },
    });
    const opened = await openStore(options);
    if (!opened.ok) throw new Error("open failed");
    opened.value.root.write((tx) => {
      tx.run("CREATE TABLE p_probe (a TEXT) STRICT");
      tx.run("INSERT INTO p_probe (a) VALUES ('x')");
    });
    const reader = new Database(path, { readonly: true });
    reader.run("BEGIN");
    reader.query("SELECT count(*) FROM p_probe").get();
    opened.value.root.write((tx) => tx.run("INSERT INTO p_probe (a) VALUES ('y')"));
    await opened.value.close();
    expect(opened.value.warnings.some((w) => w.kind === "checkpoint_incomplete")).toBe(true);
    reader.run("ROLLBACK");
    reader.close();
  });

  test("asyncDispose closes the store", async () => {
    const clock = manualClock();
    const store = await openTestStore({ clock, ids: fixedIdFactory(clock) });
    const { root } = store;
    await store[Symbol.asyncDispose]();
    expect(() => root.write(() => 1)).toThrow("store.closed");
  });
});

describe("storePlugin", () => {
  test("provides xeon.store and closes the store when the host goes down", async () => {
    const clock = manualClock();
    const store = await openTestStore({ clock, ids: fixedIdFactory(clock) });
    const provided: { name: string; impl: unknown }[] = [];
    const disposers: (() => void | Promise<void>)[] = [];
    const ctx: PlatformContext = {
      providePort: (key, impl) => {
        provided.push({ name: key.name, impl });
      },
      port: () => {
        throw new Error("platform-store reads no other port");
      },
      onDispose: (fn) => {
        disposers.push(fn);
      },
    };
    const plugin = storePlugin(store.opened);
    expect(plugin.name).toBe("platform-store");
    await plugin.setup(ctx);
    expect(provided).toHaveLength(1);
    expect(provided[0]?.name).toBe("xeon.store");
    expect(provided[0]?.impl).toBe(store.service);
    expect(disposers).toHaveLength(1);
    await disposers[0]?.();
    expect(() => store.root.write(() => 1)).toThrow("store.closed");
    await store[Symbol.asyncDispose]();
  });
});

describe("platform policies", () => {
  test("the macOS policy sets fullfsync and falls back to no os lock without libSystem", async () => {
    const dir = own(tempDir());
    const { options } = directOptions(dir.join("xeon.db"), {
      env: { ...directOptions("/x").options.env, platform: "darwin" },
    });
    const opened = await openStore(options);
    if (!opened.ok) throw new Error(`open failed: ${opened.error.kind}`);
    const pragma = opened.value.root.write((tx) => tx.get("PRAGMA fullfsync"));
    expect(pragma).toEqual({ ok: true, value: { fullfsync: 1 } });
    // Linux에는 libSystem.B.dylib가 없으므로 DB 임대만 쓴다
    if (process.platform !== "darwin") {
      expect(opened.value.warnings).toContainEqual({ kind: "lock_provider_none" });
    } else {
      // 실제 macOS: libSystem.B.dylib는 디스크에 없어도 dlopen이 되므로 OS 잠금을 쥔다(2026-10-25 실측)
      expect(opened.value.warnings).not.toContainEqual({ kind: "lock_provider_none" });
    }
    await opened.value.close();
  });

  test("turning macFullFsync off sets checkpoint_fullfsync only", async () => {
    const dir = own(tempDir());
    const { options } = directOptions(dir.join("xeon.db"), {
      env: { ...directOptions("/x").options.env, platform: "darwin" },
      settings: { ...DEFAULT_STORE_SETTINGS, macFullFsync: false },
    });
    const opened = await openStore(options);
    if (!opened.ok) throw new Error("open failed");
    const full = opened.value.root.write((tx) => tx.get("PRAGMA fullfsync"));
    const checkpoint = opened.value.root.write((tx) => tx.get("PRAGMA checkpoint_fullfsync"));
    expect(full).toEqual({ ok: true, value: { fullfsync: 0 } });
    expect(checkpoint).toEqual({ ok: true, value: { checkpoint_fullfsync: 1 } });
    await opened.value.close();
  });

  test("a custom sqlite path that cannot be loaded fails the open with sqlite_load_failed", async () => {
    // dlopen 실패는 macOS에서만 실제로 나므로 로더를 주입한다. 프로세스당 한 번만 로드할 수 있어 자식에서 돈다(§4.1 2번)
    const dir = own(tempDir());
    const result = await runScript(join(import.meta.dir, "fixtures", "darwin-custom.ts"), [
      dir.join("xeon.db"),
      "/nonexistent/libsqlite3.dylib",
      "fail-load",
    ]);
    expect(result.code).toBe(3);
    expect(result.stdout.trim()).toBe("OPEN_FAILED sqlite_load_failed");
  });

  test("a custom sqlite path is recorded in the capabilities", async () => {
    const dir = own(tempDir());
    const result = await runScript(join(import.meta.dir, "fixtures", "darwin-custom.ts"), [
      dir.join("xeon.db"),
      "/nonexistent/libsqlite3.dylib",
    ]);
    if (process.platform === "darwin") {
      // macOS의 Bun은 없는 dylib을 바로 dlopen하다 실패한다(실측 2026-10-25). 열기 실패는 값으로 돌아온다
      expect(result.code).toBe(3);
      expect(result.stdout.trim()).toBe("OPEN_FAILED sqlite_load_failed");
      return;
    }
    // Linux의 Bun은 경로를 확인하지 않고 받아들인다
    expect(result.code).toBe(0);
    const expected: Partial<DarwinCustomReport> = {
      fts5: true,
      customSqlitePath: "/nonexistent/libsqlite3.dylib",
    };
    expect(JSON.parse(result.stdout)).toMatchObject(expected);
  });
});
