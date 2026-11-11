// 셸이 맡는 바로 가기 동작 처리. 키 이벤트를 동작 id로 풀어(`keybindings.ts`) 셸 상태를 바꾼다.
// 셸이 모르는 동작(`turn.interrupt`, `composer.focus`, `approval.next`, `thread.new` 등)은 `onAction`으로 넘긴다.
import { assertNever } from "@fresnel/contracts";
import { actionFor, type ActionId, type KeyEventLike, type Keymap } from "./keybindings.ts";
import { NAV_BY_AREA } from "./nav.ts";
import type { ShellActions, ShellModel } from "../../state/shell/index.ts";

/** 셸이 직접 처리하면 true. 처리하지 않은 동작은 호출자가 이어서 다룬다 */
export function runShellAction(
  id: ActionId,
  model: ShellModel,
  actions: ShellActions,
  settingsOpen: { readonly open: boolean; readonly set: (open: boolean) => void },
): boolean {
  switch (id) {
    case "palette.open":
      actions.setPaletteOpen(!model.paletteOpen);
      return true;
    case "sidebar.toggle":
      actions.setStartOpen(!model.startOpen);
      return true;
    case "panel.toggle":
      actions.setEndOpen(!model.endOpen);
      return true;
    case "panel.inbox":
    case "nav.2":
      actions.openEndTab("inbox");
      return true;
    case "panel.helm":
      actions.openEndTab("helm");
      return true;
    case "panel.work":
      actions.openEndTab("work");
      return true;
    case "area.toggle":
      settingsOpen.set(false);
      actions.toggleArea();
      return true;
    case "area.chat":
      settingsOpen.set(false);
      actions.switchArea("chat");
      return true;
    case "area.workbench":
      settingsOpen.set(false);
      actions.switchArea("workbench");
      return true;
    case "settings.open":
      settingsOpen.set(true);
      return true;
    case "nav.1":
    case "nav.3":
    case "nav.4":
    case "nav.5":
    case "nav.6": {
      const item = NAV_BY_AREA.chat.find((n) => n.action === id);
      if (item === undefined) return false;
      settingsOpen.set(false);
      actions.switchArea("chat");
      actions.updatePlace({ screen: item.id, scroll: 0 });
      return true;
    }
    case "thread.new":
    case "turn.interrupt":
    case "composer.focus":
    case "thread.next":
    case "thread.prev":
    case "approval.next":
    case "help.shortcuts":
      return false;
    default:
      return assertNever(id, "runShellAction");
  }
}

/** 키 이벤트 하나를 푼다. 맞는 동작이 있으면 그 id를, 없으면 null */
export function resolveShortcut(keymap: Keymap, e: KeyEventLike, mac: boolean): ActionId | null {
  return actionFor(keymap, e, mac);
}
