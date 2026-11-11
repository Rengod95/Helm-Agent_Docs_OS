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

/** 도움말 묶음. 왼쪽 열에 `SHORTCUT_COLUMNS[0]`, 오른쪽 열에 `[1]`의 묶음이 쌓인다(시안 o09) */
export type ShortcutGroupId =
  | "anywhere"
  | "navigate"
  | "conversation"
  | "panel"
  | "area"
  | "composer"
  | "approval";

export const SHORTCUT_COLUMNS: readonly (readonly ShortcutGroupId[])[] = [
  ["anywhere", "navigate", "conversation"],
  ["panel", "area", "composer", "approval"],
];

export const SHORTCUT_GROUP_LABEL_IDS: Readonly<Record<ShortcutGroupId, MessageId>> = {
  anywhere: "desktop.shortcuts.group.anywhere",
  navigate: "desktop.shortcuts.group.navigate",
  conversation: "desktop.shortcuts.group.conversation",
  panel: "desktop.shortcuts.group.panel",
  area: "desktop.shortcuts.group.area",
  composer: "desktop.shortcuts.group.composer",
  approval: "desktop.shortcuts.group.approval",
};

/** 동작마다 속한 묶음. 빠진 동작이 있으면 타입 검사가 실패한다 */
const ACTION_GROUP: Readonly<Record<ActionId, ShortcutGroupId>> = {
  "palette.open": "anywhere",
  "thread.new": "anywhere",
  "settings.open": "anywhere",
  "help.shortcuts": "anywhere",
  "nav.1": "navigate",
  "nav.2": "navigate",
  "nav.3": "navigate",
  "thread.next": "navigate",
  "thread.prev": "navigate",
  "turn.interrupt": "conversation",
  "composer.focus": "conversation",
  "approval.next": "conversation",
  "sidebar.toggle": "panel",
  "panel.toggle": "panel",
  "panel.inbox": "panel",
  "panel.helm": "panel",
  "panel.work": "panel",
  "area.toggle": "area",
  "area.chat": "area",
  "area.workbench": "area",
};

/** 키 맵 밖의 고정 키(바꿀 수 없다). 입력창은 `composer.tsx`의 Enter 처리, 승인 카드는 `approval-card/card-model.ts`의 `approvalKeyOf`가 정본이다 */
type FixedShortcutId =
  | "composer.send"
  | "composer.newline"
  | "composer.steer"
  | "approval.allow"
  | "approval.deny";

export interface ShortcutRow {
  readonly id: ActionId | FixedShortcutId;
  readonly label: MessageId;
  readonly group: ShortcutGroupId;
  /** 화면에 보이는 키 글자(macOS는 ⌘⇧⌥ 기호, 그 밖은 Ctrl+Shift+) */
  readonly keys: string;
  /** `keys`를 낱키로 나눈 것. 키 칩 하나가 한 칸이다 */
  readonly parts: readonly string[];
}

/** 화면 표기를 낱키로 나눈다. macOS는 기호 한 글자씩, 그 밖은 `+`로 나눈다(`Ctrl++`의 끝 `+`는 키 자체다) */
export function keyPartsOf(keys: string, mac: boolean): readonly string[] {
  return mac ? Array.from(keys) : keys.split(/\+(?!$)/);
}

export function shortcutRowsOf(keymap: Keymap, mac: boolean): readonly ShortcutRow[] {
  return ACTION_IDS.map((id) => {
    const keys = formatKey(keymap[id], mac);
    return {
      id,
      label: ACTION_LABEL_IDS[id],
      group: ACTION_GROUP[id],
      keys,
      parts: keyPartsOf(keys, mac),
    };
  });
}

/** 찾기 글에 맞는 행만 남긴다. 동작 이름, 묶음 이름, 동작 id, 키 글자 중 하나가 들어 있으면 맞는다. 빈 글은 모두 남긴다 */
export function filterShortcutRows(
  rows: readonly ShortcutRow[],
  query: string,
  text: (id: MessageId) => string,
): readonly ShortcutRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return rows;
  return rows.filter((row) =>
    [text(row.label), text(SHORTCUT_GROUP_LABEL_IDS[row.group]), row.id, row.keys].some((hay) =>
      hay.toLowerCase().includes(needle),
    ),
  );
}

/** 입력창·승인 카드의 고정 키 행. 사용자가 바꿀 수 없어 키 맵을 받지 않는다 */
export function fixedShortcutRowsOf(mac: boolean): readonly ShortcutRow[] {
  const enter = mac ? "↩" : "Enter";
  const shift = mac ? "⇧" : "Shift";
  const command = mac ? "⌘" : "Ctrl";
  const row = (
    id: FixedShortcutId,
    label: MessageId,
    group: ShortcutGroupId,
    parts: readonly string[],
  ): ShortcutRow => ({ id, label, group, keys: mac ? parts.join("") : parts.join("+"), parts });
  return [
    row("composer.send", "desktop.shortcuts.action.composerSend", "composer", [enter]),
    row("composer.newline", "desktop.shortcuts.action.composerNewline", "composer", [shift, enter]),
    row("composer.steer", "desktop.shortcuts.action.composerSteer", "composer", [command, enter]),
    row("approval.allow", "desktop.shortcuts.action.approvalAllow", "approval", ["Y"]),
    row("approval.deny", "desktop.shortcuts.action.approvalDeny", "approval", ["N"]),
  ];
}
