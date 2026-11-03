import { Inbox, MessageSquare } from "@caustic/react/icons";
import { ApprovalQueue, InboxApprovals } from "./approvals.tsx";
import { Composer } from "./composer.tsx";
import { SetupBanner } from "./setup-banner.tsx";
import { TrustCard } from "./trust.tsx";
import { Transcript } from "./transcript.tsx";
import {
  createShellRegistry,
  type EndTabDef,
  type ScreenDef,
  type ShellRegistry,
} from "./shell/registry.ts";
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

const INBOX_TAB: EndTabDef = {
  id: "inbox",
  area: "both",
  label: "desktop.shell.nav.inbox",
  icon: <Inbox />,
  render: () => <InboxTab />,
};

export function createDesktopRegistry(): ShellRegistry {
  const registry = createShellRegistry();
  registry.registerScreen(CHAT_SCREEN);
  registry.registerEndTab(INBOX_TAB);
  return registry;
}
