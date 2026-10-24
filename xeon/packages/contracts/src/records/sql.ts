// 이 파일은 다른 records 파일을 import하지 않는다(F.records.spec §3.9).
export type SqlValue = string | number | bigint | Uint8Array | null;
export type SqlRow = Readonly<Record<string, SqlValue>>;

export interface SqlTx {
  run(sql: string, params?: readonly SqlValue[]): { readonly changes: number };
  get(sql: string, params?: readonly SqlValue[]): SqlRow | undefined;
  all(sql: string, params?: readonly SqlValue[]): readonly SqlRow[];
}
