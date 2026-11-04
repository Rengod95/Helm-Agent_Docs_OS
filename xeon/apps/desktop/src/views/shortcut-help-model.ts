import type { MessageId } from "@fresnel/client/i18n";
import { ACTION_IDS, formatKey, type ActionId, type Keymap } from "./shell/keybindings.ts";

// 바로 가기 키 도움말(O-09)의 표 모델. 행은 `ACTION_IDS` 순서이고 키는 화면 표기(`formatKey`)다.
// 사용자가 바꾼 키(`resolveKeymap`의 결과)를 그대로 쓴다.

/** 동작마다 표에 보일 이름. 빠진 동작이 있으면 타입 검사가 실패한다 */
export const ACTION_LABEL_IDS: Readonly<Record<ActionId, MessageId>> = {
  "palette.open": "desktop.shortcuts.action.paletteOpen",
  "thread.new": "desktop.shortcuts.action.threadNew",
  "nav.1": "desktop.shortcuts.action.nav1",
  "nav.2": "desktop.shortcuts.action.nav2",
  "nav.3": "desktop.shortcuts.action.nav3",
  "nav.4": "desktop.shortcuts.action.nav4",
  "nav.5": "desktop.shortcuts.action.nav5",
  "nav.6": "desktop.shortcuts.action.nav6",
  "settings.open": "desktop.shortcuts.action.settingsOpen",
  "sidebar.toggle": "desktop.shortcuts.action.sidebarToggle",
  "panel.toggle": "desktop.shortcuts.action.panelToggle",
  "panel.inbox": "desktop.shortcuts.action.panelInbox",
  "panel.helm": "desktop.shortcuts.action.panelHelm",
  "panel.work": "desktop.shortcuts.action.panelWork",
  "turn.interrupt": "desktop.shortcuts.action.turnInterrupt",
  "composer.focus": "desktop.shortcuts.action.composerFocus",
  "thread.next": "desktop.shortcuts.action.threadNext",
  "thread.prev": "desktop.shortcuts.action.threadPrev",
  "approval.next": "desktop.shortcuts.action.approvalNext",
  "help.shortcuts": "desktop.shortcuts.action.helpShortcuts",
  "area.toggle": "desktop.shortcuts.action.areaToggle",
  "area.chat": "desktop.shortcuts.action.areaChat",
  "area.workbench": "desktop.shortcuts.action.areaWorkbench",
};

export interface ShortcutRow {
  readonly id: ActionId;
  readonly label: MessageId;
  /** 화면에 보이는 키 글자(macOS는 ⌘⇧⌥ 기호, 그 밖은 Ctrl+Shift+) */
  readonly keys: string;
}

export function shortcutRowsOf(keymap: Keymap, mac: boolean): readonly ShortcutRow[] {
  return ACTION_IDS.map((id) => ({
    id,
    label: ACTION_LABEL_IDS[id],
    keys: formatKey(keymap[id], mac),
  }));
}
