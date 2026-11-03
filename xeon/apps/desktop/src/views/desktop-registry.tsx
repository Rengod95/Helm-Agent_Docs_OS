import { CalendarClock, Inbox, MessageSquare, Plug } from "@caustic/react/icons";
import { ApprovalQueue, InboxApprovals } from "./approvals.tsx";
import { Composer } from "./composer.tsx";
import { SetupBanner } from "./setup-banner.tsx";
import { SchedulesScreen } from "./pages/schedules/schedules-screen.tsx";
import { ConnectionScreen } from "./pages/connection/connection-screen.tsx";
import { FirstRunScreen } from "./pages/first-run/first-run-screen.tsx";
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
import { registerWorkbench } from "./workbench/index.tsx";
import type { ReactNode } from "react";

// 지금 만들어져 있는 화면만 등록한다. 나머지 화면 id는 셸이 "아직 없어요" 빈 상태로 그린다.
// 화면 트랙은 여기에 `registerScreen`·`registerEndTab`을 더한다(shell/README.md).

function ChatScreen(): ReactNode {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SetupBanner />
      <Transcript />
      <TrustCard />
      <ApprovalQueue />
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

const CONNECTION_SCREEN: ScreenDef = {
  id: "connection",
  area: "chat",
  label: "desktop.shell.nav.connection",
  icon: <Plug />,
  render: () => <ConnectionScreen />,
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

const INBOX_TAB: EndTabDef = {
  id: "inbox",
  area: "both",
  label: "desktop.shell.nav.inbox",
  icon: <Inbox />,
  render: () => <InboxTab />,
};

/** 크래프트 화면 셋(개요·확장·엔진)은 `registerWorkbench`가 등록한다. 개요는 캔버스 하나이고 목록을 못 읽으면 띠가 상태를 보인다 */
export function createDesktopRegistry(): ShellRegistry {
  const registry = createShellRegistry();
  registry.registerScreen(CHAT_SCREEN);
  registry.registerScreen(SCHEDULES_SCREEN);
  registry.registerScreen(CONNECTION_SCREEN);
  registry.registerScreen(SECRETS_SCREEN);
  registry.registerScreen(FIRST_RUN_SCREEN);
  registry.registerEndTab(INBOX_TAB);
  registerWorkbench(registry, createWorkbenchStore());
  return registry;
}
