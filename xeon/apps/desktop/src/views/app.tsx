import { assertNever, detach, rethrow } from "@fresnel/contracts";
import { useEffect, type ReactNode } from "react";
import { useThreadSummaries } from "../state/engine/index.ts";
import { useScreen, useSelectedThreadId } from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";
import { LockedDialog } from "./locked-dialog.tsx";
import { SettingsPage } from "./pages/settings/settings-screen.tsx";
import { useShellActions } from "../state/shell/index.ts";
import type { ShellRegistry } from "./shell/registry.ts";
import { Shell } from "./shell/shell.tsx";
import { Palette } from "./palette/palette.tsx";
import type { PaletteCommandId } from "./palette/palette-model.ts";
import type { ActionId } from "./shell/keybindings.ts";
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
  const openThread = (threadId: string): void => {
    shell.switchArea("chat");
    commands.showScreen("chat");
    // 대화 id의 타입은 엔진 거울의 요약이 갖고 있다. 거울에 없는 대화는 열지 않는다
    const found = threads.find((summary) => summary.threadId === threadId);
    if (found !== undefined) commands.selectThread(found.threadId);
  };
  const runCommand = (id: PaletteCommandId): void => {
    switch (id) {
      case "thread.new":
        detach(commands.createThread(), rethrow);
        return;
      case "turn.interrupt":
        if (selected !== null) detach(commands.interrupt(selected), rethrow);
        return;
      case "inbox.open":
        shell.openEndTab("inbox", "chat");
        return;
      case "settings.open":
        commands.showScreen("settings");
        return;
      case "area.toggle":
        shell.toggleArea();
        return;
      case "engine.restart":
        detach(commands.restartEngine(), rethrow);
        return;
      case "diagnostics.copy":
        detach(commands.copyDiagnostics(), rethrow);
        return;
      default:
        return assertNever(id, "PaletteCommandId");
    }
  };
  // 셸이 처리하지 않는 바로 가기 키(spec §4.8). 나머지(`composer.focus` 등)는 아직 연결하지 않았다
  const onAction = (id: ActionId): void => {
    if (id === "thread.new") runCommand("thread.new");
    else if (id === "turn.interrupt") runCommand("turn.interrupt");
  };
  return (
    <>
      <Shell
        palette={
          <Palette
            mac={props.mac}
            keyOverrides={props.keyOverrides}
            onRun={(value) => {
              if (value.kind === "thread") openThread(value.threadId);
              else runCommand(value.id);
            }}
          />
        }
        onAction={onAction}
        registry={props.registry}
        keyOverrides={props.keyOverrides}
        mac={props.mac}
        settingsOpen={screen === "settings"}
        onSettingsOpenChange={(open) => {
          commands.showScreen(open ? "settings" : "chat");
        }}
        settingsScreen={<SettingsPage />}
        threadList={<ThreadList />}
        statusBar={<StatusBar />}
        onGoToThread={openThread}
      />
      <LockedDialog />
    </>
  );
}
