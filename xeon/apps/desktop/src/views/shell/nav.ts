// 왼쪽 패널 내비 표(§4.9.3). 항목 id는 화면 id(`AreaPlace.screen`)와 같다. 대화 영역은 다섯(플러그인 화면 포함, 받은 요청은 오른쪽 툴바), 작업대 영역은 여섯이고 연결은 대화 쪽이다.
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
  { id: "chat", label: "desktop.shell.nav.chat", action: "nav.1" },
  { id: "proposals", label: "desktop.shell.nav.proposals", action: "nav.3" },
  { id: "schedules", label: "desktop.shell.nav.schedules", action: "nav.4" },
  { id: "connection", label: "desktop.shell.nav.connection", action: "nav.5" },
  { id: "plugins", label: "desktop.shell.nav.plugins", action: "nav.6" },
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
