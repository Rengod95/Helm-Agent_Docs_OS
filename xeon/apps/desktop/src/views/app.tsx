import type { ReactNode } from "react";
import { useSidebarOpen } from "../state/ui/index.ts";
import { ApprovalQueue } from "./approvals.tsx";
import { Composer } from "./composer.tsx";
import { LockedDialog } from "./locked-dialog.tsx";
import { StatusBar } from "./status-bar.tsx";
import { ThreadList } from "./thread-list.tsx";
import { Transcript } from "./transcript.tsx";
import { TrustCard } from "./trust.tsx";

export function App(): ReactNode {
  const sidebarOpen = useSidebarOpen();
  return (
    <div className="shell">
      <div className="body">
        {sidebarOpen ? <ThreadList /> : null}
        <main className="main">
          <Transcript />
          <TrustCard />
          <ApprovalQueue />
          <Composer />
        </main>
      </div>
      <StatusBar />
      <LockedDialog />
    </div>
  );
}
