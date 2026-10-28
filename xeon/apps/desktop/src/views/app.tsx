import type { ReactNode } from "react";
import { useScreen, useSidebarOpen } from "../state/ui/index.ts";
import { ApprovalQueue } from "./approvals.tsx";
import { Composer } from "./composer.tsx";
import { LockedDialog } from "./locked-dialog.tsx";
import { SettingsScreen } from "./settings.tsx";
import { SetupBanner } from "./setup-banner.tsx";
import { StatusBar } from "./status-bar.tsx";
import { ThreadList } from "./thread-list.tsx";
import { Transcript } from "./transcript.tsx";
import { TrustCard } from "./trust.tsx";

export function App(): ReactNode {
  const sidebarOpen = useSidebarOpen();
  const screen = useScreen();
  return (
    <div className="shell">
      <div className="body">
        {sidebarOpen ? <ThreadList /> : null}
        {screen === "settings" ? (
          <SettingsScreen />
        ) : (
          <main className="main">
            <SetupBanner />
            <Transcript />
            <TrustCard />
            <ApprovalQueue />
            <Composer />
          </main>
        )}
      </div>
      <StatusBar />
      <LockedDialog />
    </div>
  );
}
