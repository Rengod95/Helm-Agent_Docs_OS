import { describe, expect, test } from "bun:test";
import { checkClientValue, type TableColumn } from "@fresnel/client/settings";
import type { SettingDefWire } from "@fresnel/contracts/settings";
import {
  checkRecordName,
  defaultCellOf,
  isEditableColumn,
  keyedRowsOf,
  newRowOf,
  recordOf,
  rowsOf,
  withCell,
  withCellText,
  withField,
  withoutField,
  withoutRow,
  withRowAdded,
} from "../../src/views/pages/settings/settings-table-model.ts";

// 표 모델(L4.settings-ui §4.2.1). 세 모양의 값을 읽고, 쓸 때는 항목 값 전체를 새로 만든다. 중첩 값 열은 기본이 없다.

function column(
  name: string,
  kind: TableColumn["kind"],
  options: TableColumn["options"] = null,
): TableColumn {
  return { name, kind, options, required: false };
}

const COLUMNS: readonly TableColumn[] = [
  column("name", "string"),
  column("mode", "enum", ["fast", "slow"]),
  column("limit", "integer"),
  column("nested", "json"),
];

describe("reading the value", () => {
  test("rows are a list of objects, record and fixed are one object", () => {
    expect(rowsOf([{ name: "a" }, { name: "b" }])).toEqual([{ name: "a" }, { name: "b" }]);
    expect(rowsOf([1])).toBeNull();
    expect(rowsOf({ name: "a" })).toBeNull();
    expect(recordOf({ low: 1 })).toEqual({ low: 1 });
    expect(recordOf([])).toBeNull();
    expect(recordOf(null)).toBeNull();
  });
});

describe("row keys", () => {
  test("a row keeps its index and gets a key from its content", () => {
    expect(keyedRowsOf([{ a: 1 }, { a: 2 }])).toEqual([
      { key: '{"a":1}#0', index: 0, row: { a: 1 } },
      { key: '{"a":2}#0', index: 1, row: { a: 2 } },
    ]);
  });

  test("two equal rows get different keys", () => {
    expect(keyedRowsOf([{ a: 1 }, { a: 1 }]).map((item) => item.key)).toEqual([
      '{"a":1}#0',
      '{"a":1}#1',
    ]);
  });
});

describe("defaults and new rows", () => {
  test("each kind has a default, and a nested column has none", () => {
    expect(defaultCellOf(column("a", "string"))).toBe("");
    expect(defaultCellOf(column("b", "number"))).toBe(0);
    expect(defaultCellOf(column("c", "integer"))).toBe(0);
    expect(defaultCellOf(column("d", "boolean"))).toBe(false);
    expect(defaultCellOf(column("e", "enum", ["fast", "slow"]))).toBe("fast");
    expect(defaultCellOf(column("f", "enum", null))).toBeNull();
    expect(defaultCellOf(column("g", "json"))).toBeUndefined();
  });

  test("a new row has the defaults of its plain columns only", () => {
    expect(newRowOf(COLUMNS)).toEqual({ name: "", mode: "fast", limit: 0 });
  });

  test("a nested column is read-only, the others are editable", () => {
    expect(isEditableColumn(column("nested", "json"))).toBe(false);
    expect(isEditableColumn(column("name", "string"))).toBe(true);
  });
});

describe("edits return whole values", () => {
  test("a cell edit changes one row and keeps the other cells", () => {
    const rows = [
      { name: "a", nested: { deep: 1 } },
      { name: "b", nested: { deep: 2 } },
    ];
    expect(withCell(rows, 1, "name", "c")).toEqual([
      { name: "a", nested: { deep: 1 } },
      { name: "c", nested: { deep: 2 } },
    ]);
  });

  test("a row is added to the end until the maximum", () => {
    const rows = [{ name: "a" }];
    expect(withRowAdded(rows, COLUMNS, null)).toEqual([
      { name: "a" },
      { name: "", mode: "fast", limit: 0 },
    ]);
    expect(withRowAdded(rows, COLUMNS, 1)).toBe(rows);
    expect(withRowAdded(rows, COLUMNS, 2)).toEqual([
      { name: "a" },
      { name: "", mode: "fast", limit: 0 },
    ]);
  });

  test("a row is removed by its index", () => {
    expect(withoutRow([{ a: 1 }, { a: 2 }], 0)).toEqual([{ a: 2 }]);
  });

  test("a field is set or removed in one object", () => {
    expect(withField({ low: 1 }, "high", 3)).toEqual({ low: 1, high: 3 });
    expect(withoutField({ low: 1, high: 3 }, "low")).toEqual({ high: 3 });
  });
});

describe("a new record name", () => {
  test("the name is trimmed, must not be empty, and must be new", () => {
    expect(checkRecordName(" theme ", { color: "x" })).toEqual({ ok: true, value: "theme" });
    expect(checkRecordName("  ", { color: "x" })).toEqual({ ok: false, error: "empty" });
    expect(checkRecordName("color", { color: "x" })).toEqual({ ok: false, error: "duplicate" });
  });
});

// 비울 수 있는 글 열(`Nullable(String)`, 예: `l1.models.providers`의 baseUrl). 빈 칸은 `null`로 저장되고 값 검사를 통과해야 한다(F2)
describe("a text cell that can be cleared", () => {
  const baseUrl: TableColumn = { ...column("baseUrl", "string"), nullable: true };
  const columns: readonly TableColumn[] = [column("id", "string"), baseUrl];
  const providers: SettingDefWire = {
    key: "l1.models.providers",
    runtimeChange: "live",
    layer: "L1",
    allowedScopes: ["user"],
    since: "0.1.0",
    type: {
      type: "array",
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "enabled", "apiKeyRef", "baseUrl"],
        properties: {
          id: { type: "string" },
          enabled: { type: "boolean" },
          apiKeyRef: { anyOf: [{ type: "string" }, { type: "null" }] },
          baseUrl: { anyOf: [{ type: "string", minLength: 1, maxLength: 2048 }, { type: "null" }] },
        },
      },
    },
  };
  const rows = [{ id: "my-llm", enabled: true, apiKeyRef: null, baseUrl: "https://llm.example" }];

  test("clearing the text saves null, and the saved rows pass the value check", () => {
    const next = withCellText(rows, columns, 0, "baseUrl", "");
    expect(next).toEqual([{ id: "my-llm", enabled: true, apiKeyRef: null, baseUrl: null }]);
    expect(checkClientValue(providers, next)).toEqual({ ok: true, value: next });
  });

  test("a text that is typed stays as it is, and a plain text column keeps the empty text", () => {
    expect(withCellText(rows, columns, 0, "baseUrl", "https://a.example")).toEqual([
      { id: "my-llm", enabled: true, apiKeyRef: null, baseUrl: "https://a.example" },
    ]);
    expect(withCellText(rows, columns, 0, "id", "")).toEqual([
      { id: "", enabled: true, apiKeyRef: null, baseUrl: "https://llm.example" },
    ]);
  });

  test("a new row starts with null for the nullable text column and empty for a plain one", () => {
    expect(defaultCellOf(baseUrl)).toBeNull();
    expect(defaultCellOf(column("id", "string"))).toBe("");
  });
});
