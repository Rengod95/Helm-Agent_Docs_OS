// 셸 슬롯 등록부. 화면 트랙은 화면(`ScreenDef`)과 오른쪽 탭(`EndTabDef`)을 여기에 등록하고, 셸은 그것만 그린다.
// 셸은 화면 안을 모른다. 등록되지 않은 화면 id는 "아직 없어요" 빈 상태로 그린다. 정본 설명은 README.md다.
// 오른쪽 막대는 두 자리다(DP-192, DP-194): 하네스 공통 탭(`registerEndTab`, 막대 칸)과 플러그인이 더한 패널(`registerPluginEndTab`, 막대 끝 "플러그인" 단추의 2차 메뉴).
import type { ReactNode } from "react";
import type { MessageId } from "@fresnel/client/i18n";
import { Bug } from "@fresnel/contracts";
import type { Area } from "../../state/shell/index.ts";
import type { ActionId } from "./keybindings.ts";

/** 한 화면. `id`는 왼쪽 내비 항목 id이자 `AreaPlace.screen`이다 */
export interface ScreenDef {
  readonly id: string;
  /** 이 화면이 속한 영역. 설정(`settings`)처럼 두 영역 공통이면 `"both"` */
  readonly area: Area | "both";
  /** 내비 라벨의 메시지 id */
  readonly label: MessageId;
  readonly icon?: ReactNode;
  /** 내비 배지(개수)를 읽는 부품. 개수를 읽어 `render`로 넘기므로 값이 바뀌면 이 줄만 다시 그린다. 0이나 undefined면 안 보인다 */
  readonly Badge?: (props: {
    readonly render: (count: number | undefined) => ReactNode;
  }) => ReactNode;
  /**
   * 내비 줄 끝(수 앞)에 세우는 표시 부품. 제안 줄만 크리스탈 표시(DP-223)를 단다: 확인이 필요한 것이 있을 때만 보이고, 내비 전체에서 하나다
   */
  readonly Mark?: () => ReactNode;
  /** 무대에 그릴 내용 */
  readonly render: () => ReactNode;
  /** 화면을 열 때 오른쪽 탭 기본값. 영역이 기억한 탭이 있으면 그것이 우선이다 */
  readonly defaultEndTab?: string;
  /**
   * 참이면 한 번 연 뒤 다른 화면으로 가도 내리지 않고 숨긴다(상태 유지, DP-90 플레이그라운드 탭). 설정 화면이 열려도 숨긴 채 남는다
   */
  readonly keepAlive?: boolean;
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
   * 칸 숫자를 읽는 부품(엔진 거울처럼 React 문맥으로 읽는 값). 개수를 읽어 `render`로 넘기므로 값이 바뀌면 칸만 다시 그린다.
   * 있으면 `badge`보다 우선이고, undefined를 넘기면 `badge`를 쓴다
   */
  readonly Count?: (props: {
    readonly render: (count: number | undefined) => ReactNode;
  }) => ReactNode;
  /**
   * 탭을 열지 않아도 막대와 함께 늘 그리는 부품(데이터를 읽어 두는 자리). 이 탭이 보이는 영역과 화면에서 그린다.
   * 그리는 결과는 화면에 없다(null을 돌려주는 부품).
   */
  readonly alwaysMounted?: ReactNode;
  /** well 폭(px). 없으면 352. 320~480으로 자른다 */
  readonly width?: number;
  /** 이 탭을 보일 화면 id. 없으면 영역의 모든 화면에서 보인다 */
  readonly screens?: readonly string[];
  /**
   * well 머리의 제목 옆 요약 한 줄(DP-193, 예: "3/7 끝남 · 1개 막힘"). 훅을 쓰는 부품이라 값이 바뀌면 머리만 다시 그린다.
   * 없으면 칸 숫자가 있을 때 그 숫자를 쓴다
   */
  readonly Summary?: () => ReactNode;
  /** 이 탭을 여는 바로 가기 동작. 막대 칸 툴팁과 2차 메뉴 줄에 키를 보인다 */
  readonly shortcut?: ActionId;
  readonly render: () => ReactNode;
}

/**
 * 플러그인이 더한 끝 패널(DP-194). 막대 칸이 아니라 "플러그인" 단추의 2차 메뉴 줄로 보인다.
 * `source`가 `plugin`이면 플러그인이 기여한 패널(메뉴 첫 묶음), `host`면 호스트가 그리는 플러그인 상태 화면(둘째 묶음)이다.
 * `label`은 플러그인(또는 화면) 이름, `description`은 메뉴 줄의 한 줄 설명이다
 */
export interface PluginEndTabDef extends EndTabDef {
  readonly description: MessageId;
  readonly source: "plugin" | "host";
}

export interface ShellRegistry {
  registerScreen(def: ScreenDef): void;
  registerEndTab(def: EndTabDef): void;
  /** 플러그인 끝 패널을 2차 메뉴에 더한다. id는 막대 탭과 같은 이름 공간이다(겹치면 Bug) */
  registerPluginEndTab(def: PluginEndTabDef): void;
  screen(id: string): ScreenDef | undefined;
  /** 영역의 화면들(등록 순서). `"both"` 화면은 두 영역 모두에 든다 */
  screens(area: Area): readonly ScreenDef[];
  /** 영역의 오른쪽 탭들. `screen`을 주면 `screens`가 그 화면을 빼는 탭을 거른다 */
  endTabs(area: Area, screen?: string): readonly EndTabDef[];
  /** 영역의 플러그인 끝 패널들(등록 순서). 거르는 규칙은 `endTabs`와 같다 */
  pluginEndTabs(area: Area, screen?: string): readonly PluginEndTabDef[];
}

const inArea = (a: Area | "both", area: Area): boolean => a === "both" || a === area;

export function createShellRegistry(): ShellRegistry {
  const screens = new Map<string, ScreenDef>();
  const tabs = new Map<string, EndTabDef>();
  const pluginTabs = new Map<string, PluginEndTabDef>();
  const visible = (t: EndTabDef, area: Area, screen: string | undefined): boolean =>
    inArea(t.area, area) &&
    (screen === undefined || t.screens === undefined || t.screens.includes(screen));
  return {
    registerScreen(def) {
      // 같은 id를 두 트랙이 등록하는 것은 조립 오류다
      if (screens.has(def.id)) throw new Bug(`screen id registered twice: ${def.id}`);
      screens.set(def.id, def);
    },
    registerEndTab(def) {
      if (tabs.has(def.id) || pluginTabs.has(def.id))
        throw new Bug(`end tab id registered twice: ${def.id}`);
      tabs.set(def.id, def);
    },
    registerPluginEndTab(def) {
      if (tabs.has(def.id) || pluginTabs.has(def.id))
        throw new Bug(`end tab id registered twice: ${def.id}`);
      pluginTabs.set(def.id, def);
    },
    screen: (id) => screens.get(id),
    screens: (area) => [...screens.values()].filter((s) => inArea(s.area, area)),
    endTabs: (area, screen) => [...tabs.values()].filter((t) => visible(t, area, screen)),
    pluginEndTabs: (area, screen) =>
      [...pluginTabs.values()].filter((t) => visible(t, area, screen)),
  };
}
