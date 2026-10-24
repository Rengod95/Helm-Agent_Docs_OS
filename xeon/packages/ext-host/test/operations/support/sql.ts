// X가 만드는 SQL 문장 형태만 이해하는 작은 인메모리 엔진(X.operations.plan O-15, review.decisions-2 D-05).
// X 테스트는 L0(bun:sqlite)를 import하지 않는다. 실제 SQLite 실행은 L0.store.plan ST-23의 계약 시나리오가 맡는다.
import { Bug } from "@xeon/contracts";
import type { SqlRow, SqlValue } from "@xeon/contracts/records";

interface FakeTable {
  readonly columns: string[];
  readonly notNull: Set<string>;
  readonly primaryKey: string[];
  rows: Record<string, SqlValue>[];
}

export interface FakeSql {
  run(sql: string, params?: readonly SqlValue[]): { readonly changes: number };
  get(sql: string, params?: readonly SqlValue[]): SqlRow | undefined;
  all(sql: string, params?: readonly SqlValue[]): readonly SqlRow[];
  snapshot(): Map<string, FakeTable>;
  restore(snapshot: Map<string, FakeTable>): void;
  tableNames(): readonly string[];
  rowsOf(table: string): readonly SqlRow[];
  /** 지금까지 실행한 모든 문장 */
  readonly statements: string[];
}

function unquote(identifier: string): string {
  return identifier.trim().replace(/^"/, "").replace(/"$/, "");
}

function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

interface Condition {
  readonly column: string;
  readonly isNull: boolean;
}

function parseWhere(clause: string | undefined): Condition[] {
  if (clause === undefined) return [];
  return clause
    .replace(/^\s*WHERE\s+/, "")
    .split(" AND ")
    .map((part) => {
      const nullMatch = /^"([^"]+)" IS NULL$/.exec(part.trim());
      if (nullMatch?.[1] !== undefined) return { column: nullMatch[1], isNull: true };
      const eqMatch = /^"([^"]+)" = \?$/.exec(part.trim());
      if (eqMatch?.[1] !== undefined) return { column: eqMatch[1], isNull: false };
      throw new Bug(`fake sql: unsupported condition ${part}`);
    });
}

