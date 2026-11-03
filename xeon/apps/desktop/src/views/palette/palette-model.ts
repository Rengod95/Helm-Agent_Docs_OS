import type { MessageId } from "@fresnel/client/i18n";
import { TAB_ORDER } from "@fresnel/client/settings";
import type { SettingsTab } from "@fresnel/contracts/settings";
import type { ActionId } from "../shell/keybindings.ts";

// S-02 명령 팔레트의 순수 부분(spec §4.5, §6.2). 묶음은 순서대로 "대화", "명령", "슬래시 명령", "설정"이다.
// 항목 값은 `thread:<id>`, `command:<id>`, `slash:<이름>`, `setting:<탭>:<항목 키>`, `more:<묶음>`(더 보기)이고,
// 고른 값은 `decodeValue`로만 읽는다. 행의 글(번역된 라벨)은 화면이 정해 넘기므로 이 모듈은 번역하지 않는다.

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

/** 묶음 네 개. 이 순서로 보인다(spec §4.5의 최근 대화, 명령, 슬래시 명령, 설정. 화면 이동은 아직 없다) */
const PALETTE_GROUP_IDS = ["thread", "command", "slash", "setting"] as const;
export type PaletteGroupId = (typeof PALETTE_GROUP_IDS)[number];

/** 묶음마다 먼저 보이는 행 수(spec §6.2 "묶음마다 5개 뒤 더 보기"). 넘는 행은 "더 보기" 한 행 뒤에 있다 */
export const PALETTE_GROUP_LIMIT = 5;

/** 고른 뒤 실행할 것. "더 보기"는 팔레트가 스스로 처리하므로 여기에 없다 */
export type PaletteRun =
  | { readonly kind: "thread"; readonly threadId: string }
  | { readonly kind: "command"; readonly id: PaletteCommandId }
  | { readonly kind: "slash"; readonly name: string }
  /** `key`가 null이면 탭만 연다 */
  | { readonly kind: "setting"; readonly tab: SettingsTab; readonly key: string | null };

export type PaletteValue = PaletteRun | { readonly kind: "more"; readonly group: PaletteGroupId };

export const threadValue = (threadId: string): string => `thread:${threadId}`;
export const commandValue = (id: PaletteCommandId): string => `command:${id}`;
export const slashValue = (name: string): string => `slash:${name}`;
export const settingValue = (tab: SettingsTab, key: string | null): string =>
  `setting:${tab}:${key ?? ""}`;
export const moreValue = (group: PaletteGroupId): string => `more:${group}`;

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
  if (head === "slash") return rest === "" ? null : { kind: "slash", name: rest };
  if (head === "setting") return decodeSetting(rest);
  if (head === "more") {
    const group = PALETTE_GROUP_IDS.find((id) => id === rest);
    return group === undefined ? null : { kind: "more", group };
  }
  return null;
}

/** `탭:키` 꼴. 키가 비면 탭만이고, 탭 이름이 모르는 것이면 null이다 */
function decodeSetting(rest: string): PaletteRun | null {
  const cut = rest.indexOf(":");
  if (cut < 0) return null;
  const tab = TAB_ORDER.find((candidate) => candidate === rest.slice(0, cut));
  if (tab === undefined) return null;
  const key = rest.slice(cut + 1);
  return { kind: "setting", tab, key: key === "" ? null : key };
}

/** 열린 대화가 없으면 대화가 필요한 명령은 목록에서 뺀다 */
export function availableCommands(hasThread: boolean): readonly PaletteCommand[] {
  return PALETTE_COMMANDS.filter((command) => hasThread || !command.needsThread);
}

/**
 * 보이는 묶음과 그 순서. 오프라인(엔진에 연결되지 않음)이면 앱 동작만 남는다(spec §6.2 "오프라인은 앱 동작과 화면 이동만").
 * 슬래시 명령은 입력창이 있는 대화가 열려 있을 때만 보인다(고른 명령을 입력창에 채우기 때문이다).
 */
export function visibleGroupsOf(input: {
  readonly live: boolean;
  readonly hasThread: boolean;
}): readonly PaletteGroupId[] {
  return PALETTE_GROUP_IDS.filter((id) => {
    if (id === "command") return true;
    if (id === "slash") return input.live && input.hasThread;
    return input.live;
  });
}

/** 행 하나. 라벨과 설명은 화면이 번역해 넘긴 글이다 */
export interface PaletteItem {
  readonly value: string;
  readonly label: string;
  readonly description: string | null;
  /** 오른쪽 끝의 보조 글(바로 가기 키 글자 등) */
  readonly meta: string | null;
}

/** 묶음의 읽기 상태. `ready`가 아니면 행 뒤에 상태 칸 하나를 둔다 */
export type GroupStatus = "ready" | "loading" | "failed";

export interface GroupInput {
  readonly group: PaletteGroupId;
  readonly items: readonly PaletteItem[];
  readonly status: GroupStatus;
  readonly query: string;
  /** "더 보기"를 눌러 이 묶음을 펼쳤는가 */
  readonly expanded: boolean;
}

export type GroupCell =
  | { readonly kind: "item"; readonly item: PaletteItem }
  | { readonly kind: "more"; readonly value: string; readonly hidden: number }
  | {
      readonly kind: "status";
      readonly value: string;
      readonly status: Exclude<GroupStatus, "ready">;
    };

/** 찾는 글(앞뒤 공백을 뺀 소문자)이 라벨이나 설명에 들어 있는가. 빈 찾기는 모두 맞는다 */
export function matchesQuery(item: PaletteItem, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return true;
  return [item.label, item.description ?? ""].join("\n").toLocaleLowerCase().includes(needle);
}

/**
 * 묶음 하나의 칸. 찾는 글에 맞는 항목을 앞에서 다섯 개 보이고, 나머지는 "더 보기" 칸 뒤에 둔다(펼치면 모두 보인다).
 * 읽는 중이나 읽기 실패는 항목 뒤의 상태 칸이다. 맞는 항목도 상태도 없으면 빈 묶음이다.
 */
export function groupCellsOf(input: GroupInput): readonly GroupCell[] {
  const matched = input.items.filter((item) => matchesQuery(item, input.query));
  const shown = input.expanded ? matched : matched.slice(0, PALETTE_GROUP_LIMIT);
  const hidden = matched.length - shown.length;
  const cells: GroupCell[] = shown.map((item) => ({ kind: "item", item }));
  if (hidden > 0) cells.push({ kind: "more", value: moreValue(input.group), hidden });
  const status = input.status;
  if (status !== "ready") cells.push({ kind: "status", value: `status:${input.group}`, status });
  return cells;
}
