// P-02 대화 셸. AppShell(제목 띠, 시작, 무대, 끝) + 상태 표시줄(AppShell 아래, 같은 창 바탕) + 대화 상자들.
import {
  AppShell,
  AppShellEnd,
  AppShellStage,
  AppShellStart,
  AppShellTitlebar,
} from "@caustic/react";
import { useEffect, useId } from "react";
import { EndPanel } from "./end-panel";
import { status } from "./fixtures";
import { LockedDialog } from "./locked-dialog";
import { Palette } from "./palette";
import { StatusBar, statusIcons, TokenBar, type StatusCell } from "./parts/status-bar";
import { StageContent } from "./stage";
import { StartPanel } from "./start-panel";
import { useMock } from "./store";
import { Titlebar } from "./titlebar";

function useShortcuts() {
  const m = useMock();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape" && !m.paletteOpen && !m.lockedOpen) {
        // 시트로 뜬 패널은 Esc로 닫는다.
        if (m.layout !== "wide" && m.endOpen) {
          m.setEndOpen(false);
          return;
        }
        if (m.layout === "compact" && m.startOpen) {
          m.setStartOpen(false);
          return;
        }
      }
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        m.setPaletteOpen(!m.paletteOpen);
      } else if (k === "\\") {
        e.preventDefault();
        m.setStartOpen(!m.startOpen);
      } else if (k === "j") {
        e.preventDefault();
        m.setEndOpen(!m.endOpen);
      } else if (k === "n") {
        e.preventDefault();
        m.newThread();
      } else if (k === ".") {
        e.preventDefault();
        m.stop();
      } else if (k === "l") {
        e.preventDefault();
        m.composerFocusRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [m]);
}

function statusCells(m: ReturnType<typeof useMock>): { start: StatusCell[]; end: StatusCell[] } {
  const openInbox = { label: "받은 요청 열기", onSelect: () => m.openEnd("inbox") };
  const link: StatusCell = m.reconnecting
    ? {
        id: "link",
        text: "다시 맞추는 중 (2/3)",
        dot: "warning",
        title: "다시 맞추는 중",
        description: "연결이 끊겨 엔진과 상태를 다시 맞추고 있어요 (3번 중 2번째).",
        action: { label: "다시 연결", onSelect: m.reconnect },
      }
    : {
        id: "link",
        text: status.link,
        dot: "success",
        title: "연결",
        description: "엔진과 실시간으로 연결되어 있어요.",
      };
  const approvalsCell: StatusCell = {
    id: "approvals",
    text: `승인 ${m.pendingApprovals}`,
    label: `승인 대기 ${m.pendingApprovals}개`,
    icon: <statusIcons.ShieldAlert />,
    title: "승인 대기",
    description: `답을 기다리는 승인이 ${m.pendingApprovals}개 있어요.`,
    action: openInbox,
  };
  if (m.layout === "compact") return { start: [link], end: [approvalsCell] };
  const thread = m.view === "thread";
  return {
    start: [
      {
        id: "target",
        text: status.target,
        icon: <statusIcons.Server />,
        title: "대상",
        description: "이 창은 이 컴퓨터의 로컬 사이드카 엔진에 붙어 있어요.",
      },
      {
        id: "engine",
        text: status.engine,
        dot: "success",
        title: "엔진",
        description: "엔진이 실행 중이에요.",
      },
      link,
    ],
    end: [
      {
        id: "model",
        text: status.model,
        icon: <statusIcons.Cpu />,
        title: "모델",
        description: "이 대화의 기본 모델이에요. 누르면 모델을 바꿀 수 있어요.",
      },
      {
        id: "tokens",
        text: "41k",
        label: "문맥 41k 토큰 사용, 40%",
        trailing: <TokenBar ratio={status.tokens.ratio} />,
        title: "문맥 사용량",
        description: "문맥 창의 40%(41,000 토큰)를 썼어요.",
      },
      ...(thread
        ? ([
            {
              id: "goal",
              text: `목표 ${status.goal}`,
              label: "목표 3개 중 2개 이룸",
              icon: <statusIcons.Target />,
              title: "목표",
              description: "목표 3개 중 2개를 이뤘어요.",
              action: { label: "작업 탭 열기", onSelect: () => m.openEnd("work") },
            },
            {
              id: "helm",
              text: "Helm",
              label: `Helm ${status.helm} 중`,
              icon: <statusIcons.Compass />,
              title: "Helm",
              description: `Helm 탐구가 ${status.helm} 단계예요.`,
              action: { label: "탐구 탭 열기", onSelect: () => m.openEnd("helm") },
            },
          ] satisfies StatusCell[])
        : []),
      approvalsCell,
      {
        id: "notices",
        text: `알림 ${status.notices}`,
        label: `알림 ${status.notices}개`,
        icon: <statusIcons.Bell />,
        title: "알림",
        description: "새 알림이 3개 있어요. 예약 실패 1개가 있어요.",
        action: openInbox,
      },
    ],
  };
}

export function App() {
  const m = useMock();
  const startId = useId();
  const endId = useId();
  useShortcuts();
  const cells = statusCells(m);
  return (
    <>
      <AppShell
        layout={m.layout}
        skipLabel="본문으로"
        size={m.layout === "compact" ? "sm" : "md"}
        className="h-auto min-h-0 flex-1 pb-0"
      >
        <AppShellTitlebar className="min-w-0 px-1">
          <Titlebar startId={startId} endId={endId} />
        </AppShellTitlebar>
        <AppShellStart className={m.startOpen || m.layout === "compact" ? undefined : "-me-2.5"}>
          <StartPanel id={startId} />
        </AppShellStart>
        <AppShellStage stageLabel="대화" className="flex flex-col bg-surface-base">
          <StageContent />
        </AppShellStage>
        <AppShellEnd className={m.endOpen || m.layout !== "wide" ? undefined : "-ms-2.5"}>
          <EndPanel id={endId} />
        </AppShellEnd>
      </AppShell>
      <StatusBar start={cells.start} end={cells.end} />
      <Palette />
      <LockedDialog />
    </>
  );
}
