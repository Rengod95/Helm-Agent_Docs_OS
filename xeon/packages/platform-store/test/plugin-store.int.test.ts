import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { PLUGIN_STORE_LIMITS, type PluginStorePort } from "@fresnel/contracts/extensions";
import { openStore } from "../src/index.ts";
import { openTestStore } from "../src/testing/index.ts";
import { fixedIdFactory, manualClock } from "./support/clock.ts";
import { directOptions } from "./support/store.ts";
import { own, releaseOwned } from "./support/own.ts";
import { tempDir } from "./support/tmp.ts";

afterEach(releaseOwned);

async function open(): Promise<Awaited<ReturnType<typeof openTestStore>>> {
  const clock = manualClock();
  return openTestStore({ clock, ids: fixedIdFactory(clock) });
}

/** 이 시험이 쓰는 값. 바이트 수는 JSON 텍스트의 UTF-8 길이다(글자가 모두 ASCII라 글자 수와 같다) */
const SHORT = '"x"'; // 3바이트
const LONG = '"a much longer value"'; // 21바이트

describe("plugin store port", () => {
  test("put, get, list, delete, usage and clear compare values", async () => {
    const store = own(await open());
    const port: PluginStorePort = store.opened.pluginStore;

    expect(await port.get("acme", "a")).toEqual({ ok: true, value: null });
    expect(await port.put("acme", "a", '"x"')).toEqual({ ok: true, value: undefined });
    expect(await port.put("acme", "b.one", '{"n":1}')).toEqual({ ok: true, value: undefined });
    expect(await port.put("acme", "b_two", "[1,2]")).toEqual({ ok: true, value: undefined });

    expect(await port.get("acme", "b.one")).toEqual({ ok: true, value: '{"n":1}' });
    expect(await port.list("acme", "")).toEqual({
      ok: true,
      value: [
        { key: "a", valueJson: '"x"' },
        { key: "b.one", valueJson: '{"n":1}' },
        { key: "b_two", valueJson: "[1,2]" },
      ],
    });
    expect(await port.list("acme", "b")).toEqual({
      ok: true,
      value: [
        { key: "b.one", valueJson: '{"n":1}' },
        { key: "b_two", valueJson: "[1,2]" },
      ],
    });
    expect(await port.list("acme", "b.")).toEqual({
      ok: true,
      value: [{ key: "b.one", valueJson: '{"n":1}' }],
    });
    expect(await port.list("acme", "zz")).toEqual({ ok: true, value: [] });

    expect(await port.delete("acme", "a")).toEqual({ ok: true, value: undefined });
    expect(await port.delete("acme", "missing")).toEqual({ ok: true, value: undefined });
    expect(await port.get("acme", "a")).toEqual({ ok: true, value: null });

    // 남은 값: '{"n":1}'(7바이트) + '[1,2]'(5바이트)
    expect(await port.usage("acme")).toEqual({ ok: true, value: { keys: 2, bytes: 12 } });

    expect(await port.clear("acme")).toEqual({ ok: true, value: undefined });
    expect(await port.usage("acme")).toEqual({ ok: true, value: { keys: 0, bytes: 0 } });
    expect(await port.list("acme", "")).toEqual({ ok: true, value: [] });
  });

  test("two extensions with the same key do not see each other, and clear is scoped", async () => {
    const store = own(await open());
    const port = store.opened.pluginStore;

    expect(await port.put("acme-notes", "k", '"a"')).toEqual({ ok: true, value: undefined });
    expect(await port.put("other-app", "k", '"b"')).toEqual({ ok: true, value: undefined });
    expect(await port.get("acme-notes", "k")).toEqual({ ok: true, value: '"a"' });
    expect(await port.get("other-app", "k")).toEqual({ ok: true, value: '"b"' });
    expect(await port.list("other-app", "")).toEqual({
      ok: true,
      value: [{ key: "k", valueJson: '"b"' }],
    });

    expect(await port.clear("acme-notes")).toEqual({ ok: true, value: undefined });
    expect(await port.get("acme-notes", "k")).toEqual({ ok: true, value: null });
    expect(await port.get("other-app", "k")).toEqual({ ok: true, value: '"b"' });
    expect(await port.usage("other-app")).toEqual({ ok: true, value: { keys: 1, bytes: 3 } });
  });

  test("a put on an existing key replaces it and usage follows the new size", async () => {
    const store = own(await open());
    const port = store.opened.pluginStore;

    expect(await port.put("acme", "k", SHORT)).toEqual({ ok: true, value: undefined });
    expect(await port.usage("acme")).toEqual({ ok: true, value: { keys: 1, bytes: 3 } });

    expect(await port.put("acme", "k", LONG)).toEqual({ ok: true, value: undefined });
    expect(await port.get("acme", "k")).toEqual({ ok: true, value: LONG });
    expect(await port.usage("acme")).toEqual({ ok: true, value: { keys: 1, bytes: 21 } });

    expect(await port.put("acme", "k", SHORT)).toEqual({ ok: true, value: undefined });
    expect(await port.usage("acme")).toEqual({ ok: true, value: { keys: 1, bytes: 3 } });
  });

  test("the port refuses a write that would pass the key or total limit", async () => {
    const store = own(await open());
    const port = store.opened.pluginStore;

    // 키 수: 256개까지 된다. 257번째 새 키는 store_full이고, 있는 키를 덮어쓰는 것은 된다
    const fills = Array.from({ length: PLUGIN_STORE_LIMITS.keys }, (_, index) =>
      port.put("acme", `k${String(index)}`, "1"),
    );
    expect(await Promise.all(fills)).toEqual(fills.map(() => ({ ok: true, value: undefined })));
    expect(await port.put("acme", "k-extra", "1")).toEqual({
      ok: false,
      error: { kind: "store_full" },
    });
    expect(await port.put("acme", "k0", "2")).toEqual({ ok: true, value: undefined });
    // 값 256개가 모두 '1'(1바이트)이라 합은 256이다. 덮어쓴 k0도 1바이트다
    expect(await port.usage("acme")).toEqual({
      ok: true,
      value: { keys: PLUGIN_STORE_LIMITS.keys, bytes: 256 },
    });

    // 총량: 60002바이트 값 17개는 1 MiB 안이고 18번째는 넘는다. 같은 크기로 덮어쓰면 넘지 않는다
    const big = JSON.stringify("a".repeat(60000)); // 60002바이트
    const bigFills = Array.from({ length: 17 }, (_, index) =>
      port.put("big", `v${String(index)}`, big),
    );
    expect(await Promise.all(bigFills)).toEqual(
      bigFills.map(() => ({ ok: true, value: undefined })),
    );
    expect(await port.put("big", "v17", big)).toEqual({
      ok: false,
      error: { kind: "store_full" },
    });
    expect(await port.put("big", "v0", big)).toEqual({ ok: true, value: undefined });
    expect(await port.usage("big")).toEqual({
      ok: true,
      value: { keys: 17, bytes: 17 * 60002 },
    });
  });

  test("a closed store answers storage_unavailable without throwing", async () => {
    const store = own(await open());
    const port = store.opened.pluginStore;
    expect(await port.put("acme", "k", SHORT)).toEqual({ ok: true, value: undefined });
    await store.opened.close();
    expect(await port.get("acme", "k")).toEqual({
      ok: false,
      error: { kind: "storage_unavailable" },
    });
    expect(await port.put("acme", "k", SHORT)).toEqual({
      ok: false,
      error: { kind: "storage_unavailable" },
    });
  });
});

