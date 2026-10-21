import { Bug } from "@xeon/contracts";
import type { SqlRow } from "@xeon/contracts/records";

/** SqlRow의 열을 좁히는 도우미. 모양이 다르면 저장된 데이터와 코드가 맞지 않는 것이라 Bug다 */
export function columnString(row: SqlRow, key: string): string {
  const cell = row[key];
  if (typeof cell !== "string") throw new Bug(`store.row_invalid: column ${key} is not a string`);
  return cell;
}

export function columnNullableString(row: SqlRow, key: string): string | null {
  const cell = row[key];
  if (cell === null || cell === undefined) return null;
  return columnString(row, key);
}

export function columnInt(row: SqlRow, key: string): number {
  const cell = row[key];
  if (typeof cell === "number") return cell;
  if (typeof cell === "bigint") return Number(cell);
  throw new Bug(`store.row_invalid: column ${key} is not an integer`);
}

export function columnNullableInt(row: SqlRow, key: string): number | null {
  const cell = row[key];
  if (cell === null || cell === undefined) return null;
  return columnInt(row, key);
}

export function columnBool(row: SqlRow, key: string): boolean {
  return columnInt(row, key) !== 0;
}
