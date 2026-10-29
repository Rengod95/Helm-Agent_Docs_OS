import { describe, expect, test } from "bun:test";
import { DEFAULT_STORE_SETTINGS, resolveStoreSettings } from "../src/settings.ts";

describe("resolveStoreSettings", () => {
  test("an empty input gives the documented defaults", () => {
    expect(resolveStoreSettings({})).toEqual({ ok: true, value: DEFAULT_STORE_SETTINGS });
    expect(DEFAULT_STORE_SETTINGS).toEqual({
      heartbeatMs: 5000,
      leaseTtlMs: 30_000,
      busyTimeoutMs: 5000,
      blobGraceMs: 86_400_000,
      blobGcEnabled: false,
      requireFts5: false,
      macFullFsync: true,
      customSqlitePath: null,
    });
  });

  test("valid overrides are applied", () => {
    const resolved = resolveStoreSettings({
      heartbeatMs: 2000,
      leaseTtlMs: 9000,
      busyTimeoutMs: 0,
      blobGraceMs: 600_000,
      blobGcEnabled: true,
      requireFts5: true,
      macFullFsync: false,
      customSqlitePath: "/opt/sqlite/libsqlite3.dylib",
    });
    expect(resolved).toEqual({
      ok: true,
      value: {
        heartbeatMs: 2000,
        leaseTtlMs: 9000,
        busyTimeoutMs: 0,
        blobGraceMs: 600_000,
        blobGcEnabled: true,
        requireFts5: true,
        macFullFsync: false,
        customSqlitePath: "/opt/sqlite/libsqlite3.dylib",
      },
    });
  });

  test("values outside the ranges are reported by name", () => {
    const resolved = resolveStoreSettings({
      heartbeatMs: 999,
      leaseTtlMs: 600_001,
      busyTimeoutMs: 60_001,
      blobGraceMs: 599_999,
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error.map((issue) => issue.name).toSorted()).toEqual([
      "blobGraceMs",
      "busyTimeoutMs",
      "heartbeatMs",
      "leaseTtlMs",
    ]);
  });

  test("the ttl must be at least three heartbeats", () => {
    const resolved = resolveStoreSettings({ heartbeatMs: 10_000, leaseTtlMs: 29_999 });
    expect(resolved).toEqual({
      ok: false,
      error: [{ name: "leaseTtlMs", message: "must be at least three times heartbeatMs" }],
    });
    expect(resolveStoreSettings({ heartbeatMs: 10_000, leaseTtlMs: 30_000 }).ok).toBe(true);
  });

  test("wrong types are rejected", () => {
    const resolved = resolveStoreSettings({
      heartbeatMs: "5000",
      leaseTtlMs: 1.5,
      blobGcEnabled: "yes",
      requireFts5: "yes",
      macFullFsync: 1,
      customSqlitePath: "relative/path",
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error.map((issue) => issue.name).toSorted()).toEqual([
      "blobGcEnabled",
      "customSqlitePath",
      "heartbeatMs",
      "leaseTtlMs",
      "macFullFsync",
      "requireFts5",
    ]);
  });

  test("an explicit null path keeps the default", () => {
    expect(resolveStoreSettings({ customSqlitePath: null })).toEqual({
      ok: true,
      value: DEFAULT_STORE_SETTINGS,
    });
  });
});
