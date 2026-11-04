// 셸 슬롯 등록부. 화면 트랙은 화면(`ScreenDef`)과 오른쪽 탭(`EndTabDef`)을 여기에 등록하고, 셸은 그것만 그린다.
// 셸은 화면 안을 모른다. 등록되지 않은 화면 id는 "아직 없어요" 빈 상태로 그린다. 정본 설명은 README.md다.
import type { ReactNode } from "react";
import type { MessageId } from "@fresnel/client/i18n";
import { Bug } from "@fresnel/contracts";
import type { Area } from "../../state/shell/index.ts";

/** 한 화면. `id`는 왼쪽 내비 항목 id이자 `AreaPlace.screen`이다 */
export interface ScreenDef {
  readonly id: string;
  /** 이 화면이 속한 영역. 설정(`settings`)처럼 두 영역 공통이면 `"both"` */
  readonly area: Area | "both";
  /** 내비 라벨의 메시지 id */
  readonly label: MessageId;
  readonly icon?: ReactNode;
  /** 내비 배지(개수). 0이나 undefined면 안 보인다 */
  readonly badge?: () => number | undefined;
  /** 무대에 그릴 내용 */
  readonly render: () => ReactNode;
  /** 화면을 열 때 오른쪽 탭 기본값. 영역이 기억한 탭이 있으면 그것이 우선이다 */
  readonly defaultEndTab?: string;
}

/**
 * 막대 칸의 숫자 배지(알림 수). `read`는 그릴 때 부르고, `subscribe`가 알리면 다시 읽는다. 0이나 undefined면 안 보인다.
 * 칸은 탭을 열지 않아도 보이므로 읽는 값이 바뀌면 칸도 따라 바뀌어야 한다.
 */
export interface TabBadge {
  readonly read: () => number | undefined;
  readonly subscribe: (listener: () => void) => () => void;
}

/** 오른쪽 막대의 탭 하나 */
export interface EndTabDef {
  readonly id: string;
  readonly area: Area | "both";
  readonly label: MessageId;
  readonly icon: ReactNode;
  readonly badge?: TabBadge;
  /**
   * 탭을 열지 않아도 막대와 함께 늘 그리는 부품(데이터를 읽어 두는 자리). 이 탭이 보이는 영역과 화면에서 그린다.
   * 그리는 결과는 화면에 없다(null을 돌려주는 부품).
   */
  readonly alwaysMounted?: ReactNode;
  /** well 폭(px). 없으면 352. 320~480으로 자른다 */
  readonly width?: number;
  /** 이 탭을 보일 화면 id. 없으면 영역의 모든 화면에서 보인다 */
  readonly screens?: readonly string[];
  readonly render: () => ReactNode;
}

export interface ShellRegistry {
  registerScreen(def: ScreenDef): void;
  registerEndTab(def: EndTabDef): void;
  screen(id: string): ScreenDef | undefined;
  /** 영역의 화면들(등록 순서). `"both"` 화면은 두 영역 모두에 든다 */
  screens(area: Area): readonly ScreenDef[];
  /** 영역의 오른쪽 탭들. `screen`을 주면 `screens`가 그 화면을 빼는 탭을 거른다 */
  endTabs(area: Area, screen?: string): readonly EndTabDef[];
}

const inArea = (a: Area | "both", area: Area): boolean => a === "both" || a === area;

export function createShellRegistry(): ShellRegistry {
  const screens = new Map<string, ScreenDef>();
  const tabs = new Map<string, EndTabDef>();
  return {
    registerScreen(def) {
      // 같은 id를 두 트랙이 등록하는 것은 조립 오류다
      if (screens.has(def.id)) throw new Bug(`screen id registered twice: ${def.id}`);
      screens.set(def.id, def);
    },
    registerEndTab(def) {
      if (tabs.has(def.id)) throw new Bug(`end tab id registered twice: ${def.id}`);
      tabs.set(def.id, def);
    },
    screen: (id) => screens.get(id),
    screens: (area) => [...screens.values()].filter((s) => inArea(s.area, area)),
    endTabs: (area, screen) =>
      [...tabs.values()].filter(
        (t) =>
          inArea(t.area, area) &&
          (screen === undefined || t.screens === undefined || t.screens.includes(screen)),
      ),
  };
}
