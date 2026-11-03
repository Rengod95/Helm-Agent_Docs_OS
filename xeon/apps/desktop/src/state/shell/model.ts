// 셸 상태 모델: 영역(대화·작업대), 영역별 자리, 작업대 맥락(V-25), 패널 열림.
// 순수 함수만 둔다. 화면은 store.ts의 스토어로 이 함수들을 부른다. (L4.desktop-ux.spec §4.9.2~§4.9.5)
import { assertNever } from "@fresnel/contracts";
import { layoutOf, panelDefaults, type Layout } from "./layout.ts";

export type Area = "chat" | "workbench";

/** 작업대 맥락 칸 값. `thread`의 `pinned`가 거짓이면 대화 영역에서 대화를 바꿀 때 함께 바뀐다(따라가기) */
export type WorkbenchContext =
  | { readonly kind: "all" }
  | { readonly kind: "thread"; readonly threadId: string; readonly pinned: boolean }
  | { readonly kind: "profile"; readonly profileId: string }
  | { readonly kind: "trial"; readonly threadId: string };

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
  /** 대화 영역에서 마지막으로 연 대화. 맥락을 "대화"로 돌리거나 핀을 풀 때 따라갈 곳 */
  readonly chatThreadId: string | null;
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
    chatThreadId: null,
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

/** 대화 영역에서 대화를 열었다. 따라가는 중인 대화 맥락만 함께 바뀐다(고정이면 그대로) */
export function selectChatThread(s: ShellModel, threadId: string | null): ShellModel {
  const context =
    threadId !== null && s.context.kind === "thread" && !s.context.pinned
      ? { ...s.context, threadId }
      : s.context;
  return { ...s, chatThreadId: threadId, context };
}

/** "작업대에서 보기": 그 대화로 고정하고 작업대로 간다 */
export function pinThread(s: ShellModel, threadId: string): ShellModel {
  return {
    ...s,
    area: "workbench",
    context: { kind: "thread", threadId, pinned: true },
  };
}

/** 핀을 푼다. 다시 대화 영역에서 열린 대화를 따라간다. 따라갈 대화가 없으면 고정 때의 대화에 머문다 */
export function unpinThread(s: ShellModel): ShellModel {
  if (s.context.kind !== "thread") return s;
  return {
    ...s,
    context: { kind: "thread", threadId: s.chatThreadId ?? s.context.threadId, pinned: false },
  };
}

/** 맥락 칸의 묶음을 바꾼다. 대화는 따라가기로, 시험은 지금 열린 대화의 Test run으로 시작한다. 쓸 대화가 없으면 그대로 둔다 */
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
    case "thread": {
      const threadId = id ?? s.chatThreadId;
      return threadId === null ? s : { ...s, context: { kind: "thread", threadId, pinned: false } };
    }
    case "trial": {
      const threadId = id ?? s.chatThreadId;
      return threadId === null ? s : { ...s, context: { kind: "trial", threadId } };
    }
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
