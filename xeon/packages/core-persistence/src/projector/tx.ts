import type { ProjectionTx, SqlRow, SqlTx, SqlValue } from "@xeon/contracts/records";

/** 커밋 트랜잭션의 SqlTx를 투영기용 핸들로 감싼다. 투영기는 변경 건수를 보지 않는다 */
export function toProjectionTx(tx: SqlTx): ProjectionTx {
  return {
    run(sql: string, params?: readonly SqlValue[]): void {
      tx.run(sql, params);
    },
    get(sql: string, params?: readonly SqlValue[]): SqlRow | undefined {
      return tx.get(sql, params);
    },
    all(sql: string, params?: readonly SqlValue[]): readonly SqlRow[] {
      return tx.all(sql, params);
    },
  };
}
