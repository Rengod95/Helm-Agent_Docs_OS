import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { TableColumn } from "@fresnel/client/settings";
import { renderToString } from "react-dom/server";
import {
  FixedTableView,
  RecordTableView,
  RowsTableView,
  SecretRefView,
  UnreadableEditorNote,
  type FixedTableViewProps,
  type RecordTableViewProps,
  type RowsTableViewProps,
  type SecretRefViewProps,
} from "../../src/views/pages/settings/settings-editors-view.tsx";

// 설정 전용 편집기의 서버 렌더. 빈 상태, 채워진 상태, 오류 문장, 잠긴(오프라인) 상태를 그린다.
// 문장은 `t()`로 비교하고, 값 글자는 그대로 비교한다. 잠긴 상태는 입력 칸에 `disabled`가 붙는다.

const NOOP = (): void => undefined;

/** 고르기 칸의 단추 표식. 고른 글과 옵션은 마운트 뒤에 그려져 서버 렌더에는 없다 */
const SELECT_TRIGGER = 'data-slot="select-trigger"';

function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

const COLUMNS: readonly TableColumn[] = [
  { name: "name", kind: "string", options: null, required: true },
  { name: "mode", kind: "enum", options: ["fast", "slow"], required: false },
  { name: "nested", kind: "json", options: null, required: false },
];

// 키가 카탈로그에 없으면 열 머리는 열 이름 그대로다(열 이름 글을 시험에서 그대로 찾는다)
const UNKNOWN_TABLE_KEY = "l9.fixture.table";

function rowsProps(
  rows: RowsTableViewProps["rows"],
  over: Partial<RowsTableViewProps> = {},
): RowsTableViewProps {
  return {
    settingKey: UNKNOWN_TABLE_KEY,
    columns: COLUMNS,
    rows,
    maxItems: null,
    editable: true,
    error: null,
    onCell: NOOP,
    onAdd: NOOP,
    onRemove: NOOP,
    ...over,
  };
}

describe("RowsTableView", () => {
  test("column headers show the catalog sentence of the setting's column", () => {
    const columns: readonly TableColumn[] = [
      { name: "id", kind: "string", options: null, required: true },
      { name: "apiKeyRef", kind: "string", options: null, required: false },
    ];
    const html = renderToString(
      <RowsTableView
        {...rowsProps([{ id: "anthropic", apiKeyRef: null }], {
          settingKey: "l1.models.providers",
          columns,
        })}
      />,
    );
    expect(html).toContain("API 키(시크릿 참조)");
    expect(html).not.toContain("apiKeyRef");
  });

  test("no row says so and the add button is there", () => {
    const html = renderToString(<RowsTableView {...rowsProps([])} />);
    expect(html).toContain(t("desktop.settings.table.empty"));
    expect(html).toContain(t("desktop.settings.table.add.button"));
  });

  test("a row shows its cells, and a nested cell is text only", () => {
    const html = renderToString(
      <RowsTableView {...rowsProps([{ name: "alpha", mode: "fast", nested: { x: 1 } }])} />,
    );
    expect(html).toContain('value="alpha"');
    expect(countOf(html, SELECT_TRIGGER)).toBe(1);
    expect(html).toContain("&quot;x&quot;:1");
  });

  test("the add button is disabled at the maximum", () => {
    const html = renderToString(<RowsTableView {...rowsProps([{ name: "a" }], { maxItems: 1 })} />);
    expect(html).toContain("disabled");
  });

  test("a refused edit shows its sentence", () => {
    const html = renderToString(
      <RowsTableView {...rowsProps([], { error: t("desktop.settings.table.issue.nameEmpty") })} />,
    );
    expect(html).toContain(t("desktop.settings.table.issue.nameEmpty"));
  });

  test("a locked view disables the cells", () => {
    const html = renderToString(
      <RowsTableView {...rowsProps([{ name: "a" }], { editable: false })} />,
    );
    expect(html).toContain("disabled");
  });
});

function recordProps(
  entries: RecordTableViewProps["entries"],
  over: Partial<RecordTableViewProps> = {},
): RecordTableViewProps {
  return {
    valueColumn: { name: "value", kind: "string", options: null, required: true },
    entries,
    editable: true,
    draftName: "",
    error: null,
    onDraftName: NOOP,
    onAdd: NOOP,
    onValue: NOOP,
    onRemove: NOOP,
    ...over,
  };
}

