import { Bug, err, ok, type Result } from "@xeon/contracts";
import type { LeaseRowInvalid, SqlRow, SqlValue } from "@xeon/contracts/records";

function isSqlValue(value: unknown): value is SqlValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  );
}

// 드라이버가 돌려준 행과 PRAGMA 결과의 모양은 코드가 쓴 SQL이 정한다. 다르면 코드나 드라이버의 결함이라 Bug다(store.engine_shape).
// 사용자 데이터가 든 표(sys_leases)의 행은 손상될 수 있어 아래 leaseColumns가 값으로 돌려준다.

/** bun:sqlite가 돌려준 행(unknown)을 SqlRow로 검증해 좁힌다. 모양이 다르면 버그다 */
export function toSqlRow(value: unknown): SqlRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Bug("store.engine_shape: a row must be an object");
  }
  const row: Record<string, SqlValue> = {};
  for (const [key, cell] of Object.entries(value)) {
    if (!isSqlValue(cell))
      throw new Bug(`store.engine_shape: column ${key} has an unsupported type`);
    row[key] = cell;
  }
  return row;
}

export function columnString(row: SqlRow, key: string): string {
  const cell = row[key];
  if (typeof cell !== "string") throw new Bug(`store.engine_shape: column ${key} is not a string`);
  return cell;
}

export function columnInt(row: SqlRow, key: string): number {
  const cell = row[key];
  if (typeof cell === "number") return cell;
  if (typeof cell === "bigint") return Number(cell);
  throw new Bug(`store.engine_shape: column ${key} is not an integer`);
}

export function columnNullableInt(row: SqlRow, key: string): number | null {
  const cell = row[key];
  if (cell === null) return null;
  return columnInt(row, key);
}

/** sys_leases 행의 열 읽기. 저장된 값이 모양과 다르면(손상, 수동 편집) 예상 가능한 실패라 값으로 돌려준다(TY-24) */
export interface LeaseColumns {
  string(key: string): Result<string, LeaseRowInvalid>;
  int(key: string): Result<number, LeaseRowInvalid>;
  nullableInt(key: string): Result<number | null, LeaseRowInvalid>;
}

function leaseFault(key: string): LeaseRowInvalid {
  return { kind: "row_invalid", where: `sys_leases.${key}` };
}

export function leaseColumns(row: SqlRow): LeaseColumns {
  const int = (key: string): Result<number, LeaseRowInvalid> => {
    const cell = row[key];
    if (typeof cell === "number") return ok(cell);
    if (typeof cell === "bigint") return ok(Number(cell));
    return err(leaseFault(key));
  };
  return {
    string(key) {
      const cell = row[key];
      return typeof cell === "string" ? ok(cell) : err(leaseFault(key));
    },
    int,
    nullableInt: (key) => (row[key] === null ? ok(null) : int(key)),
  };
}
