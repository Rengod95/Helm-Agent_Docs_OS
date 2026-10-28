import { err, ok, type Result } from "@xeon/contracts";
import type { SqlRow } from "@xeon/contracts/records";

// 우리 표의 행을 읽는 작은 도우미. 저장된 값이 모양과 다르면(손상, 수동 편집) 예상 가능한 실패라 값으로 돌려준다(TY-24).

export type RowInvalid = { readonly kind: "row_invalid"; readonly column: string };

export function stringCell(row: SqlRow, column: string): Result<string, RowInvalid> {
  const cell = row[column];
  return typeof cell === "string" ? ok(cell) : err({ kind: "row_invalid", column });
}

export function nullableStringCell(row: SqlRow, column: string): Result<string | null, RowInvalid> {
  const cell = row[column];
  if (cell === null || cell === undefined) return ok(null);
  return typeof cell === "string" ? ok(cell) : err({ kind: "row_invalid", column });
}

export function numberCell(row: SqlRow, column: string): Result<number, RowInvalid> {
  const cell = row[column];
  if (typeof cell === "number") return ok(cell);
  if (typeof cell === "bigint") return ok(Number(cell));
  return err({ kind: "row_invalid", column });
}
