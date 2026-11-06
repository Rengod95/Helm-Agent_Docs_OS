import { t } from "@fresnel/client/i18n";
import { Button, Dialog, Input, Kbd } from "@caustic/react";
import { Search } from "@caustic/react/icons";
import { useState, type ReactNode } from "react";
import type { Keymap } from "./shell/keybindings.ts";
import {
  filterShortcutRows,
  SHORTCUT_COLUMNS,
  SHORTCUT_GROUP_LABEL_IDS,
  shortcutRowsOf,
  type ShortcutRow,
} from "./shortcut-help-model.ts";

// 바로 가기 키 도움말(O-09, spec §4.8·§6.20). `help.shortcuts`(⌘/)가 연다. 셸이 처리하지 않는 동작이라 `App`의 `onAction`이 연다.
// 모양은 시안 `o09-shortcuts`다: 찾기 칸, 두 열 묶음, 낱키 칩. 사용자가 바꾼 키를 반영한다(`resolveKeymap`의 결과를 받는다).

export interface ShortcutHelpDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly keymap: Keymap;
  readonly mac: boolean;
}

function KeyChips(props: { readonly row: ShortcutRow }): ReactNode {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {props.row.parts.map((part) => (
        <Kbd key={part} size="xs">
          {part}
        </Kbd>
      ))}
    </span>
  );
}

export function ShortcutHelpDialog(props: ShortcutHelpDialogProps): ReactNode {
  const [query, setQuery] = useState("");
  const rows = filterShortcutRows(shortcutRowsOf(props.keymap, props.mac), query, t);
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="lg"
      title={t("desktop.shortcuts.title")}
      footer={
        <>
          <span aria-hidden className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)}>
            {t("desktop.shortcuts.close")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Input
          size="xs"
          variant="soft"
          prefix={<Search />}
          placeholder={t("desktop.shortcuts.search.placeholder")}
          aria-label={t("desktop.shortcuts.search.placeholder")}
          value={query}
          spellCheck={false}
          onValueChange={setQuery}
        />
        {rows.length === 0 ? (
          <p className="m-0 py-6 text-center text-ui-sm text-text-tertiary">
            {t("desktop.shortcuts.empty")}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 max-[760px]:grid-cols-1">
            {SHORTCUT_COLUMNS.map((groups) => (
              <div key={groups.join(",")} className="grid content-start gap-3">
                {groups.map((group) => {
                  const items = rows.filter((row) => row.group === group);
                  if (items.length === 0) return null;
                  const title = t(SHORTCUT_GROUP_LABEL_IDS[group]);
                  return (
                    <section key={group} aria-label={title}>
                      <h3 className="m-0 mb-0.5 text-ui-xs font-medium text-text-tertiary">
                        {title}
                      </h3>
                      <ul className="m-0 list-none p-0">
                        {items.map((row) => (
                          <li
                            key={row.id}
                            className="flex h-7 items-center gap-3 text-ui-sm text-text-primary"
                          >
                            <span className="min-w-0 flex-1 truncate">{t(row.label)}</span>
                            <KeyChips row={row} />
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
