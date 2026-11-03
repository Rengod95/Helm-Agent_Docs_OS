import { t } from "@fresnel/client/i18n";
import { Dialog, Kbd, Table, type TableColumn, type TableRow } from "@caustic/react";
import type { ReactNode } from "react";
import type { Keymap } from "./shell/keybindings.ts";
import { shortcutRowsOf } from "./shortcut-help-model.ts";

// 바로 가기 키 도움말(O-09, spec §4.8·§6.20). `help.shortcuts`(⌘/)가 연다. 셸이 처리하지 않는 동작이라 `App`의 `onAction`이 연다.
// 표는 사용자가 바꾼 키를 반영한다(`resolveKeymap`의 결과를 받는다).

export interface ShortcutHelpDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly keymap: Keymap;
  readonly mac: boolean;
}

/** 표 칸의 글. 칸 값은 문자열로 넣었으므로 그 밖의 값은 빈 글이다 */
function cellText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function ShortcutHelpDialog(props: ShortcutHelpDialogProps): ReactNode {
  const rows = shortcutRowsOf(props.keymap, props.mac);
  const columns: TableColumn[] = [
    { key: "action", header: t("desktop.shortcuts.column.action") },
    { key: "keys", header: t("desktop.shortcuts.column.keys"), align: "end" },
  ];
  const tableRows: TableRow[] = rows.map((row) => ({
    id: row.id,
    action: t(row.label),
    keys: row.keys,
  }));
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t("desktop.shortcuts.title")}
      description={t("desktop.shortcuts.description")}
      showClose
      closeLabel={t("desktop.shortcuts.close")}
    >
      <Table
        columns={columns}
        rows={tableRows}
        dividers={false}
        rowLabel={(row) => cellText(row["action"])}
        renderCell={(row, column) =>
          column.key === "keys" ? <Kbd>{cellText(row["keys"])}</Kbd> : cellText(row[column.key])
        }
      />
    </Dialog>
  );
}
