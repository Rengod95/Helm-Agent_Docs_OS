import {
  CalendarClock,
  Clock,
  Inbox,
  Lightbulb,
  ListChecks,
  MessageSquare,
  Plug,
} from "@caustic/react/icons";
import { ApprovalQueue, InboxApprovals } from "./approvals.tsx";
import { ChatHeader } from "./chat-header.tsx";
import { Composer } from "./composer.tsx";
import { SafeModeCard } from "./safe-mode-card.tsx";
import { SetupBanner } from "./setup-banner.tsx";
import { SchedulesScreen } from "./pages/schedules/schedules-screen.tsx";
import { ConnectionScreen } from "./pages/connection/connection-screen.tsx";
import { FirstRunScreen } from "./pages/first-run/first-run-screen.tsx";
import { ProposalsScreen } from "./pages/proposals/proposals-screen.tsx";
import { ReviewScreen } from "./pages/review/review-screen.tsx";
import { WorkScreen } from "./pages/work/work-screen.tsx";
import { SecretsPanel } from "./pages/secrets/secrets-screen.tsx";
import { TrustCard } from "./trust.tsx";
import { Transcript } from "./transcript.tsx";
import {
  createShellRegistry,
  type EndTabDef,
  type ScreenDef,
  type ShellRegistry,
} from "./shell/registry.ts";
import { createWorkbenchStore } from "../state/workbench/index.ts";
import { inspectEndTab, pluginPagesEndTab, registerWorkbench } from "./workbench/index.tsx";
import { RuntimeTab } from "./runtime/runtime-tab.tsx";
import { HelmPanelTab, PluginPagesTab } from "./plugin/plugin-tabs.tsx";
import type { ReactNode } from "react";

// 지금 만들어져 있는 화면만 등록한다. 나머지 화면 id는 셸이 "아직 없어요" 빈 상태로 그린다.
// 화면 트랙은 여기에 `registerScreen`·`registerEndTab`을 더한다(shell/README.md).

function ChatScreen(): ReactNode {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatHeader />
      <SetupBanner />
      <Transcript />
      <TrustCard />
      <ApprovalQueue />
      <SafeModeCard />
      <Composer />
    </div>
  );
}

function InboxTab(): ReactNode {
  return <InboxApprovals />;
}

const CHAT_SCREEN: ScreenDef = {
  id: "chat",
  area: "chat",
  label: "desktop.shell.nav.chat",
  icon: <MessageSquare />,
  render: () => <ChatScreen />,
};

const SCHEDULES_SCREEN: ScreenDef = {
  id: "schedules",
  area: "chat",
  label: "desktop.shell.nav.schedules",
  icon: <CalendarClock />,
  render: () => <SchedulesScreen />,
};

const PROPOSALS_SCREEN: ScreenDef = {
  id: "proposals",
  area: "chat",
  label: "desktop.shell.nav.proposals",
  icon: <Lightbulb />,
  render: () => <ProposalsScreen />,
};

const CONNECTION_SCREEN: ScreenDef = {
  id: "connection",
  area: "chat",
  label: "desktop.shell.nav.connection",
  icon: <Plug />,
  render: () => <ConnectionScreen />,
};

// 플러그인 화면(내비 항목 하나)은 대화 영역에 산다. 확장 상세의 "플러그인 화면 열기"도 여기로 간다(ext-detail.tsx)
const PLUGINS_SCREEN: ScreenDef = {
  id: "plugins",
  area: "chat",
  label: "desktop.shell.nav.plugins",
  icon: <Plug />,
  render: () => <PluginPagesTab />,
};

// 시크릿 화면은 내비 항목이 없다(`nav.ts`에 없음). 설정 화면이 `SecretsPanel`을 넣어 연다.
const SECRETS_SCREEN: ScreenDef = {
  id: "secrets",
  area: "both",
  label: "desktop.secrets.title",
  render: () => <SecretsPanel />,
};

// 첫 실행 화면(P-01)은 내비 항목이 없다. "설정 필요" 띠의 "설정 열기"가 무대에 연다(setup-banner.tsx).
const FIRST_RUN_SCREEN: ScreenDef = {
  id: "first-run",
  area: "both",
  label: "desktop.firstRun.title",
  render: () => <FirstRunScreen />,
};

// 변경 검토 화면(P-04)은 내비 항목이 없다. 승인 카드의 "검토 열기"가 UI 스토어에 검토 승인을 두고, App이 무대를 이 화면으로 옮긴다.
const REVIEW_SCREEN: ScreenDef = {
  id: "review",
  area: "both",
  label: "desktop.review.title",
  render: () => <ReviewScreen />,
};

const INBOX_TAB: EndTabDef = {
  id: "inbox",
  area: "both",
  label: "desktop.shell.nav.inbox",
  icon: <Inbox />,
  render: () => <InboxTab />,
};

const HELM_TAB: EndTabDef = {
  id: "helm",
  area: "chat",
  label: "desktop.plugin.tab.helm",
  icon: <Plug />,
  render: () => <HelmPanelTab />,
};

/** 대화 영역의 "런타임" 탭(§4.9.8): 이 대화의 주도 락, 켜진 그룹과 확장, 실패 */
const RUNTIME_TAB: EndTabDef = {
  id: "runtime",
  area: "chat",
  label: "desktop.shell.tab.runtime",
  icon: <Clock />,
  render: () => <RuntimeTab />,
};

// 목표와 작업 탭(P-14). 대화 영역의 끝 영역이고 열린 대화의 목표와 작업을 보인다(`panel.work`, ⌘⇧T)
const WORK_TAB: EndTabDef = {
  id: "work",
  area: "chat",
  label: "desktop.work.tab",
  icon: <ListChecks />,
  screens: ["chat"],
  render: () => <WorkScreen />,
};

/** 크래프트 화면 셋(개요·확장·엔진)은 `registerWorkbench`가 등록한다. 개요는 캔버스 하나이고 목록을 못 읽으면 띠가 상태를 보인다 */
export function createDesktopRegistry(): ShellRegistry {
  const registry = createShellRegistry();
  registry.registerScreen(CHAT_SCREEN);
  registry.registerScreen(SCHEDULES_SCREEN);
  registry.registerScreen(PROPOSALS_SCREEN);
  registry.registerScreen(CONNECTION_SCREEN);
  registry.registerScreen(PLUGINS_SCREEN);
  registry.registerScreen(SECRETS_SCREEN);
  registry.registerScreen(FIRST_RUN_SCREEN);
  registry.registerScreen(REVIEW_SCREEN);
  registry.registerEndTab(INBOX_TAB);
  registry.registerEndTab(WORK_TAB);
  registry.registerEndTab(HELM_TAB);
  // 워크벤치 스토어는 플러그인 탭과 크래프트 화면이 같이 읽으므로 탭 등록보다 먼저 만든다
  const workbench = createWorkbenchStore();
  registry.registerEndTab(pluginPagesEndTab(workbench));
  registry.registerEndTab(RUNTIME_TAB);
  registerWorkbench(registry, workbench);
  registry.registerEndTab(inspectEndTab(workbench));
  return registry;
}
