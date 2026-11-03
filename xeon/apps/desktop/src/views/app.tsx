import type { EventId } from "@fresnel/contracts/conversation";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApprovalIds, useThreadIds, useThreadSummaries } from "../state/engine/index.ts";
import { useReviewTarget, useScreen, useSelectedThreadId } from "../state/ui/index.ts";
import { CommandOutputSheet } from "./command-output-sheet.tsx";
import { useCommands } from "./commands.ts";
import { LockedDialog } from "./locked-dialog.tsx";
import { SettingsPage } from "./pages/settings/settings-screen.tsx";
import { useShellActions } from "../state/shell/index.ts";
import { nextApprovalId } from "./approval-focus-model.ts";
import { stepThreadId } from "./thread-step-model.ts";
import type { ShellRegistry } from "./shell/registry.ts";
import { Shell } from "./shell/shell.tsx";
import { Palette } from "./palette/palette.tsx";
import type { PaletteCommandId, PaletteRun } from "./palette/palette-model.ts";
import { resolveKeymap, type ActionId } from "./shell/keybindings.ts";
import { ShortcutHelpDialog } from "./shortcut-help-dialog.tsx";
import { PluginUiHost } from "./plugin/plugin-tabs.tsx";
import { StatusBar } from "./status-bar.tsx";
import { ThreadList } from "./thread-list.tsx";

export interface AppProps {
  readonly registry: ShellRegistry;
  readonly keyOverrides?: Readonly<Record<string, string>> | undefined;
  readonly mac: boolean;
}

/** 초점이 있는 승인 카드의 승인 id(대기 목록에 있는 것만). 카드 밖에 초점이 있으면 null */
function focusedApprovalOf(ids: readonly EventId[]): EventId | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const card = active.closest<HTMLElement>('[data-slot="approval-card-item"]');
  return ids.find((id) => id === card?.dataset.approvalId) ?? null;
}

/** 승인 카드의 초점 자리(카드 머리 root, tabIndex -1)로 초점을 준다. 카드가 화면에 없으면 아무 일도 없다 */
function focusApprovalCard(id: EventId): void {
  const cards = Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="approval-card-item"]'),
  );
  const card = cards.find((element) => element.dataset.approvalId === id);
  card?.querySelector<HTMLElement>("[data-approval-kind]")?.focus();
}

export function App(props: AppProps): ReactNode {
  const commands = useCommands();
  const screen = useScreen();
  const selected = useSelectedThreadId();
  const reviewTarget = useReviewTarget();
  const shell = useShellActions();
  const threads = useThreadSummaries();
  const threadIds = useThreadIds();
  const approvalIds = useApprovalIds();
  // 대화 영역에서 열린 대화가 바뀌면 작업대 맥락이 (고정이 아니면) 따라간다
  useEffect(() => {
    shell.selectChatThread(selected);
  }, [shell, selected]);
  // 승인 카드의 "검토 열기"는 검토 승인을 UI 스토어에 두고, 무대는 여기서 변경 검토 화면(P-04)으로 옮긴다
  useEffect(() => {
    if (reviewTarget !== null) shell.updatePlace({ screen: "review", scroll: 0 });
  }, [reviewTarget, shell]);
  const openThread = (threadId: string): void => {
    shell.switchArea("chat");
    commands.showScreen("chat");
    // 대화 id의 타입은 엔진 거울의 요약이 갖고 있다. 거울에 없는 대화는 열지 않는다
    const found = threads.find((summary) => summary.threadId === threadId);
    if (found !== undefined) commands.selectThread(found.threadId);
  };
  /** 셸을 대화 영역의 입력창이 보이는 화면으로 바꾼다(⌘L, 슬래시 명령 고르기) */
  const showChat = (): void => {
    const model = shell.snapshot();
    shell.switchArea("chat");
    commands.showScreen("chat");
    if (model.places.chat.screen !== "chat") shell.updatePlace({ screen: "chat", scroll: 0 });
  };
  const runPalette = (run: PaletteRun): void => {
    switch (run.kind) {
      case "thread":
        openThread(run.threadId);
        return;
      case "command":
        runCommand(run.id);
        return;
      case "slash":
        if (selected === null) return;
        showChat();
        commands.requestComposer(`/${run.name} `);
        return;
      case "setting":
        commands.requestSettingsJump({ tab: run.tab, key: run.key });
        return;
      default:
        return assertNever(run, "PaletteRun");
    }
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
  // 셸이 처리하지 않는 바로 가기 키(spec §4.8). `help.shortcuts`는 O-09를 연다.
  // `composer.focus`는 입력창 요청, `thread.next|prev`는 대화 목록 순서, `approval.next`는 대기 승인 카드 순서로 간다
  const [helpOpen, setHelpOpen] = useState(false);
  const keymap = useMemo(() => resolveKeymap(props.keyOverrides), [props.keyOverrides]);
  const onAction = (id: ActionId): void => {
    if (id === "thread.new") runCommand("thread.new");
    else if (id === "turn.interrupt") runCommand("turn.interrupt");
    else if (id === "help.shortcuts") setHelpOpen(true);
    else if (id === "composer.focus") {
      if (selected === null) return;
      showChat();
      commands.requestComposer(null);
    } else if (id === "thread.next" || id === "thread.prev") {
      const next = stepThreadId(threadIds, selected, id === "thread.next" ? 1 : -1);
      if (next !== null) commands.selectThread(next);
    } else if (id === "approval.next") {
      const next = nextApprovalId(approvalIds, focusedApprovalOf(approvalIds));
      if (next !== null) focusApprovalCard(next);
    }
  };
  return (
    <>
      <Shell
        palette={<Palette mac={props.mac} keyOverrides={props.keyOverrides} onRun={runPalette} />}
        onAction={onAction}
        modalOpen={helpOpen}
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
      <PluginUiHost />
      <CommandOutputSheet />
      <ShortcutHelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        keymap={keymap}
        mac={props.mac}
      />
    </>
  );
}
