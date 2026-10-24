import type { ReactNode } from "react";
import { useSidebarOpen } from "../state/ui/index.ts";
import { ApprovalQueue } from "./approvals.tsx";
import { Composer } from "./composer.tsx";
import { StatusBar } from "./status-bar.tsx";
import { ThreadList } from "./thread-list.tsx";
import { Transcript } from "./transcript.tsx";

export function App(): ReactNode {
  const sidebarOpen = useSidebarOpen();
  return (
    <div className="shell">
      <div className="body">
        {sidebarOpen ? <ThreadList /> : null}
        <main className="main">
          <Transcript />
          <ApprovalQueue />
          <Composer />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
