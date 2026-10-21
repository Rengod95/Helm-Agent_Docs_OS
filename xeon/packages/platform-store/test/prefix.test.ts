import { describe, expect, test } from "bun:test";
import {
  checkExtName,
  classifyStatement,
  hasMultipleStatements,
  coreOwnerSpecs,
  extOwnerId,
  isExtTableOf,
  isRootOnlyOwner,
  isStrictBuild,
  ownsTable,
} from "../src/prefix.ts";

describe("classifyStatement", () => {
  test("ddl lexer extracts table names", () => {
    expect(classifyStatement("CREATE TABLE x_a_t (a)")).toEqual({
      kind: "ddl",
      object: "TABLE",
      targets: ["x_a_t"],
      parsed: true,
    });
    expect(classifyStatement('create table if not exists "x_a_t" (a)')).toMatchObject({
      targets: ["x_a_t"],
    });
    expect(classifyStatement("CREATE TEMP TABLE temp.x_a_t (a)")).toMatchObject({
      targets: ["x_a_t"],
    });
    expect(
      classifyStatement("CREATE VIRTUAL TABLE IF NOT EXISTS [x_a_f] USING fts5(body)"),
    ).toMatchObject({
      targets: ["x_a_f"],
    });
    expect(classifyStatement("-- note\n/* c */ DROP TABLE `x_a_t`")).toMatchObject({
      targets: ["x_a_t"],
    });
    expect(classifyStatement("DROP INDEX IF EXISTS main.x_a_i")).toMatchObject({
      targets: ["x_a_i"],
    });
    expect(classifyStatement("ALTER TABLE x_a_t ADD COLUMN b TEXT")).toMatchObject({
      targets: ["x_a_t"],
    });
  });

  test("indexes and triggers name their table too", () => {
    expect(classifyStatement("CREATE UNIQUE INDEX x_a_i ON x_a_t (b)")).toMatchObject({
      targets: ["x_a_i", "x_a_t"],
    });
    expect(
      classifyStatement("CREATE TRIGGER x_a_trg AFTER INSERT ON p_turns BEGIN SELECT 1; END"),
    ).toMatchObject({ targets: ["x_a_trg", "p_turns"] });
  });

  test("unparseable ddl is flagged", () => {
    expect(classifyStatement("CREATE")).toEqual({
      kind: "ddl",
      object: null,
      targets: [],
      parsed: false,
    });
    expect(classifyStatement("ALTER INDEX x RENAME TO y")).toMatchObject({ parsed: false });
    expect(classifyStatement("CREATE TABLE")).toMatchObject({ parsed: false });
  });

  test("transaction control and maintenance statements are forbidden", () => {
    for (const keyword of [
      "BEGIN",
      "COMMIT",
      "END",
      "ROLLBACK",
      "SAVEPOINT",
      "RELEASE",
      "VACUUM",
      "REINDEX",
      "ANALYZE",
    ]) {
      expect(classifyStatement(`${keyword.toLowerCase()} something`)).toEqual({
        kind: "forbidden",
        keyword,
      });
    }
  });

  test("attach, pragma and other statements", () => {
    expect(classifyStatement("ATTACH DATABASE 'x' AS y")).toEqual({ kind: "attach" });
    expect(classifyStatement("detach y")).toEqual({ kind: "attach" });
    expect(classifyStatement("PRAGMA journal_mode = DELETE")).toMatchObject({
      kind: "pragma",
      write: true,
    });
    expect(classifyStatement("PRAGMA wal_checkpoint")).toMatchObject({
      kind: "pragma",
      write: true,
    });
    expect(classifyStatement("PRAGMA table_info(x_a_t)")).toEqual({
      kind: "pragma",
      write: false,
      name: "table_info",
      tables: ["x_a_t"],
    });
    expect(classifyStatement("SELECT 1")).toEqual({ kind: "other" });
    expect(classifyStatement("   ")).toEqual({ kind: "other" });
  });
});

