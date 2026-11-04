import { expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { FieldVM } from "@fresnel/client/settings";
import { renderToString } from "react-dom/server";
import type { FieldHandlers } from "../../src/views/pages/settings/settings-field.tsx";
import { HookDefsEditor } from "../../src/views/pages/settings/settings-hook-defs.tsx";
import { defOf, fieldIn, settingOf, viewOf } from "./settings-fixtures.ts";

// 외부 훅 편집기의 서버 렌더: 경고가 늘 보이고, 훅 줄에 id와 명령이 보이며, 잠기면 단추가 잠긴다.

const ROWS_TYPE = {
  type: "array",
  items: {
    type: "object",
    properties: { id: { type: "string" }, point: { type: "string" } },
    required: ["id"],
  },
};

function fieldWith(value: unknown): FieldVM {
  const key = "x.operations.hookDefs";
  const def = defOf(key, "plugins", "table", ROWS_TYPE, {}, {});
  const field = fieldIn(viewOf([def], [settingOf(key, value)]), key);
  if (field === undefined) throw new Error("field must exist");
  return field;
}

const noop = (): void => undefined;
const handlers: FieldHandlers = {
  edit: noop,
  change: noop,
  commit: noop,
  discard: noop,
  selectScope: noop,
  reset: noop,
};

test("shows the command warning and each hook with its id and command line", () => {
  const html = renderToString(
    <HookDefsEditor
      field={fieldWith([
        { id: "no-rm", point: "tool.call.before", command: ["./check.sh", "a b"] },
      ])}
      editable
      handlers={handlers}
    />,
  );
  expect(html).toContain(t("desktop.settings.hookDefs.warning"));
  expect(html).toContain("no-rm");
  expect(html).toContain("tool.call.before");
  expect(html).toContain("./check.sh &quot;a b&quot;");
  expect(html).toContain(t("desktop.settings.hookDefs.add.button"));
});

test("an empty value shows the empty note and a read-only field disables add", () => {
  const html = renderToString(
    <HookDefsEditor field={fieldWith([])} editable={false} handlers={handlers} />,
  );
  expect(html).toContain(t("desktop.settings.hookDefs.empty"));
  expect(html).toContain(t("desktop.settings.hookDefs.warning"));
  const addButton = html.slice(0, html.indexOf(t("desktop.settings.hookDefs.add.button")));
  expect(addButton.slice(addButton.lastIndexOf("<button"))).toContain("disabled");
});

test("an unreadable value keeps the warning and explains it", () => {
  const html = renderToString(
    <HookDefsEditor field={fieldWith([{ id: 1 }])} editable handlers={handlers} />,
  );
  expect(html).toContain(t("desktop.settings.hookDefs.warning"));
  expect(html).toContain(t("desktop.settings.table.unreadable"));
});
