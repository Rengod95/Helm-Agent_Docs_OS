// P-02 대화 셸(2차, DP-01~10). AppShell 대신 이 화면에 맞춘 레이아웃: 제목 띠 없음.
// 왼쪽 패널(표면) | 대화 영역(투명, 창 바탕 그대로) | 오른쪽 떠 있는 세로 막대 + 펼친 well. 아래 상태 표시줄.
import { useEffect } from "react";
import { RightPanel } from "./right-panel";
import { status } from "./fixtures";
import { LockedDialog } from "./locked-dialog";
import { Palette } from "./palette";
import { StatusBar, TokenBar, type StatusCell } from "./parts/status-bar";
import { StageContent } from "./stage";
import { StartPanel } from "./start-panel";
import { useMock } from "./store";

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
              title: "목표",
              description: "목표 3개 중 2개를 이뤘어요.",
              action: { label: "작업 탭 열기", onSelect: () => m.openEnd("work") },
            },
            {
              id: "helm",
              text: "Helm",
              label: `Helm ${status.helm} 중`,
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
        title: "알림",
        description: "새 알림이 3개 있어요. 예약 실패 1개가 있어요.",
        action: openInbox,
      },
    ],
  };
}

export function App() {
  const m = useMock();
  useShortcuts();
  const cells = statusCells(m);
  const compact = m.layout === "compact";
  const skip = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById(STAGE_ID)?.focus();
  };
  return (
    <>
      <a
        href={`#${STAGE_ID}`}
        onClick={skip}
        className="absolute top-2 left-2 z-40 -translate-y-[200%] rounded-lg bg-control-raised px-3 py-2 text-ui-strong text-text-primary opacity-0 outline-none focus:translate-y-0 focus:opacity-100 focus-visible:focus-ring"
      >
        본문으로
      </a>
      {/* 왼쪽 패널은 창의 위아래 끝까지 붙는다(DP-13). 그 오른쪽 열에만 창 여백(1.5)을 한 번 주고, 상태 표시줄은 그 열 아래. */}
      <div className="relative flex min-h-0 flex-1">
        <div
          className={
            compact
              ? m.startOpen
                ? "absolute inset-y-0 start-0 z-30 flex w-[min(20rem,calc(100%-3rem))] animate-enter-panel enter-from-start"
                : "absolute"
              : "flex"
          }
        >
          <StartPanel floating={compact} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 gap-1.5 p-1.5 pb-0">
            <main
              id={STAGE_ID}
              tabIndex={-1}
              aria-label="대화"
              className="flex min-w-0 flex-1 flex-col outline-none"
            >
              <StageContent />
            </main>
            <RightPanel />
          </div>
          <StatusBar start={cells.start} end={cells.end} />
        </div>
      </div>
      <Palette />
      <LockedDialog />
    </>
  );
}

const STAGE_ID = "conversation";
