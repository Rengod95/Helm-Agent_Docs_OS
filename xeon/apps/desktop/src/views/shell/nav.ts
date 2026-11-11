// 왼쪽 패널 내비 표(§4.9.3). 항목 id는 화면 id(`AreaPlace.screen`)와 같다. 대화 영역은 셋(제안·예약·플러그인 화면, 받은 요청은 오른쪽 툴바), 작업대 영역은 여섯이다.
// 맨 위의 "새 대화" 행은 화면이 아니라 동작이라 이 표에 없다(`start-panel.tsx`, DP-69). 연결은 설정의 구역으로 옮겼다(연결 화면 라우트는 남는다).
import type { MessageId } from "@fresnel/client/i18n";
import type { ActionId } from "./keybindings.ts";
import type { Area } from "../../state/shell/index.ts";

export interface NavItem {
  readonly id: string;
  readonly label: MessageId;
  /** 이 항목을 여는 바로 가기 동작 id(`nav.N`) */
  readonly action?: ActionId;
}

const CHAT_NAV: readonly NavItem[] = [
  { id: "proposals", label: "desktop.shell.nav.proposals", action: "nav.1" },
  { id: "schedules", label: "desktop.shell.nav.schedules", action: "nav.2" },
  { id: "plugins", label: "desktop.shell.nav.plugins", action: "nav.3" },
];

const WORKBENCH_NAV: readonly NavItem[] = [
  { id: "overview", label: "desktop.shell.nav.overview" },
  { id: "extensions", label: "desktop.shell.nav.extensions" },
  { id: "tests", label: "desktop.shell.nav.tests" },
  { id: "metrics", label: "desktop.shell.nav.metrics" },
  { id: "compose", label: "desktop.shell.nav.compose" },
  { id: "engine", label: "desktop.shell.nav.engine" },
];

export const NAV_BY_AREA: Readonly<Record<Area, readonly NavItem[]>> = {
  chat: CHAT_NAV,
  workbench: WORKBENCH_NAV,
};