describe("plugin store across reopen", () => {
  test("values survive closing and opening the same file, and a read-only open reads them", async () => {
    const dir = own(tempDir());
    const path = dir.join("fresnel.db");

    const first = await openStore(directOptions(path).options);
    if (!first.ok) throw new Error("first open failed");
    expect(await first.value.pluginStore.put("acme", "last", '{"at":2}')).toEqual({
      ok: true,
      value: undefined,
    });
    await first.value.close();

    const second = await openStore(directOptions(path).options);
    if (!second.ok) throw new Error("second open failed");
    expect(await second.value.pluginStore.get("acme", "last")).toEqual({
      ok: true,
      value: '{"at":2}',
    });
    await second.value.close();

    const readOnly = await openStore(directOptions(path, { readOnly: true }).options);
    if (!readOnly.ok) throw new Error("read-only open failed");
    own(readOnly.value);
    expect(await readOnly.value.pluginStore.get("acme", "last")).toEqual({
      ok: true,
      value: '{"at":2}',
    });
    expect(await readOnly.value.pluginStore.put("acme", "last", "1")).toEqual({
      ok: false,
      error: { kind: "storage_unavailable", cause: { kind: "io", code: "SQLITE_READONLY" } },
    });
  });
});

describe("sys migration v4", () => {
  test("a new database applies every sys step and creates the plugin store table", async () => {
    const store = own(await open());
    const rows = store.root.read((tx) =>
      tx.all("SELECT version FROM sys_migrations WHERE owner = 'sys' ORDER BY version"),
    );
    expect(rows).toEqual({
      ok: true,
      value: [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }],
    });
    const tables = store.root.read((tx) =>
      tx.all("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'sys_plugin_store'"),
    );
    expect(tables).toEqual({ ok: true, value: [{ name: "sys_plugin_store" }] });
    const version = store.root.read((tx) => tx.get("PRAGMA user_version"));
    expect(version).toEqual({ ok: true, value: { user_version: 4 } });
  });

  test("a version 3 database gets step 4 on open and keeps its store id and data", async () => {
    const dir = own(tempDir());
    const path = dir.join("fresnel.db");

    const created = await openStore(directOptions(path).options);
    if (!created.ok) throw new Error("create failed");
    const storeId = created.value.service.storeId;
    await created.value.close();

    // v3 상태를 만든다: v4 행과 표를 걷고 user_version을 3으로 되돌린다(v1~v3 표는 그대로 둔다)
    const raw = new Database(path);
    raw.run("DROP TABLE sys_plugin_store");
    raw.run("DELETE FROM sys_migrations WHERE owner = 'sys' AND version = 4");
    raw.run("PRAGMA user_version = 3");
    raw.close();

    const reopened = await openStore(directOptions(path).options);
    if (!reopened.ok) throw new Error("reopen of a v3 database failed");
    own(reopened.value);
    expect(reopened.value.service.storeId).toBe(storeId);
    const rows = reopened.value.root.read((tx) =>
      tx.all("SELECT version FROM sys_migrations WHERE owner = 'sys' ORDER BY version"),
    );
    expect(rows).toEqual({
      ok: true,
      value: [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }],
    });
    expect(await reopened.value.pluginStore.put("acme", "k", SHORT)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await reopened.value.pluginStore.get("acme", "k")).toEqual({ ok: true, value: SHORT });
  });
});
