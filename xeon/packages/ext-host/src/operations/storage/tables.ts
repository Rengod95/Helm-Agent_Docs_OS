import { err, ok, type Result } from "@xeon/contracts";
import type { ExtensionName } from "@xeon/contracts/extensions";
import { extTablePrefix as extTablePrefixOf } from "@xeon/contracts/records";
import type { Static, TObject, TSchema } from "typebox";
import type { ExtStorageError } from "./errors.ts";

/** 지역 이름. 밑줄을 금지해 테이블 이름에서 소유 확장을 한 가지로 읽는다(X.operations.spec §4.4.2) */
const EXT_TABLE_LOCAL_PATTERN = "^[a-z][a-z0-9]{0,31}$";
const EXT_COLUMN_PATTERN = "^[a-z][a-z0-9_]{0,62}$";
/** X가 쓰는 지역 이름. 확장이 정의할 수 없다 */
export const RESERVED_LOCAL_TABLES: readonly string[] = ["state", "meta"];
/** perThread 테이블에 X가 붙이는 열 */
export const THREAD_COLUMN = "thread_id";

const LOCAL_REGEX = new RegExp(EXT_TABLE_LOCAL_PATTERN);
const COLUMN_REGEX = new RegExp(EXT_COLUMN_PATTERN);

export interface ExtTableDef<R extends TObject = TObject> {
  /** 행 스키마. 속성 이름이 열 이름이다 */
  readonly row: R;
  /** 기본 키 열 */
  readonly key: readonly [keyof Static<R> & string, ...(keyof Static<R> & string)[]];
  readonly indexes?: readonly (readonly [
    keyof Static<R> & string,
    ...(keyof Static<R> & string)[],
  ])[];
  /** 참이면 thread_id 열을 붙이고 기본 키 앞에 둔다. 세션 삭제 때 그 행을 지운다 */
  readonly perThread: boolean;
}

export type ExtTableDefs = Readonly<Record<string, ExtTableDef>>;

/** "x_" + 하이픈을 밑줄로 바꾼 확장 이름 + "_". F `extTablePrefix`가 정본이다 */
export function extTablePrefix(name: ExtensionName): string {
  return extTablePrefixOf(name);
}

export function extTableName(name: ExtensionName, local: string): string {
  return `${extTablePrefix(name)}${local}`;
}

const TABLE_REGEX = /^x_([a-z0-9_]+)_([a-z][a-z0-9]{0,31})$/;

/**
 * 접두 규칙의 역함수. 확장 이름에는 밑줄이 없고 지역 이름에도 없으므로 마지막 밑줄 뒤가 지역 이름이다.
 * 형식이 맞지 않으면 undefined
 */
export function parseExtTableName(
  table: string,
): { readonly extension: ExtensionName; readonly local: string } | undefined {
  const match = TABLE_REGEX.exec(table);
  const joined = match?.[1];
  const local = match?.[2];
  if (joined === undefined || local === undefined) return undefined;
  const extension = joined.replaceAll("_", "-");
  return { extension, local };
}

type SqlColumnType = "TEXT" | "INTEGER" | "REAL" | "BLOB";

export interface ColumnType {
  readonly sql: SqlColumnType;
  /** 스키마가 null을 값으로 허용한다(null 포함 유니온). 읽을 때 NULL을 null로 되살린다 */
  readonly acceptsNull: boolean;
  /** JSON.stringify로 저장하고 읽을 때 되살린다 */
  readonly json: boolean;
  /** 불리언은 0·1로 저장한다 */
  readonly boolean: boolean;
  readonly nullable: boolean;
}

function typeNameOf(schema: TSchema): string | undefined {
  const type: unknown = Reflect.get(schema, "type");
  return typeof type === "string" ? type : undefined;
}

function anyOfOf(schema: TSchema): readonly TSchema[] | undefined {
  const union: unknown = Reflect.get(schema, "anyOf");
  return Array.isArray(union) ? union : undefined;
}

