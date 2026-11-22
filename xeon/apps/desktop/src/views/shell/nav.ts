// 왼쪽 패널 내비 표(§4.9.3). 항목 id는 화면 id(`AreaPlace.screen`)와 같다.
// 대화 영역은 셋(제안, 예약, 플러그인 화면)이다. "대화"는 맨 위 고정 "새 대화" 줄과 대화 목록이 맡고, "연결"은 설정으로 갔다(DP-69).
// 작업대 영역은 일곱이다(옛 여섯과 Craft "메트릭"). 트레이스(`trace`)는 목적 화면이라 내비 줄이 없다.
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
  { id: "proposals", label: "desktop.shell.nav.proposals", action: "nav.3" },
  { id: "schedules", label: "desktop.shell.nav.schedules", action: "nav.4" },
  { id: "plugins", label: "desktop.shell.nav.plugins", action: "nav.6" },
];

const WORKBENCH_NAV: readonly NavItem[] = [
  { id: "overview", label: "desktop.shell.nav.overview" },
  { id: "craftReview", label: "desktop.shell.nav.review" },
  { id: "extensions", label: "desktop.shell.nav.extensions" },
  { id: "tests", label: "desktop.shell.nav.tests" },
  { id: "metrics", label: "desktop.shell.nav.metrics" },
  { id: "compose", label: "desktop.shell.nav.compose" },
  { id: "engine", label: "desktop.shell.nav.engine" },
  // Craft "메트릭"(C9, craft-flows §6.16). 옛 "성능 측정"(`metrics`)은 지우지 않고 그대로 둔다
  { id: "craft-metrics", label: "desktop.shell.nav.craftMetrics" },
];

export const NAV_BY_AREA: Readonly<Record<Area, readonly NavItem[]>> = {
  chat: CHAT_NAV,
  workbench: WORKBENCH_NAV,
};

/**
 * `nav.N` 바로 가기가 하는 일(§4.2). 내비 줄이 없는 번호도 키는 남는다(DP-69):
 * ⌘1은 대화 화면, ⌘2는 받은 요청 탭, ⌘5는 연결 열기(`connection.open`, 셸 밖 App이 처리), 나머지는 내비 줄의 화면이다.
 */
export type NavShortcut =
  | { readonly kind: "screen"; readonly screen: string }
  | { readonly kind: "inbox" }
  | { readonly kind: "connection" };

export type NavActionId = "nav.1" | "nav.2" | "nav.3" | "nav.4" | "nav.5" | "nav.6";

export const NAV_SHORTCUTS: Readonly<Record<NavActionId, NavShortcut>> = {
  "nav.1": { kind: "screen", screen: "chat" },
  "nav.2": { kind: "inbox" },
  "nav.3": { kind: "screen", screen: "proposals" },
  "nav.4": { kind: "screen", screen: "schedules" },
  "nav.5": { kind: "connection" },
  "nav.6": { kind: "screen", screen: "plugins" },
};
