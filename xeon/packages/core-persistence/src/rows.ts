import { err, ok, parse, type Result } from "@xeon/contracts";
import { isId, type IdByPrefix, type IdPrefix } from "@xeon/contracts/conversation";
import type { ReadFailure, SqlRow, SqlTx, StoreDb, StoreError } from "@xeon/contracts/records";
import type { Static, TSchema } from "typebox";

// SqlRow의 열을 좁히는 도우미. 저장된 값이 모양과 다르면(손상, 수동 편집, 이전 버전) 코드가 고칠 수 없는 입력이라
// 예상 가능한 실패다. Bug로 던지지 않고 row_invalid 값으로 돌려준다(eng.typescript.guide TY-24).

export type RowFault = Extract<StoreError, { readonly kind: "row_invalid" }>;

export function rowInvalid(where: string): RowFault {
  return { kind: "row_invalid", where };
}

/** 한 표의 행에서 열을 읽는 묶음. 실패 위치는 `<표>.<열>`로 이름을 단다 */
export interface Columns {
  string(key: string): Result<string, RowFault>;
  nullableString(key: string): Result<string | null, RowFault>;
  int(key: string): Result<number, RowFault>;
  nullableInt(key: string): Result<number | null, RowFault>;
  bool(key: string): Result<boolean, RowFault>;
  /** 브랜드 ID 열. 접두와 형식이 맞아야 한다 */
  id<P extends IdPrefix>(prefix: P, key: string): Result<IdByPrefix[P], RowFault>;
  nullableId<P extends IdPrefix>(prefix: P, key: string): Result<IdByPrefix[P] | null, RowFault>;
  /** 문자열 열을 스키마로 검증한다(열거형 문자열 등) */
  parsed<S extends TSchema>(schema: S, key: string): Result<Static<S>, RowFault>;
}

export function columns(row: SqlRow, table: string): Columns {
  const where = (key: string): string => `${table}.${key}`;
  const string = (key: string): Result<string, RowFault> => {
    const cell = row[key];
    return typeof cell === "string" ? ok(cell) : err(rowInvalid(where(key)));
  };
  const int = (key: string): Result<number, RowFault> => {
    const cell = row[key];
    if (typeof cell === "number") return ok(cell);
    if (typeof cell === "bigint") return ok(Number(cell));
    return err(rowInvalid(where(key)));
  };
  const isAbsent = (key: string): boolean => row[key] === null || row[key] === undefined;
  const id = <P extends IdPrefix>(prefix: P, key: string): Result<IdByPrefix[P], RowFault> => {
    const cell = row[key];
    return isId(prefix, cell) ? ok(cell) : err(rowInvalid(where(key)));
  };
  return {
    string,
    int,
    id,
    nullableString: (key) => (isAbsent(key) ? ok(null) : string(key)),
    nullableInt: (key) => (isAbsent(key) ? ok(null) : int(key)),
    bool(key) {
      const value = int(key);
      return value.ok ? ok(value.value !== 0) : value;
    },
    nullableId: (prefix, key) => (isAbsent(key) ? ok(null) : id(prefix, key)),
    parsed(schema, key) {
      const parsedValue = parse(schema, row[key]);
      return parsedValue.ok ? parsedValue : err(rowInvalid(where(key)));
    },
  };
}

/** 읽기 트랜잭션. fn이 돌려준 손상 행 오류까지 한 Result로 합친다 */
export function readResult<T>(
  db: Pick<StoreDb, "read">,
  fn: (tx: SqlTx) => Result<T, RowFault>,
): Result<T, ReadFailure> {
  const read = db.read(fn);
  if (!read.ok) return read;
  return read.value;
}
