import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "bun:test";
import { ensurePrivateDir, ensurePrivateFile } from "../src/fs-private.ts";
import { toSqlRow, columnInt, columnNullableInt, columnString } from "../src/rows.ts";
import type { StoreWarning } from "../src/types.ts";
import { tempDir } from "./support/tmp.ts";
import { own, releaseOwned } from "./support/own.ts";

afterEach(releaseOwned);

describe("private directories and files", () => {
  test("creates a directory with mode 0700 and fixes open modes with a warning", () => {
    const root = own(tempDir());
    const warnings: StoreWarning[] = [];
    const path = root.join("a", "b");
    expect(ensurePrivateDir(path, true, warnings)).toEqual({ ok: true, value: undefined });
    expect(statSync(path).mode & 0o777).toBe(0o700);
    expect(warnings).toEqual([]);
    chmodSync(path, 0o770);
    expect(ensurePrivateDir(path, true, warnings).ok).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o700);
    expect(warnings).toEqual([{ kind: "permission_fixed", path, from: 0o770, to: 0o700 }]);
  });

  test("files are fixed to 0600", () => {
    const root = own(tempDir());
    const warnings: StoreWarning[] = [];
    const path = root.join("x.db");
    writeFileSync(path, "x", { mode: 0o644 });
    chmodSync(path, 0o644);
    expect(ensurePrivateFile(path, true, warnings).ok).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(warnings).toEqual([{ kind: "permission_fixed", path, from: 0o644, to: 0o600 }]);
  });

  test("a platform without posix permissions skips the checks", () => {
    const root = own(tempDir());
    const warnings: StoreWarning[] = [];
    const path = root.join("c");
    mkdirSync(path, { mode: 0o777 });
    chmodSync(path, 0o777);
    expect(ensurePrivateDir(path, false, warnings).ok).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o777);
    expect(ensurePrivateFile(root.join("missing"), false, warnings).ok).toBe(true);
  });

  test("a missing file is an io error", () => {
    const root = own(tempDir());
    expect(ensurePrivateFile(root.join("missing"), true, [])).toEqual({
      ok: false,
      error: { kind: "io", code: "ENOENT" },
    });
  });

  test.skipIf(process.getuid?.() === 0)(
    "a directory owned by someone else is a permission error",
    () => {
      const warnings: StoreWarning[] = [];
      const result = ensurePrivateDir("/usr", true, warnings);
      expect(result).toMatchObject({ ok: false, error: { kind: "permission", path: "/usr" } });
      expect(warnings).toEqual([]);
    },
  );
});

describe("row helpers", () => {
  test("toSqlRow accepts SqlValue cells only", () => {
    expect(toSqlRow({ a: 1, b: "x", c: null, d: 2n, e: new Uint8Array([1]) })).toEqual({
      a: 1,
      b: "x",
      c: null,
      d: 2n,
      e: new Uint8Array([1]),
    });
    expect(() => toSqlRow(null)).toThrow("store.row_invalid");
    expect(() => toSqlRow([1])).toThrow("store.row_invalid");
    expect(() => toSqlRow({ a: true })).toThrow("store.row_invalid");
  });

  test("column readers check the cell type", () => {
    const row = toSqlRow({ s: "x", i: 3, b: 4n, n: null });
    expect(columnString(row, "s")).toBe("x");
    expect(columnInt(row, "i")).toBe(3);
    expect(columnInt(row, "b")).toBe(4);
    expect(columnNullableInt(row, "n")).toBeNull();
    expect(columnNullableInt(row, "i")).toBe(3);
    expect(() => columnString(row, "i")).toThrow("store.row_invalid");
    expect(() => columnInt(row, "s")).toThrow("store.row_invalid");
    expect(() => columnInt(row, "missing")).toThrow("store.row_invalid");
  });
});