describe("hasMultipleStatements", () => {
  test("a trailing semicolon is one statement, a second statement is not", () => {
    expect(hasMultipleStatements("SELECT 1")).toBe(false);
    expect(hasMultipleStatements("SELECT 1;")).toBe(false);
    expect(hasMultipleStatements("SELECT 1; -- done")).toBe(false);
    expect(hasMultipleStatements("SELECT 1; DROP TABLE x")).toBe(true);
    expect(hasMultipleStatements("SELECT ';' AS semi")).toBe(false);
    expect(hasMultipleStatements('SELECT 1 AS "a;b"')).toBe(false);
    expect(hasMultipleStatements("SELECT 1 /* ; */")).toBe(false);
  });
});

describe("table ownership", () => {
  const ext = { owner: "ext.ab", kind: "extension", names: ["x_ab_"] } as const;
  const core = { owner: "core.persistence", kind: "core", names: ["events", "p_"] } as const;

  test("core names are prefixes or exact names with their indexes", () => {
    expect(ownsTable(core, "p_turns")).toBe(true);
    expect(ownsTable(core, "events")).toBe(true);
    expect(ownsTable(core, "events_by_thread")).toBe(true);
    expect(ownsTable(core, "eventsx")).toBe(false);
    expect(ownsTable(core, "sys_leases")).toBe(false);
  });

  test("extension tables need a local name without underscores", () => {
    expect(ownsTable(ext, "x_ab_cd")).toBe(true);
    expect(ownsTable(ext, "x_ab_cd_ef")).toBe(false);
    expect(ownsTable(ext, "x_ab_")).toBe(false);
    expect(ownsTable(ext, "x_ab_Cd")).toBe(false);
    expect(ownsTable(ext, "x_abc_d")).toBe(false);
  });

  test("ab and ab-cd do not own each other's tables", () => {
    expect(isExtTableOf("ab", "x_ab_cd")).toBe(true);
    expect(isExtTableOf("ab", "x_ab_cd_ef")).toBe(false);
    expect(isExtTableOf("ab-cd", "x_ab_cd_ef")).toBe(true);
    expect(isExtTableOf("ab-cd", "x_ab_cd")).toBe(false);
  });

  test("extension names follow the pattern and reserved words", () => {
    expect(checkExtName("acme-notes")).toEqual({ ok: true });
    expect(checkExtName("Helm")).toEqual({ ok: false, reason: "pattern" });
    expect(checkExtName("a_b")).toEqual({ ok: false, reason: "pattern" });
    expect(checkExtName("x")).toEqual({ ok: false, reason: "pattern" });
    for (const reserved of ["core", "cap", "xh", "sys", "ext"]) {
      expect(checkExtName(reserved)).toEqual({ ok: false, reason: "reserved" });
    }
    expect(extOwnerId("acme-notes")).toBe("ext.acme-notes");
  });
});

describe("core owner table", () => {
  test("is derived from the F tables", () => {
    const specs = new Map(coreOwnerSpecs().map((spec) => [spec.owner, spec.names]));
    expect(specs.get("sys")).toEqual(["sys_"]);
    expect(specs.get("core.persistence")).toContain("events");
    expect(specs.get("core.persistence")).toContain("p_");
    expect(specs.get("xh")).toEqual(["xh_"]);
    expect(specs.get("core.models")).toEqual(["core_models_"]);
    expect(specs.get("cap.knowledge")).toEqual(["cap_knowledge_"]);
    expect(specs.size).toBeGreaterThanOrEqual(13);
  });

  test("sys and core.persistence are root only", () => {
    expect(isRootOnlyOwner("sys")).toBe(true);
    expect(isRootOnlyOwner("core.persistence")).toBe(true);
    expect(isRootOnlyOwner("cap.knowledge")).toBe(false);
  });
});

describe("isStrictBuild", () => {
  test("is on unless production, and XEON_STORE_STRICT forces it on", () => {
    expect(isStrictBuild({})).toBe(true);
    expect(isStrictBuild({ NODE_ENV: "test" })).toBe(true);
    expect(isStrictBuild({ NODE_ENV: "production" })).toBe(false);
    expect(isStrictBuild({ NODE_ENV: "production", XEON_STORE_STRICT: "1" })).toBe(true);
  });
});
