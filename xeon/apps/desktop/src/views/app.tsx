import type { EventId } from "@fresnel/contracts/conversation";
import { assertNever, detach, rethrow, type Result } from "@fresnel/contracts";
import type { WireResult } from "@fresnel/contracts/wire";
import { t } from "@fresnel/client/i18n";
import { toast } from "@caustic/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApprovalIds, useThreadIds, useThreadSummaries } from "../state/engine/index.ts";
import { useReviewTarget, useScreen, useSelectedThreadId } from "../state/ui/index.ts";
import { CommandOutputSheet } from "./command-output-sheet.tsx";
import { useCommands, type CommandError } from "./commands.ts";
import { LockedDialog } from "./locked-dialog.tsx";
import { SettingsPage } from "./pages/settings/settings-screen.tsx";
import { firstRunAutoOpenDue } from "./pages/first-run/first-run-model.ts";
import { useShellActions, type Area } from "../state/shell/index.ts";
import { nextApprovalId } from "./approval-focus-model.ts";
import { stepThreadId } from "./thread-step-model.ts";
import { useSetupNeeded } from "./setup-needed.ts";
import type { ShellRegistry } from "./shell/registry.ts";
import { Shell } from "./shell/shell.tsx";
import { Palette } from "./palette/palette.tsx";
import { countedUse, type PaletteCommandId, type PaletteRun } from "./palette/palette-model.ts";
import { resolveKeymap, type ActionId } from "./shell/keybindings.ts";
import { ShortcutHelpDialog } from "./shortcut-help-dialog.tsx";
import { usePluginCommandRunner } from "./plugin/command-run.ts";
import { PluginUiHost } from "./plugin/plugin-tabs.tsx";
import { StatusBar } from "./status-bar.tsx";
import type { FolderPickInvoke } from "./folder-pick.ts";
import { ThreadList } from "./thread-list.tsx";

export interface AppProps {
  readonly registry: ShellRegistry;
  readonly keyOverrides?: Readonly<Record<string, string>> | undefined;
  readonly mac: boolean;
  /** 새 대화 작업 폴더의 폴더 선택 창. 데스크톱 셸이 준다 */
  readonly folderPick?: FolderPickInvoke | undefined;
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

/** 앱 동작이 실패했음을 토스트로 알린다. 오류 토스트는 자동으로 닫히지 않는다(§4.6) */
function notifyActionFailed(): void {
  toast({ tone: "danger", title: t("desktop.palette.action.failed") });
}

/** 결과가 오류면 토스트로 알린다. 성공한 동작은 화면이 바뀐 것으로 보인다 */
async function notifyIfFailed(action: Promise<{ readonly ok: boolean }>): Promise<void> {
  const result = await action;
  if (!result.ok) notifyActionFailed();
}

/** `command.run` 줄은 `done`일 때만 적용된 것이다(작업 화면의 목표 명령과 같다). 그 밖의 결과는 실패로 알린다 */
async function notifyIfCommandLineNotDone(
  action: Promise<Result<WireResult<"command.run">, CommandError>>,
): Promise<void> {
  const ran = await action;
  if (!ran.ok || ran.value.status !== "done") notifyActionFailed();
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
  const runPluginCommand = usePluginCommandRunner();
  // 모델 키와 기본 모델이 끝나지 않았으면 첫 실행 화면(P-01)을 이 앱 실행에서 한 번 무대에 연다. 나중에 다른 화면에 가도 다시 열지 않는다
  const setupNeeded = useSetupNeeded();
  const firstRunOpened = useRef(false);
  useEffect(() => {
    if (!firstRunAutoOpenDue({ needed: setupNeeded, openedThisRun: firstRunOpened.current }))
      return;
    firstRunOpened.current = true;
    shell.updatePlace({ screen: "first-run", scroll: 0 });
  }, [setupNeeded, shell]);
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
  /** 영역과 화면으로 옮긴다. 설정 화면이 열려 있으면 닫는다(내비 항목을 누르는 것과 같은 순서다) */
  const showPlace = (area: Area, place: string): void => {
    shell.switchArea(area);
    commands.showScreen("chat");
    shell.updatePlace({ screen: place, scroll: 0 });
  };
  const runPalette = (run: PaletteRun): void => {
    switch (run.kind) {
      case "thread":
        openThread(run.threadId);
        return;
      case "command":
        runCommand(run.id);
        return;
      case "plugin":
        runPluginCommand(run.extension, run.id);
        return;
      case "slash":
        if (selected === null) return;
        showChat();
        commands.requestComposer(`/${run.name} `);
        return;
      case "setting":
        commands.requestSettingsJump({ tab: run.tab, key: run.key });
        return;
      case "screen":
        showPlace(run.area, run.screen);
        return;
      default:
        return assertNever(run, "PaletteRun");
    }
  };
  const runCommand = (id: PaletteCommandId): void => {
    // 실행 횟수는 팔레트 밖의 바로 가기로 실행한 것도 센다. 저장하지 못하면 이번 실행만 세지 않는다
    detach(commands.savePaletteUses(countedUse(commands.paletteUses(), id)), rethrow);
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
      case "firstRun.open":
        shell.updatePlace({ screen: "first-run", scroll: 0 });
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
      case "thread.fork":
        if (selected !== null) detach(notifyIfFailed(commands.forkThread(selected)), rethrow);
        return;
      case "thread.compact":
        if (selected !== null) detach(notifyIfFailed(commands.compactThread(selected)), rethrow);
        return;
      case "turn.resume":
        if (selected !== null) detach(notifyIfFailed(commands.resumeTurn(selected)), rethrow);
        return;
      case "explore.start":
        if (selected !== null)
          detach(
            notifyIfCommandLineNotDone(commands.runCommandLine(selected, "/helm start")),
            rethrow,
          );
        return;
      case "explore.stop":
        if (selected !== null)
          detach(
            notifyIfCommandLineNotDone(commands.runCommandLine(selected, "/helm stop")),
            rethrow,
          );
        return;
      case "goal.clear":
        if (selected !== null)
          detach(
            notifyIfCommandLineNotDone(commands.work.goalCommand(selected, "/goal clear")),
            rethrow,
          );
        return;
      case "connection.open":
        showPlace("chat", "connection");
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
        settingsScreen={<SettingsPage folderPick={props.folderPick} />}
        threadList={<ThreadList folderPick={props.folderPick} />}
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