/** 열 타입 대응(§4.4.3). 대응할 수 없는 스키마면 undefined. optional 여부는 호출자가 nullable에 합친다 */
export function columnTypeOf(schema: TSchema): ColumnType | undefined {
  const members = anyOfOf(schema);
  if (members !== undefined) {
    const nonNull = members.filter((member) => typeNameOf(member) !== "null");
    const hasNull = nonNull.length !== members.length;
    const [only] = nonNull;
    if (nonNull.length === 1 && only !== undefined) {
      const inner = columnTypeOf(only);
      return inner === undefined
        ? undefined
        : {
            ...inner,
            nullable: inner.nullable || hasNull,
            acceptsNull: inner.acceptsNull || hasNull,
          };
    }
    // 둘 이상의 구성원은 JSON 문자열로 저장한다
    return nonNull.length === 0
      ? undefined
      : { sql: "TEXT", acceptsNull: hasNull, json: true, boolean: false, nullable: hasNull };
  }
  switch (typeNameOf(schema)) {
    case "string":
      return { sql: "TEXT", acceptsNull: false, json: false, boolean: false, nullable: false };
    case "integer":
      return { sql: "INTEGER", acceptsNull: false, json: false, boolean: false, nullable: false };
    case "number":
      return { sql: "REAL", acceptsNull: false, json: false, boolean: false, nullable: false };
    case "boolean":
      return { sql: "INTEGER", acceptsNull: false, json: false, boolean: true, nullable: false };
    case "object":
    case "array":
      return { sql: "TEXT", acceptsNull: false, json: true, boolean: false, nullable: false };
    case undefined:
    // xeon-disable-next-line xeon/switch-default-never -- TypeBox type 이름은 열린 문자열이다. 지원 밖 타입은 undefined로 돌려주고 호출자가 선언 오류로 바꾼다 (eng.typescript.guide TY-14)
    default:
      return undefined;
  }
}

function quote(identifier: string): string {
  return `"${identifier}"`;
}

/** 행 스키마의 열 정의. thread_id는 perThread에서만 X가 붙인다 */
export function columnsOf(
  def: ExtTableDef,
  table: string,
): Result<readonly { readonly name: string; readonly type: ColumnType }[], ExtStorageError> {
  const properties: Readonly<Record<string, TSchema>> = def.row.properties;
  const requiredRaw: unknown = Reflect.get(def.row, "required");
  const required = new Set<string>(
    Array.isArray(requiredRaw) ? requiredRaw.filter((item) => typeof item === "string") : [],
  );
  const columns: { name: string; type: ColumnType }[] = [];
  for (const [name, schema] of Object.entries(properties)) {
    // sqlite_ 접두는 SQLite 내부용이라 열 이름에서도 막는다. 방어 검사(checkStatement)가 문장 어디서든 거부하는 이름이다
    if (
      !COLUMN_REGEX.test(name) ||
      name.startsWith("sqlite_") ||
      (def.perThread && name === THREAD_COLUMN)
    ) {
      return err({ kind: "identifier_invalid", name });
    }
    const type = columnTypeOf(schema);
    if (type === undefined) return err({ kind: "column_type_unsupported", table, column: name });
    columns.push({ name, type: { ...type, nullable: type.nullable || !required.has(name) } });
  }
  return ok(columns);
}

/** 순수 함수. CREATE TABLE·CREATE INDEX 문장. 식별자는 모두 검사한 뒤 큰따옴표로 감싼다 */
export function tableDdl(
  name: ExtensionName,
  local: string,
  def: ExtTableDef,
): Result<readonly string[], ExtStorageError> {
  if (!LOCAL_REGEX.test(local)) return err({ kind: "identifier_invalid", name: local });
  if (RESERVED_LOCAL_TABLES.includes(local)) return err({ kind: "reserved_table", local });
  const table = extTableName(name, local);
  const columns = columnsOf(def, table);
  if (!columns.ok) return columns;
  const known = new Set(columns.value.map((column) => column.name));
  for (const column of [...def.key, ...(def.indexes ?? []).flat()]) {
    if (!known.has(column)) return err({ kind: "identifier_invalid", name: column });
  }
  const parts = [
    ...(def.perThread ? [`${quote(THREAD_COLUMN)} TEXT NOT NULL`] : []),
    ...columns.value.map(
      (column) =>
        `${quote(column.name)} ${column.type.sql}${column.type.nullable ? "" : " NOT NULL"}`,
    ),
  ];
  const keyColumns = [...(def.perThread ? [THREAD_COLUMN] : []), ...def.key];
  parts.push(`PRIMARY KEY (${keyColumns.map(quote).join(", ")})`);
  const statements = [`CREATE TABLE IF NOT EXISTS ${quote(table)} (${parts.join(", ")}) STRICT`];
  (def.indexes ?? []).forEach((columnsOfIndex, index) => {
    statements.push(
      `CREATE INDEX IF NOT EXISTS ${quote(`${table}__i${index + 1}`)} ON ${quote(table)} (${columnsOfIndex.map(quote).join(", ")})`,
    );
  });
  return ok(statements);
}
