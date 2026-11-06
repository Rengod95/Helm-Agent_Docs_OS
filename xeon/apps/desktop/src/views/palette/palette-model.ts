import type { MessageId } from "@fresnel/client/i18n";
import { TAB_ORDER } from "@fresnel/client/settings";
import type { SettingsTab } from "@fresnel/contracts/settings";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { originTitleOf } from "../../plugin-ui/placements.ts";
import type { Area } from "../../state/shell/index.ts";
import type { ActionId } from "../shell/keybindings.ts";
import { NAV_BY_AREA } from "../shell/nav.ts";

// S-02 명령 팔레트의 순서 있는 부분(spec §4.5, §6.2). 묶음은 순서대로 "대화", "명령", "플러그인", "슬래시 명령", "설정", "화면 이동"이다.
// 항목 값은 `thread:<id>`, `command:<id>`, `plugin:<확장>/<항목 id>`, `slash:<이름>`, `setting:<탭>:<항목 키>`, `screen:<영역>:<화면>`, `more:<묶음>`(더 보기)이고,
// 고른 값은 `decodeValue`로만 읽는다. 행의 글(번역된 라벨)은 화면이 정해 넘기므로 이 모듈은 번역하지 않는다.
// 명령의 순서는 실행 횟수가 많은 순이다(`availableCommands`). 횟수가 없으면 표 순서다.

export const PALETTE_COMMAND_IDS = [
  "thread.new",
  "turn.interrupt",
  "inbox.open",
  "settings.open",
  "firstRun.open",
  "area.toggle",
  "engine.restart",
  "diagnostics.copy",
  "thread.fork",
  "thread.compact",
  "turn.resume",
  "explore.start",
  "explore.stop",
  "goal.clear",
  "connection.open",
] as const;
export type PaletteCommandId = (typeof PALETTE_COMMAND_IDS)[number];

/** 명령 id마다 실행 횟수. 없는 id는 0번이다. 저장은 로컬 설정 `l4.desktop.window.paletteUses`가 한다 */
export type PaletteUses = Readonly<Record<string, number>>;

/** 실행 횟수의 상한. 저장 값의 검사 상한(`settings-store/local.ts`)과 같다 */
export const PALETTE_USE_MAX = 1_000_000;

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
    id: "firstRun.open",
    label: "desktop.palette.command.firstRun",
    action: null,
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
  {
    id: "thread.fork",
    label: "desktop.palette.command.fork",
    action: null,
    needsThread: true,
  },
  {
    id: "thread.compact",
    label: "desktop.palette.command.compact",
    action: null,
    needsThread: true,
  },
  {
    id: "turn.resume",
    label: "desktop.palette.command.resume",
    action: null,
    needsThread: true,
  },
  {
    id: "explore.start",
    label: "desktop.palette.command.exploreStart",
    action: null,
    needsThread: true,
  },
  {
    id: "explore.stop",
    label: "desktop.palette.command.exploreStop",
    action: null,
    needsThread: true,
  },
  {
    id: "goal.clear",
    label: "desktop.palette.command.goalClear",
    action: null,
    needsThread: true,
  },
  {
    id: "connection.open",
    label: "desktop.palette.command.connection",
    action: null,
    needsThread: false,
  },
];

/** 묶음 여섯 개. 이 순서로 보인다(spec §4.5의 최근 대화, 명령, 플러그인, 슬래시 명령, 설정, 화면 이동) */
const PALETTE_GROUP_IDS = ["thread", "command", "plugin", "slash", "setting", "screen"] as const;
export type PaletteGroupId = (typeof PALETTE_GROUP_IDS)[number];

const AREAS: readonly Area[] = ["chat", "workbench"];

/** 묶음마다 먼저 보이는 행 수(spec §6.2 "묶음마다 5개 뒤 더 보기"). 넘는 행은 "더 보기" 한 행 뒤에 있다 */
export const PALETTE_GROUP_LIMIT = 5;

/** 고른 뒤 실행할 것. "더 보기"는 팔레트가 스스로 처리하므로 여기에 없다 */
export type PaletteRun =
  | { readonly kind: "thread"; readonly threadId: string }
  | { readonly kind: "command"; readonly id: PaletteCommandId }
  /** 확장이 `command` 자리에 기여한 명령. `id`가 등록된 명령 이름이다 */
  | { readonly kind: "plugin"; readonly extension: string; readonly id: string }
  | { readonly kind: "slash"; readonly name: string }
  /** `key`가 null이면 탭만 연다 */
  | { readonly kind: "setting"; readonly tab: SettingsTab; readonly key: string | null }
  /** 영역과 화면 id(내비 표의 id). 화면 자리는 App이 옮긴다 */
  | { readonly kind: "screen"; readonly area: Area; readonly screen: string };

export type PaletteValue = PaletteRun | { readonly kind: "more"; readonly group: PaletteGroupId };

export const threadValue = (threadId: string): string => `thread:${threadId}`;
export const commandValue = (id: PaletteCommandId): string => `command:${id}`;
/** 확장 명령 값. 확장 이름에는 `/`가 없으므로 첫 `/`에서 나눈다 */
export const pluginValue = (extension: string, id: string): string => `plugin:${extension}/${id}`;
export const slashValue = (name: string): string => `slash:${name}`;
export const settingValue = (tab: SettingsTab, key: string | null): string =>
  `setting:${tab}:${key ?? ""}`;
