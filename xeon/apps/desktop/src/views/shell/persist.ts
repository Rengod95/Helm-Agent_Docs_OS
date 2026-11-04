// 셸 모델 ↔ 로컬 설정(V-14). 영역·영역별 자리·패널 열림만 저장한다. 맥락(`workbench.context`)은 저장하지 않는다:
// 맥락은 열린 대화를 따라가는 값이라 앱을 다시 켜면 "전체"에서 시작한다.
import { LOCAL } from "../../settings-store/index.ts";
import type { LocalSettings } from "../../settings-store/index.ts";
import type { Area, ShellModel } from "../../state/shell/index.ts";

/** 저장해 둔 값을 얹은 처음 상태. 폭 단계가 compact이면 저장된 시작 영역 열림은 쓰지 않는다(시트로 뜨므로 닫힌 채 시작해야 한다) */
export function restoreShell(base: ShellModel, settings: LocalSettings): ShellModel {
  const chat = settings.get(LOCAL.areaChat);
  const workbench = settings.get(LOCAL.areaWorkbench);
  const sidebar = settings.get(LOCAL.sidebarOpen);
  return {
    ...base,
    area: settings.get(LOCAL.areaCurrent) ?? base.area,
    // 플러그인 화면이 대화 영역 내비로 옮겨 가기 전에 작업대 자리로 저장된 값은 개요로 돌린다
    places: {
      chat: chat ?? base.places.chat,
      workbench:
        workbench === undefined
          ? base.places.workbench
          : workbench.screen === "plugins"
            ? { ...workbench, screen: "overview" }
            : workbench,
    },
    startOpen: base.layout === "compact" ? base.startOpen : (sidebar ?? base.startOpen),
  };
}

const sameShapePlace = (a: ShellModel["places"][Area], b: ShellModel["places"][Area]): boolean =>
  a.screen === b.screen && a.scroll === b.scroll && a.endTab === b.endTab;

/**
 * 바뀐 값만 쓴다. 스크롤은 자주 바뀌므로 화면·탭이 바뀐 자리와 영역을 떠나는 자리만 쓰고, 같은 영역 안의 스크롤만 바뀐 것은 쓰지 않는다.
 * 돌려주는 것은 쓰기 약속들이다(호출자가 `detach`로 받는다).
 */
export function persistShell(
  prev: ShellModel,
  next: ShellModel,
  settings: LocalSettings,
): readonly Promise<unknown>[] {
  const writes: Promise<unknown>[] = [];
  if (prev.area !== next.area) writes.push(settings.set(LOCAL.areaCurrent, next.area));
  for (const area of ["chat", "workbench"] as const) {
    const before = prev.places[area];
    const after = next.places[area];
    const leaving = prev.area === area && next.area !== area;
    if (!leaving && sameShapePlace(before, after)) continue;
    const structural = before.screen !== after.screen || before.endTab !== after.endTab;
    if (!structural && !leaving) continue;
    writes.push(settings.set(area === "chat" ? LOCAL.areaChat : LOCAL.areaWorkbench, after));
  }
  if (prev.startOpen !== next.startOpen && next.layout !== "compact") {
    writes.push(settings.set(LOCAL.sidebarOpen, next.startOpen));
  }
  return writes;
}
