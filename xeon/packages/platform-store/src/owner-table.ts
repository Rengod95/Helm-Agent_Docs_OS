import { Bug } from "@xeon/contracts";
import type { SqlTx } from "@xeon/contracts/records";
import { coreOwnerSpecs, type OwnerKind, type OwnerSpec } from "./prefix.ts";
import { columnString, toSqlRow } from "./rows.ts";
import type { SqliteConnection } from "./sqlite-env.ts";

function parseNames(raw: string): readonly string[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Bug("store.prefix_table_invalid: sys_prefixes.names is not a string array");
  }
  return parsed.filter((item): item is string => typeof item === "string");
}

function parseKind(raw: string): OwnerKind {
  if (raw === "core" || raw === "extension") return raw;
  throw new Bug(`store.prefix_table_invalid: unknown kind ${raw}`);
}

/** sys_prefixes에서 소유자 한 곳의 이름 집합을 읽는다. 없으면 undefined */
export function readOwnerSpec(db: SqliteConnection, owner: string): OwnerSpec | undefined {
  const row = db
    .query<unknown, [string]>("SELECT owner, kind, names FROM sys_prefixes WHERE owner = ?")
    .get(owner);
  if (row === null) return undefined;
  const cells = toSqlRow(row);
  return {
    owner: columnString(cells, "owner"),
    kind: parseKind(columnString(cells, "kind")),
    names: parseNames(columnString(cells, "names")),
  };
}

/** 코어 소유자 표를 sys_prefixes에 맞춘다(열기 6단계). 확장 행은 건드리지 않는다 */
export function syncCoreOwners(tx: SqlTx, now: number): void {
  for (const spec of coreOwnerSpecs()) {
    tx.run(
      `INSERT INTO sys_prefixes (owner, kind, names, registered_at) VALUES (?, 'core', ?, ?)
       ON CONFLICT(owner) DO UPDATE SET names = excluded.names WHERE kind = 'core'`,
      [spec.owner, JSON.stringify(spec.names), now],
    );
  }
}
