import { Bug } from "@xeon/contracts";
import type { SqlRow, SqlValue } from "@xeon/contracts/records";

function isSqlValue(value: unknown): value is SqlValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  );
}

/** bun:sqlite가 돌려준 행(unknown)을 SqlRow로 검증해 좁힌다. 모양이 다르면 버그다 */
export function toSqlRow(value: unknown): SqlRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Bug("store.row_invalid: a row must be an object");
  }
  const row: Record<string, SqlValue> = {};
  for (const [key, cell] of Object.entries(value)) {
    if (!isSqlValue(cell))
      throw new Bug(`store.row_invalid: column ${key} has an unsupported type`);
    row[key] = cell;
  }
  return row;
}

export function columnString(row: SqlRow, key: string): string {
  const cell = row[key];
  if (typeof cell !== "string") throw new Bug(`store.row_invalid: column ${key} is not a string`);
  return cell;
}

export function columnInt(row: SqlRow, key: string): number {
  const cell = row[key];
  if (typeof cell === "number") return cell;
  if (typeof cell === "bigint") return Number(cell);
  throw new Bug(`store.row_invalid: column ${key} is not an integer`);
}

export function columnNullableInt(row: SqlRow, key: string): number | null {
  const cell = row[key];
  if (cell === null) return null;
  return columnInt(row, key);
}
