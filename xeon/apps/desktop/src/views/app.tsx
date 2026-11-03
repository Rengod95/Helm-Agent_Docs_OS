import { useEffect, type ReactNode } from "react";
import { useThreadSummaries } from "../state/engine/index.ts";
import { useScreen, useSelectedThreadId } from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";
import { LockedDialog } from "./locked-dialog.tsx";
import { SettingsScreen } from "./settings.tsx";
import { useShellActions } from "../state/shell/index.ts";
import type { ShellRegistry } from "./shell/registry.ts";
import { Shell } from "./shell/shell.tsx";
import { StatusBar } from "./status-bar.tsx";
import { ThreadList } from "./thread-list.tsx";

export interface AppProps {
  readonly registry: ShellRegistry;
  readonly keyOverrides?: Readonly<Record<string, string>> | undefined;
  readonly mac: boolean;
}

export function App(props: AppProps): ReactNode {
  const commands = useCommands();
  const screen = useScreen();
  const selected = useSelectedThreadId();
  const shell = useShellActions();
  const threads = useThreadSummaries();
  // 대화 영역에서 열린 대화가 바뀌면 작업대 맥락이 (고정이 아니면) 따라간다
  useEffect(() => {
    shell.selectChatThread(selected);
  }, [shell, selected]);
  return (
    <>
      <Shell
        registry={props.registry}
        keyOverrides={props.keyOverrides}
        mac={props.mac}
        settingsOpen={screen === "settings"}
        onSettingsOpenChange={(open) => {
          commands.showScreen(open ? "settings" : "chat");
        }}
        settingsScreen={<SettingsScreen />}
        threadList={<ThreadList />}
        statusBar={<StatusBar />}
        onGoToThread={(threadId) => {
          shell.switchArea("chat");
          commands.showScreen("chat");
          // 대화 id의 타입은 엔진 거울의 요약이 갖고 있다. 거울에 없는 대화는 열지 않는다
          const found = threads.find((summary) => summary.threadId === threadId);
          if (found !== undefined) commands.selectThread(found.threadId);
        }}
      />
      <LockedDialog />
    </>
  );
}
