import type { TableColumn } from "@fresnel/client/settings";
import { assertNever, err, ok, type Result } from "@fresnel/contracts";

// 표 위젯(L4.settings-ui §4.2.1)의 순수 모델. 세 모양을 다룬다.
// rows: 객체 배열, 행마다 열이 한 칸씩이다. record: 이름 → 값 맵, 이름마다 한 줄이다. fixed: 속성이 고정된 객체, 속성마다 한 줄이다.
// 쓰기는 항목 값 전체를 `handlers.edit`으로 보낸다(깊은 병합 없음, P-09 초안 흐름). 중첩 값 열(json)은 읽기만 하고 원래 값을 그대로 둔다.

export type Row = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** rows 모양의 값: 객체 배열. 원소가 객체가 아니면 `null`이다 */
export function rowsOf(value: unknown): readonly Row[] | null {
  if (!isList(value)) return null;
  const rows: Row[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    rows.push(item);
  }
  return rows;
}

/** record와 fixed 모양의 값: 객체. 배열이거나 객체가 아니면 `null`이다 */
export function recordOf(value: unknown): Row | null {
  return isRecord(value) ? value : null;
}

/** 열 하나의 기본 값. 중첩 값 열은 기본이 없어서 `undefined`다(새 행에 넣지 않는다) */
export function defaultCellOf(column: TableColumn): unknown {
  switch (column.kind) {
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "enum":
      return column.options?.[0] ?? null;
    case "json":
      return undefined;
    default:
      return assertNever(column.kind, "TableColumn");
  }
}

/** 새 행. 기본 값이 있는 열만 넣는다 */
export function newRowOf(columns: readonly TableColumn[]): Row {
  return Object.fromEntries(
    columns.flatMap((column): [string, unknown][] => {
      const value = defaultCellOf(column);
      return value === undefined ? [] : [[column.name, value]];
    }),
  );
}

/** 그릴 행 하나. 키는 내용으로 정한다(같은 내용의 행은 번호를 더한다). `index`는 고칠 때 쓰는 자리다 */
export interface KeyedRow {
  readonly key: string;
  readonly index: number;
  readonly row: Row;
}

/** 행마다 그릴 키를 붙인다. 행을 고치면 그 행만 새 키를 받는다 */
export function keyedRowsOf(rows: readonly Row[]): readonly KeyedRow[] {
  const seen = new Map<string, number>();
  return rows.map((row, index) => {
    const text = JSON.stringify(row);
    const count = seen.get(text) ?? 0;
    seen.set(text, count + 1);
    return { key: `${text}#${count}`, index, row };
  });
}

/** 행 하나의 칸을 바꾼다. 다른 칸(중첩 값 열 포함)은 그대로다 */
export function withCell(
  rows: readonly Row[],
  index: number,
  name: string,
  value: unknown,
): readonly Row[] {
  return rows.map((row, at) => (at === index ? { ...row, [name]: value } : row));
}

/** 행을 끝에 더한다. 최대 개수에 닿았으면 그대로다 */
export function withRowAdded(
  rows: readonly Row[],
  columns: readonly TableColumn[],
  maxItems: number | null,
): readonly Row[] {
  if (maxItems !== null && rows.length >= maxItems) return rows;
  return [...rows, newRowOf(columns)];
}

export function withoutRow(rows: readonly Row[], index: number): readonly Row[] {
  return rows.toSpliced(index, 1);
}

/** 속성 하나를 바꾸거나 넣는다(record, fixed) */
export function withField(record: Row, name: string, value: unknown): Row {
  return { ...record, [name]: value };
}

export function withoutField(record: Row, name: string): Row {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== name));
}

export type NameIssue = "empty" | "duplicate";

/** record 항목의 새 이름. 비었거나 이미 있으면 실패다 */
export function checkRecordName(text: string, record: Row): Result<string, NameIssue> {
  const name = text.trim();
  if (name === "") return err("empty");
  if (Object.hasOwn(record, name)) return err("duplicate");
  return ok(name);
}

/** 열이 편집할 수 있는 원시 값인가. 중첩 값(json)은 읽기 글로만 보인다 */
export function isEditableColumn(column: TableColumn): boolean {
  return column.kind !== "json";
}
