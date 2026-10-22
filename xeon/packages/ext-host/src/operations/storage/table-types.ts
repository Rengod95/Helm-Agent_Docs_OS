import type { Static } from "typebox";
import type { ExtTableDef, ExtTableDefs } from "./tables.ts";

// 확장 테이블 읽기·쓰기 핸들의 공개 타입. ext-storage.ts(구현)와 erase.ts(키별 타입 복원)가 함께 쓴다.

type RowOf<D extends ExtTableDef> = Static<D["row"]>;

export interface ExtQuery<R> {
  /** 열 값 같음 조건의 AND. 범위 조건은 2차 */
  readonly where?: Partial<R>;
  readonly orderBy?: readonly {
    readonly column: keyof R & string;
    readonly dir?: "asc" | "desc";
  }[];
  /** 기본 100, 최대 1000 */
  readonly limit?: number;
  readonly offset?: number;
}

export interface ExtTableReader<R> {
  /** key 열을 모두 준다 */
  get(key: Partial<R>): R | undefined;
  list(query?: ExtQuery<R>): readonly R[];
  count(where?: Partial<R>): number;
}

export interface ExtTableWriter<R> extends ExtTableReader<R> {
  insert(row: R): void;
  upsert(row: R): void;
  update(key: Partial<R>, patch: Partial<R>): number;
  delete(key: Partial<R>): number;
}

export type ExtReaders<D extends ExtTableDefs> = {
  readonly [K in keyof D]: ExtTableReader<RowOf<D[K]>>;
};
export type ExtWriters<D extends ExtTableDefs> = {
  readonly [K in keyof D]: ExtTableWriter<RowOf<D[K]>>;
};