export const screenValue = (area: Area, screen: string): string => `screen:${area}:${screen}`;
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
  if (head === "plugin") return decodePlugin(rest);
  if (head === "slash") return rest === "" ? null : { kind: "slash", name: rest };
  if (head === "setting") return decodeSetting(rest);
  if (head === "screen") return decodeScreen(rest);
  if (head === "more") {
    const group = PALETTE_GROUP_IDS.find((id) => id === rest);
    return group === undefined ? null : { kind: "more", group };
  }
  return null;
}

/** `확장/항목 id` 꼴. 확장 이름이나 id가 비면 값이 아니다 */
function decodePlugin(rest: string): PaletteRun | null {
  const cut = rest.indexOf("/");
  if (cut <= 0 || cut === rest.length - 1) return null;
  return { kind: "plugin", extension: rest.slice(0, cut), id: rest.slice(cut + 1) };
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

/** `영역:화면` 꼴. 영역이 모르는 것이거나 그 영역의 내비에 없는 화면이면 null이다 */
function decodeScreen(rest: string): PaletteRun | null {
  const cut = rest.indexOf(":");
  if (cut < 0) return null;
  const area = AREAS.find((candidate) => candidate === rest.slice(0, cut));
  if (area === undefined) return null;
  const screen = rest.slice(cut + 1);
  return NAV_BY_AREA[area].some((item) => item.id === screen)
    ? { kind: "screen", area, screen }
    : null;
}

/**
 * 보일 명령을 실행 횟수가 많은 순서로 돌려준다. 횟수가 같으면 표 순서다. 표에 없는 id의 횟수는 셈하지 않는다.
 * 열린 대화가 없으면 대화가 필요한 명령은 목록에서 뺀다.
 */
export function availableCommands(
  hasThread: boolean,
  uses: PaletteUses = {},
): readonly PaletteCommand[] {
  return PALETTE_COMMANDS.filter((command) => hasThread || !command.needsThread)
    .map((command, index) => ({ command, index, count: uses[command.id] ?? 0 }))
    .toSorted((a, b) => b.count - a.count || a.index - b.index)
    .map((row) => row.command);
}

/** 명령 하나를 한 번 실행했다고 센 새 횟수 값. 입력 값은 바꾸지 않고 상한에서 멈춘다 */
export function countedUse(uses: PaletteUses, id: PaletteCommandId): PaletteUses {
  return { ...uses, [id]: Math.min((uses[id] ?? 0) + 1, PALETTE_USE_MAX) };
}

/**
 * 보이는 묶음과 그 순서. 오프라인(엔진에 연결되지 않음)이면 앱 동작과 화면 이동만 남는다(spec §6.2 "오프라인은 앱 동작과 화면 이동만").
 * 슬래시 명령은 입력창이 있는 대화가 열려 있을 때만 보인다(고른 명령을 입력창에 채우기 때문이다).
 */
export function visibleGroupsOf(input: {
  readonly live: boolean;
  readonly hasThread: boolean;
}): readonly PaletteGroupId[] {
  return PALETTE_GROUP_IDS.filter((id) => {
    if (id === "command" || id === "screen") return true;
    // 확장 명령은 열린 대화가 있어야 실행된다(wire에 `when`이 없어 모두 대화를 요구한다고 본다)
    if (id === "plugin" || id === "slash") return input.live && input.hasThread;
    return input.live;
  });
}

/**
 * 확장 명령 행. 글은 `<확장> · <항목 제목>`(제목은 제어 글자를 뺀 것)이고 설명은 확장 이름이다. 확장 이름이 앞에 있어
 * 셸의 명령처럼 읽히지 않는다(보고 3). 입력은 `commandEntriesOf`가 거른 목록이다
 */
export function pluginCommandItemsOf(entries: readonly ExtUiEntry[]): PaletteItem[] {
  return entries.map((entry) => ({
    value: pluginValue(entry.extension, entry.id),
    label: originTitleOf(entry),
    description: entry.extension,
    meta: null,
  }));
}

/** 화면 이동 행 하나. 라벨은 내비의 `desktop.shell.nav.*`, 영역 이름은 영역의 글이다. 바로 가기 동작이 있으면 그 키를 쓴다 */
export interface ScreenTarget {
  readonly area: Area;
  readonly screen: string;
  readonly label: MessageId;
  readonly areaLabel: MessageId;
  readonly action: ActionId | undefined;
}

const AREA_LABEL: Readonly<Record<Area, MessageId>> = {
  chat: "desktop.shell.area.chat",
  workbench: "desktop.shell.area.workbench",
};

/** 화면 이동 행. 현재 영역의 내비 항목이 먼저 오고, 다른 영역의 항목이 뒤에 온다 */
export function screenTargetsOf(current: Area): readonly ScreenTarget[] {
  const other: Area = current === "chat" ? "workbench" : "chat";
  return [current, other].flatMap((area) =>
    NAV_BY_AREA[area].map((item) => ({
      area,
      screen: item.id,
      label: item.label,
      areaLabel: AREA_LABEL[area],
      action: item.action,
    })),
  );
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

/**
 * 글자를 친 뒤 Enter가 첫 결과를 실행해야 하는지(scD 3-1). caustic Combobox는 글자가 바뀌면 고른 행을 비우므로
 * 입력에 `aria-activedescendant`가 없을 때만, 글이 있고 한글 조합 중이 아닐 때 첫 행을 대신 고른다.
 * 화살표로 이미 행을 골랐으면 Combobox가 그 행을 실행한다.
 */
export function enterRunsFirstRow(input: {
  readonly key: string;
  readonly composing: boolean;
  readonly query: string;
  readonly hasActiveRow: boolean;
}): boolean {
  return input.key === "Enter" && !input.composing && input.query !== "" && !input.hasActiveRow;
}