describe("RecordTableView", () => {
  test("no entry says so", () => {
    const html = renderToString(<RecordTableView {...recordProps([])} />);
    expect(html).toContain(t("desktop.settings.table.empty"));
    expect(html).toContain(t("desktop.settings.table.name.placeholder"));
  });

  test("an entry shows its name and value", () => {
    const html = renderToString(<RecordTableView {...recordProps([["theme", "dark"]])} />);
    expect(html).toContain("theme");
    expect(html).toContain('value="dark"');
  });

  test("a refused name shows its sentence", () => {
    const html = renderToString(
      <RecordTableView
        {...recordProps([], { error: t("desktop.settings.table.issue.nameDuplicate") })}
      />,
    );
    expect(html).toContain(t("desktop.settings.table.issue.nameDuplicate"));
  });

  test("a locked view disables the value cells", () => {
    const html = renderToString(
      <RecordTableView {...recordProps([["theme", "dark"]], { editable: false })} />,
    );
    expect(html).toContain("disabled");
  });
});

describe("FixedTableView", () => {
  const columns: readonly TableColumn[] = [
    { name: "low", kind: "integer", options: null, required: true },
    { name: "high", kind: "integer", options: null, required: true },
  ];

  function fixedProps(over: Partial<FixedTableViewProps> = {}): FixedTableViewProps {
    return {
      settingKey: UNKNOWN_TABLE_KEY,
      columns,
      values: { low: 1, high: 3 },
      editable: true,
      error: null,
      onCell: NOOP,
      ...over,
    };
  }

  test("each property shows as one line with its value", () => {
    const html = renderToString(<FixedTableView {...fixedProps()} />);
    expect(html).toContain("low");
    expect(html).toContain("high");
    expect(html).toContain('value="3"');
  });

  test("a retry property shows its catalog column sentence", () => {
    const retryColumns: readonly TableColumn[] = [
      { name: "maxRetries", kind: "integer", options: null, required: true },
    ];
    const html = renderToString(
      <FixedTableView
        {...fixedProps({
          settingKey: "l1.models.retry",
          columns: retryColumns,
          values: { maxRetries: 3 },
        })}
      />,
    );
    expect(html).toContain("최대 재시도 횟수");
    expect(html).not.toContain("maxRetries");
  });

  test("a refused value shows its sentence", () => {
    const html = renderToString(
      <FixedTableView {...fixedProps({ error: t("desktop.settings.table.unreadable") })} />,
    );
    expect(html).toContain(t("desktop.settings.table.unreadable"));
  });

  test("a locked view disables every line", () => {
    const html = renderToString(<FixedTableView {...fixedProps({ editable: false })} />);
    expect(html).toContain("disabled");
  });
});

function secretProps(over: Partial<SecretRefViewProps> = {}): SecretRefViewProps {
  return {
    status: "ready",
    names: ["b", "a"],
    current: "a",
    editable: true,
    onChoose: NOOP,
    ...over,
  };
}

describe("SecretRefView", () => {
  test("while the list loads, the loading sentence shows", () => {
    const html = renderToString(
      <SecretRefView {...secretProps({ status: "loading", names: [] })} />,
    );
    expect(html).toContain(t("desktop.settings.secretRef.loading"));
  });

  test("a failed list shows its sentence and the current name still shows", () => {
    const html = renderToString(
      <SecretRefView {...secretProps({ status: "failed", names: [] })} />,
    );
    expect(html).toContain(t("desktop.settings.secretRef.failed"));
    expect(countOf(html, SELECT_TRIGGER)).toBe(1);
  });

  test("a ready list with no secret says so", () => {
    const html = renderToString(<SecretRefView {...secretProps({ names: [], current: null })} />);
    expect(html).toContain(t("desktop.settings.secretRef.empty"));
  });

  test("a ready list offers its names in order, with the current one", () => {
    const html = renderToString(<SecretRefView {...secretProps({ names: ["b"], current: "c" })} />);
    expect(countOf(html, SELECT_TRIGGER)).toBe(1);
    expect(html).toContain(`aria-label="${t("desktop.settings.secretRef.label")}"`);
  });

  test("a locked (offline) view disables the choice", () => {
    const html = renderToString(<SecretRefView {...secretProps({ editable: false })} />);
    expect(html).toContain("disabled");
  });
});

describe("UnreadableEditorNote", () => {
  test("it says the value cannot be edited here", () => {
    const html = renderToString(
      <UnreadableEditorNote message={t("desktop.settings.rules.unreadable")} />,
    );
    expect(html).toContain(t("desktop.settings.rules.unreadable"));
  });
});
