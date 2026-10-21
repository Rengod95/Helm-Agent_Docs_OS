import { expect, test } from "bun:test";
import { checkStatement } from "../../../src/operations/index.ts";

const prefix = "x_acme_notes_";

test("storage: checkStatement accepts own tables and rejects foreign ones and keywords", () => {
  expect(checkStatement('SELECT * FROM "x_acme_notes_pins" WHERE "id" = ?', prefix)).toEqual([]);
  expect(checkStatement('INSERT INTO "x_acme_notes_pins" ("id") VALUES (?)', prefix)).toEqual([]);
  expect(
    checkStatement(
      'CREATE INDEX IF NOT EXISTS "x_acme_notes_pins__i1" ON "x_acme_notes_pins" ("id")',
      prefix,
    ),
  ).toEqual([]);

  const foreign = checkStatement('SELECT * FROM "events"', prefix);
  expect(foreign).toEqual([{ kind: "foreign_table", table: "events" }]);
  expect(checkStatement('SELECT * FROM "main"."events"', prefix)[0]?.kind).toBe("foreign_table");
  expect(checkStatement("SELECT * FROM main.events", prefix)).toContainEqual({
    kind: "foreign_table",
    table: "main.events",
  });
  expect(checkStatement("SELECT * FROM sqlite_master", prefix)).toContainEqual({
    kind: "forbidden_statement",
    keyword: "sqlite_",
  });
  expect(checkStatement("ATTACH DATABASE 'x.db' AS other", prefix)).toContainEqual({
    kind: "forbidden_statement",
    keyword: "ATTACH",
  });
  expect(checkStatement("PRAGMA writable_schema = 1", prefix)[0]).toEqual({
    kind: "forbidden_statement",
    keyword: "PRAGMA",
  });
  expect(checkStatement("VACUUM", prefix)[0]?.kind).toBe("forbidden_statement");
  expect(
    checkStatement('DELETE FROM "x_acme_notes_pins"; DROP TABLE "events"', prefix),
  ).toContainEqual({
    kind: "multiple_statements",
  });
});

test("storage: string literals and a trailing semicolon do not confuse the guard", () => {
  expect(
    checkStatement("SELECT 'a; DROP TABLE events' AS note FROM \"x_acme_notes_pins\";", prefix),
  ).toEqual([]);
  expect(
    checkStatement('UPDATE "x_acme_notes_pins" SET "title" = \'PRAGMA\' WHERE "id" = ?', prefix),
  ).toEqual([]);
});
