import { expect, test } from "bun:test";
import { Type } from "typebox";
import {
  columnsOf,
  columnTypeOf,
  extTableName,
  extTablePrefix,
  parseExtTableName,
  RESERVED_LOCAL_TABLES,
  tableDdl,
  THREAD_COLUMN,
  type ExtTableDef,
} from "../../../src/operations/index.ts";
import { unsafeInput } from "../../primitives/fixtures/support.ts";
import { BYPASS_IDENTIFIERS, LOCAL_ONLY_INVALID } from "../fixtures/bypass-identifiers.ts";

const row = Type.Object({
  id: Type.String(),
  title: Type.String(),
  done: Type.Optional(Type.Boolean()),
});
const def: ExtTableDef = {
  row,
  key: ["id"],
  indexes: [["title"], ["title", "id"]],
  perThread: false,
};

test("storage: table names start with prefix", () => {
  expect(extTablePrefix("acme-notes")).toBe("x_acme_notes_");
  expect(extTableName("acme-notes", "pins")).toBe("x_acme_notes_pins");
  const ddl = tableDdl("acme-notes", "pins", def);
  expect(ddl.ok).toBe(true);
  if (!ddl.ok) return;
  expect(ddl.value).toEqual([
    'CREATE TABLE IF NOT EXISTS "x_acme_notes_pins" ("id" TEXT NOT NULL, "title" TEXT NOT NULL, "done" INTEGER, PRIMARY KEY ("id")) STRICT',
    'CREATE INDEX IF NOT EXISTS "x_acme_notes_pins__i1" ON "x_acme_notes_pins" ("title")',
    'CREATE INDEX IF NOT EXISTS "x_acme_notes_pins__i2" ON "x_acme_notes_pins" ("title", "id")',
  ]);
  for (const statement of ddl.value) {
    for (const match of statement.matchAll(/"(x_[a-z0-9_]+)"/g)) {
      expect(match[1]?.startsWith("x_acme_notes_")).toBe(true);
    }
  }
});

test("storage: perThread tables get a leading thread_id key column", () => {
  const ddl = tableDdl("acme-notes", "marks", { ...def, perThread: true });
  expect(ddl.ok && ddl.value[0]).toBe(
    'CREATE TABLE IF NOT EXISTS "x_acme_notes_marks" ("thread_id" TEXT NOT NULL, "id" TEXT NOT NULL, "title" TEXT NOT NULL, "done" INTEGER, PRIMARY KEY ("thread_id", "id")) STRICT',
  );
  // thread_id는 X가 붙이므로 확장이 정의할 수 없다
  const clash: ExtTableDef = {
    row: Type.Object({ [THREAD_COLUMN]: Type.String(), id: Type.String() }),
    key: ["id"],
    perThread: true,
  };
  expect(tableDdl("acme-notes", "marks", clash)).toEqual({
    ok: false,
    error: { kind: "identifier_invalid", name: THREAD_COLUMN },
  });
});

test("storage: bypass identifier corpus is rejected", () => {
  for (const identifier of BYPASS_IDENTIFIERS) {
    const asLocal = tableDdl("acme-notes", identifier, def);
    expect(asLocal.ok).toBe(false);
    if (!asLocal.ok) expect(asLocal.error.kind).toBe("identifier_invalid");
    const asColumn = tableDdl("acme-notes", "pins", {
      row: Type.Object({ [identifier]: Type.String() }),
      key: [identifier],
      perThread: false,
    });
    expect(asColumn.ok).toBe(false);
  }
  for (const identifier of LOCAL_ONLY_INVALID) {
    expect(tableDdl("acme-notes", identifier, def).ok).toBe(false);
  }
  for (const reserved of RESERVED_LOCAL_TABLES) {
    expect(tableDdl("acme-notes", reserved, def)).toEqual({
      ok: false,
      error: { kind: "reserved_table", local: reserved },
    });
  }
  // 키·인덱스 열이 행에 없어도 거부한다
  expect(tableDdl("acme-notes", "pins", { ...def, key: [unsafeInput("missing")] }).ok).toBe(false);
});

test("storage: hyphen names do not collide", () => {
  expect(extTableName("a", "bc")).toBe("x_a_bc");
  expect(extTableName("a-b", "c")).toBe("x_a_b_c");
  expect(parseExtTableName("x_a_bc")).toEqual({ extension: "a", local: "bc" });
  expect(parseExtTableName("x_a_b_c")).toEqual({ extension: "a-b", local: "c" });
  expect(parseExtTableName("x_acme_notes_pins")).toEqual({
    extension: "acme-notes",
    local: "pins",
  });
  expect(parseExtTableName("events")).toBeUndefined();
  expect(parseExtTableName("xh_ext_tables")).toBeUndefined();
  expect(parseExtTableName("x__pins")).toBeUndefined();
});

test("storage: column type mapping", () => {
  expect(columnTypeOf(Type.String())).toMatchObject({ sql: "TEXT", json: false });
  expect(columnTypeOf(Type.Integer())).toMatchObject({ sql: "INTEGER" });
  expect(columnTypeOf(Type.Number())).toMatchObject({ sql: "REAL" });
  expect(columnTypeOf(Type.Boolean())).toMatchObject({ sql: "INTEGER", boolean: true });
  expect(columnTypeOf(Type.Array(Type.String()))).toMatchObject({ sql: "TEXT", json: true });
  expect(columnTypeOf(Type.Object({ x: Type.Number() }))).toMatchObject({
    sql: "TEXT",
    json: true,
  });
  expect(columnTypeOf(Type.Union([Type.String(), Type.Null()]))).toMatchObject({
    sql: "TEXT",
    nullable: true,
    acceptsNull: true,
  });
  expect(columnTypeOf(Type.Unknown())).toBeUndefined();
  const unsupported = columnsOf(
    { row: Type.Object({ blob: Type.Unknown() }), key: ["blob"], perThread: false },
    "x_acme_notes_pins",
  );
  expect(unsupported).toEqual({
    ok: false,
    error: { kind: "column_type_unsupported", table: "x_acme_notes_pins", column: "blob" },
  });
  const optional = columnsOf(def, "x_acme_notes_pins");
  expect(
    optional.ok && optional.value.find((column) => column.name === "done")?.type.nullable,
  ).toBe(true);
});
