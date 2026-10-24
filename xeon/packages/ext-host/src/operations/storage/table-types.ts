import type { Result } from "@xeon/contracts";
import type { Static } from "typebox";
import type { ExtRowError } from "./errors.ts";
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
  /** key 열을 모두 준다. 저장된 행이 선언한 스키마와 다르면 `row_corrupt`다 */
  get(key: Partial<R>): Result<R | undefined, ExtRowError>;
  /** 저장된 행 하나라도 선언한 스키마와 다르면 `row_corrupt`다 */
  list(query?: ExtQuery<R>): Result<readonly R[], ExtRowError>;
  count(where?: Partial<R>): number;
}

export interface ExtTableWriter<R> extends ExtTableReader<R> {
  /** 넘긴 행이 선언한 스키마와 다르면 `row_invalid`이고 아무것도 쓰지 않는다 */
  insert(row: R): Result<void, ExtRowError>;
  upsert(row: R): Result<void, ExtRowError>;
  update(key: Partial<R>, patch: Partial<R>): number;
  delete(key: Partial<R>): number;
}

export type ExtReaders<D extends ExtTableDefs> = {
  readonly [K in keyof D]: ExtTableReader<RowOf<D[K]>>;
};
export type ExtWriters<D extends ExtTableDefs> = {
  readonly [K in keyof D]: ExtTableWriter<RowOf<D[K]>>;
};
