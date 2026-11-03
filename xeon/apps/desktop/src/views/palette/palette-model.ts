import type { MessageId } from "@fresnel/client/i18n";
import type { ActionId } from "../shell/keybindings.ts";

// S-02 명령 팔레트의 순수 부분. 묶음은 "대화"(열린 대화 찾기)와 "명령"(앱 동작) 둘이다.
// 슬래시 명령과 설정 키 묶음은 아직 없다(`command.list` 연결과 설정 화면이 오면 더한다).
// 항목 값은 `thread:<id>` / `command:<id>` 문자열이고, 고른 값은 `decodeValue`로만 읽는다.

export const PALETTE_COMMAND_IDS = [
  "thread.new",
  "turn.interrupt",
  "inbox.open",
  "settings.open",
  "area.toggle",
  "engine.restart",
  "diagnostics.copy",
] as const;
export type PaletteCommandId = (typeof PALETTE_COMMAND_IDS)[number];

export type PaletteCommand = {
  readonly id: PaletteCommandId;
  readonly label: MessageId;
  /** 같은 일을 하는 바로 가기 키 동작. 키 글자는 현재 키 표에서 읽는다 */
  readonly action: ActionId | null;
  /** 열린 대화가 있어야 쓸 수 있다 */
  readonly needsThread: boolean;
};

const PALETTE_COMMANDS: readonly PaletteCommand[] = [
  {
    id: "thread.new",
    label: "desktop.palette.command.threadNew",
    action: "thread.new",
    needsThread: false,
  },
  {
    id: "turn.interrupt",
    label: "desktop.palette.command.interrupt",
    action: "turn.interrupt",
    needsThread: true,
  },
  {
    id: "inbox.open",
    label: "desktop.palette.command.inbox",
    action: "panel.inbox",
    needsThread: false,
  },
  {
    id: "settings.open",
    label: "desktop.palette.command.settings",
    action: "settings.open",
    needsThread: false,
  },
  {
    id: "area.toggle",
    label: "desktop.palette.command.area",
    action: "area.toggle",
    needsThread: false,
  },
  {
    id: "engine.restart",
    label: "desktop.palette.command.restart",
    action: null,
    needsThread: false,
  },
  {
    id: "diagnostics.copy",
    label: "desktop.palette.command.diagnostics",
    action: null,
    needsThread: false,
  },
];

export type PaletteValue =
  | { readonly kind: "thread"; readonly threadId: string }
  | { readonly kind: "command"; readonly id: PaletteCommandId };

export const threadValue = (threadId: string): string => `thread:${threadId}`;
export const commandValue = (id: PaletteCommandId): string => `command:${id}`;

/** 고른 값을 읽는다. 모르는 모양이나 모르는 명령은 null이다 */
export function decodeValue(value: string): PaletteValue | null {
  const sep = value.indexOf(":");
  if (sep < 0) return null;
  const head = value.slice(0, sep);
  const rest = value.slice(sep + 1);
  if (head === "thread") return rest === "" ? null : { kind: "thread", threadId: rest };
  if (head === "command") {
    const found = PALETTE_COMMAND_IDS.find((id) => id === rest);
    return found === undefined ? null : { kind: "command", id: found };
  }
  return null;
}

/** 열린 대화가 없으면 대화가 필요한 명령은 목록에서 뺀다 */
export function availableCommands(hasThread: boolean): readonly PaletteCommand[] {
  return PALETTE_COMMANDS.filter((command) => hasThread || !command.needsThread);
}