export function createFakeSql(): FakeSql {
  let tables = new Map<string, FakeTable>();
  const statements: string[] = [];

  function tableOf(name: string): FakeTable {
    const table = tables.get(name);
    if (table === undefined) throw new Error(`no such table: ${name}`);
    return table;
  }

  function matches(
    table: FakeTable,
    row: Record<string, SqlValue>,
    conditions: readonly Condition[],
    params: readonly SqlValue[],
    offset: number,
  ): boolean {
    let index = offset;
    for (const condition of conditions) {
      if (!table.columns.includes(condition.column)) {
        throw new Error(`no such column: ${condition.column}`);
      }
      const value = row[condition.column] ?? null;
      if (condition.isNull) {
        if (value !== null) return false;
      } else {
        const expected = params[index];
        index += 1;
        if (value !== expected) return false;
      }
    }
    return true;
  }

  function keyOf(table: FakeTable, row: Record<string, SqlValue>): string {
    return JSON.stringify(table.primaryKey.map((column) => row[column] ?? null));
  }

  function select(sql: string, params: readonly SqlValue[]): SqlRow[] {
    const count = /^SELECT COUNT\(\*\) AS "n" FROM "([^"]+)"( WHERE .*)?$/.exec(sql);
    if (count?.[1] !== undefined) {
      const table = tableOf(count[1]);
      const conditions = parseWhere(count[2]);
      const n = table.rows.filter((row) => matches(table, row, conditions, params, 0)).length;
      return [{ n }];
    }
    const full =
      /^SELECT \* FROM "([^"]+)"( WHERE .+?)?( ORDER BY .+?)?( LIMIT (?:\?|\d+)(?: OFFSET \?)?)?$/.exec(
        sql,
      );
    if (full?.[1] === undefined) throw new Bug(`fake sql: unsupported select ${sql}`);
    const table = tableOf(full[1]);
    const conditions = parseWhere(full[2]);
    let rows = table.rows.filter((row) => matches(table, row, conditions, params, 0));
    const orderBy = full[3]?.replace(/^\s*ORDER BY\s+/, "");
    if (orderBy !== undefined) {
      const orders = splitTop(orderBy).map((part) => {
        const match = /^"([^"]+)" (ASC|DESC)$/.exec(part);
        if (match?.[1] === undefined) throw new Bug(`fake sql: unsupported order ${part}`);
        return { column: match[1], desc: match[2] === "DESC" };
      });
      rows = rows.toSorted((a, b) => {
        for (const order of orders) {
          const left = a[order.column] ?? null;
          const right = b[order.column] ?? null;
          if (left === right) continue;
          const result = (left ?? "") < (right ?? "") ? -1 : 1;
          return order.desc ? -result : result;
        }
        return 0;
      });
    }
    const limit = full[4];
    if (limit !== undefined) {
      const used = conditions.filter((condition) => !condition.isNull).length;
      const limitValue = params[used];
      const offsetValue = limit.includes("OFFSET") ? params[used + 1] : 0;
      const from = typeof offsetValue === "number" ? offsetValue : 0;
      const take = typeof limitValue === "number" ? limitValue : rows.length;
      rows = rows.slice(from, from + take);
    }
    return rows.map((row) => Object.assign({}, row));
  }

  function run(sql: string, params: readonly SqlValue[] = []): { readonly changes: number } {
    statements.push(sql);
    const createTable = /^CREATE TABLE IF NOT EXISTS "([^"]+)" \((.*)\) STRICT$/.exec(sql);
    if (createTable?.[1] !== undefined && createTable[2] !== undefined) {
      if (tables.has(createTable[1])) return { changes: 0 };
      const columns: string[] = [];
      const notNull = new Set<string>();
      let primaryKey: string[] = [];
      for (const part of splitTop(createTable[2])) {
        const pk = /^PRIMARY KEY \((.*)\)$/.exec(part);
        if (pk?.[1] !== undefined) {
          primaryKey = splitTop(pk[1]).map(unquote);
          continue;
        }
        const column = /^"([^"]+)" (TEXT|INTEGER|REAL|BLOB)( NOT NULL)?$/.exec(part);
        if (column?.[1] === undefined) throw new Bug(`fake sql: unsupported column ${part}`);
        columns.push(column[1]);
        if (column[3] !== undefined) notNull.add(column[1]);
      }
      tables.set(createTable[1], { columns, notNull, primaryKey, rows: [] });
      return { changes: 0 };
    }
    const createIndex = /^CREATE INDEX IF NOT EXISTS "([^"]+)" ON "([^"]+)" \((.*)\)$/.exec(sql);
    if (createIndex?.[2] !== undefined) {
      tableOf(createIndex[2]);
      return { changes: 0 };
    }
    const insert = /^INSERT( OR REPLACE)? INTO "([^"]+)" \((.*?)\) VALUES \((.*)\)$/.exec(sql);
    if (insert?.[2] !== undefined && insert[3] !== undefined) {
      const table = tableOf(insert[2]);
      const names = splitTop(insert[3]).map(unquote);
      const row: Record<string, SqlValue> = {};
      names.forEach((name, index) => {
        if (!table.columns.includes(name)) throw new Error(`table has no column ${name}`);
        row[name] = params[index] ?? null;
      });
      for (const column of table.columns) row[column] ??= null;
      for (const column of table.notNull) {
        if (row[column] === null)
          throw new Error(`NOT NULL constraint failed: ${insert[2]}.${column}`);
      }
      const key = keyOf(table, row);
      const existing = table.rows.findIndex((candidate) => keyOf(table, candidate) === key);
      if (existing >= 0) {
        if (insert[1] === undefined) throw new Error(`UNIQUE constraint failed: ${insert[2]}`);
        table.rows[existing] = row;
      } else {
        table.rows.push(row);
      }
      return { changes: 1 };
    }
    const update = /^UPDATE "([^"]+)" SET (.*?)( WHERE .*)?$/.exec(sql);
    if (update?.[1] !== undefined && update[2] !== undefined) {
      const table = tableOf(update[1]);
      const sets = splitTop(update[2]).map((part) => {
        const match = /^"([^"]+)" = \?$/.exec(part);
        if (match?.[1] === undefined) throw new Bug(`fake sql: unsupported set ${part}`);
        return match[1];
      });
      const conditions = parseWhere(update[3]);
      let changes = 0;
      for (const row of table.rows) {
        if (!matches(table, row, conditions, params, sets.length)) continue;
        sets.forEach((column, index) => {
          row[column] = params[index] ?? null;
        });
        changes += 1;
      }
      return { changes };
    }
    const remove = /^DELETE FROM "([^"]+)"( WHERE .*)?$/.exec(sql);
    if (remove?.[1] !== undefined) {
      const table = tableOf(remove[1]);
      const conditions = parseWhere(remove[2]);
      const before = table.rows.length;
      table.rows = table.rows.filter((row) => !matches(table, row, conditions, params, 0));
      return { changes: before - table.rows.length };
    }
    throw new Error(`fake sql: unsupported statement ${sql}`);
  }

  return {
    run,
    get: (sql, params = []) => {
      statements.push(sql);
      return select(sql, params)[0];
    },
    all: (sql, params = []) => {
      statements.push(sql);
      return select(sql, params);
    },
    snapshot() {
      return new Map(
        [...tables].map(([name, table]) => [
          name,
          { ...table, rows: table.rows.map((row) => Object.assign({}, row)) },
        ]),
      );
    },
    restore(snapshot) {
      tables = new Map(
        [...snapshot].map(([name, table]) => [
          name,
          { ...table, rows: table.rows.map((row) => Object.assign({}, row)) },
        ]),
      );
    },
    tableNames: () => [...tables.keys()],
    rowsOf: (table) => tableOf(table).rows.map((row) => Object.assign({}, row)),
    statements,
  };
}
