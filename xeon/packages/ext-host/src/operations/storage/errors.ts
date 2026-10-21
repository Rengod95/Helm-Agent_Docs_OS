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
