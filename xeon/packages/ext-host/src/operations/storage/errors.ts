import type { ExtensionName } from "@xeon/contracts/extensions";

export type ExtStorageError =
  | { readonly kind: "identifier_invalid"; readonly name: string }
  | { readonly kind: "reserved_table"; readonly local: string }
  | { readonly kind: "table_owned"; readonly table: string; readonly owner: ExtensionName }
  /** dropExtension이 넘긴 이름을 store가 그 확장 소유로 판정하지 않음(L0.store.spec table_not_owned, §4.4.7) */
  | { readonly kind: "table_not_owned"; readonly table: string }
  | { readonly kind: "column_type_unsupported"; readonly table: string; readonly column: string }
  | { readonly kind: "kind_not_owned"; readonly eventKind: string }
  | { readonly kind: "already_defined" }
  | { readonly kind: "isolated" }
  | { readonly kind: "busy" }
  /** 투영기 등록·접두 테이블 포트를 얻지 못함 */
  | { readonly kind: "port_unavailable"; readonly port: string };

/**
 * 확장 테이블 읽기·쓰기 API의 오류(review.open-issues N-08). 행 값이 선언과 다른 경우는 확장 코드 결함이 아니라
 * 데이터 문제라 값으로 돌려준다(eng.typescript.guide TY-24)
 */
export type ExtRowError =
  /** 확장이 쓰려는 행이 `ExtTableDef.row` 스키마와 다르다(범위, 패턴 같은 형 검사 밖의 제약 포함) */
  | { readonly kind: "row_invalid"; readonly table: string }
  /** 저장된 행이 `ExtTableDef.row` 스키마와 다르다(손상, 수동 편집, 이전 버전) */
  | { readonly kind: "row_corrupt"; readonly table: string };
