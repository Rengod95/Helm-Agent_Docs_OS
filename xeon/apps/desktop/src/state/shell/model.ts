// 셸 상태 모델: 영역(대화·작업대), 영역별 자리, 작업대 맥락(V-25), 패널 열림.
// 순수 함수만 둔다. 화면은 store.ts의 스토어로 이 함수들을 부른다. (L4.desktop-ux.spec §4.9.2~§4.9.5)
import { assertNever } from "@fresnel/contracts";
import { layoutOf, panelDefaults, type Layout } from "./layout.ts";

export type Area = "chat" | "workbench";

/** 작업대 맥락 칸 값. 크래프트는 전역·프로필 범위만 다루므로 대화 범위는 없다 */
export type WorkbenchContext =
  | { readonly kind: "all" }
  | { readonly kind: "profile"; readonly profileId: string };

/** 영역이 기억하는 자리: 마지막 화면, 스크롤 위치, 오른쪽 탭 */
export interface AreaPlace {
  readonly screen: string;
  readonly scroll: number;
  readonly endTab: string;
}

export interface ShellModel {
  readonly layout: Layout;
  readonly area: Area;
  readonly places: Readonly<Record<Area, AreaPlace>>;
  readonly context: WorkbenchContext;
  readonly startOpen: boolean;
  readonly endOpen: boolean;
  readonly paletteOpen: boolean;
}

const DEFAULT_PLACES: Readonly<Record<Area, AreaPlace>> = {
  chat: { screen: "chat", scroll: 0, endTab: "inbox" },
  workbench: { screen: "overview", scroll: 0, endTab: "inbox" },
};

export function initialShell(width: number): ShellModel {
  const layout = layoutOf(width);
  return {
    layout,
    area: "chat",
    places: DEFAULT_PLACES,
    context: { kind: "all" },
    ...panelDefaults(layout),
    paletteOpen: false,
  };
}

/** 창 폭이 바뀌었다. 단계가 같으면 그대로, 달라지면 그 단계의 패널 기본값으로 돌린다(끝 영역은 닫힌다) */
export function resize(s: ShellModel, width: number): ShellModel {
  const layout = layoutOf(width);
  return layout === s.layout ? s : { ...s, layout, ...panelDefaults(layout) };
}

/** 영역을 바꾼다. 바꾸기 전 영역의 자리는 그대로 남고, 돌아오면 같은 화면·스크롤·오른쪽 탭이다 */
export function switchArea(s: ShellModel, area: Area): ShellModel {
  return area === s.area ? s : { ...s, area };
}

export function toggleArea(s: ShellModel): ShellModel {
  return switchArea(s, s.area === "chat" ? "workbench" : "chat");
}

/** 지금 영역의 자리를 갱신한다(화면 이동, 스크롤, 탭 바꾸기) */
export function updatePlace(s: ShellModel, patch: Partial<AreaPlace>): ShellModel {
  const next = { ...s.places[s.area], ...patch };
  return { ...s, places: { ...s.places, [s.area]: next } };
}

/** 지금 영역의 오른쪽 탭을 열고 끝 영역을 편다 */
export function openEndTab(s: ShellModel, tab: string, area: Area = s.area): ShellModel {
  const places = { ...s.places, [area]: { ...s.places[area], endTab: tab } };
  return { ...s, places, endOpen: true };
}

/** 맥락 칸의 값을 바꾼다. 프로필은 고를 id가 있어야 하고, 없으면 그대로 둔다 */
export function setContextKind(
  s: ShellModel,
  kind: WorkbenchContext["kind"],
  id?: string,
): ShellModel {
  switch (kind) {
    case "all":
      return { ...s, context: { kind: "all" } };
    case "profile":
      return id === undefined ? s : { ...s, context: { kind: "profile", profileId: id } };
    default:
      return assertNever(kind, "setContextKind");
  }
}

export function setStartOpen(s: ShellModel, open: boolean): ShellModel {
  return s.startOpen === open ? s : { ...s, startOpen: open };
}

export function setEndOpen(s: ShellModel, open: boolean): ShellModel {
  return s.endOpen === open ? s : { ...s, endOpen: open };
}

export function setPaletteOpen(s: ShellModel, open: boolean): ShellModel {
  return s.paletteOpen === open ? s : { ...s, paletteOpen: open };
}

/** Esc: 뜬 패널을 닫는다. 팔레트나 대화 상자가 있으면 그쪽이 쓴다. 닫을 것이 있었으면 바뀐 상태를, 없으면 같은 객체를 돌려준다 */
export function dismissFloating(s: ShellModel): ShellModel {
  if (s.paletteOpen) return s;
  if (s.endOpen) return { ...s, endOpen: false };
  if (s.layout === "compact" && s.startOpen) return { ...s, startOpen: false };
  return s;
}
