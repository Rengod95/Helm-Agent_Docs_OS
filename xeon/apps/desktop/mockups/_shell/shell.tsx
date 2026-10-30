// 공용 창 셸(DP-01~10, DP-13). 제목 띠 없음.
//   왼쪽 패널(표면, 창 위아래 끝까지) | 가운데(투명, 페이지 내용) | 오른쪽 떠 있는 세로 막대 + 펼친 well
// 가운데 아래에 상태 표시줄. 건너뛰기 링크, 팔레트, 전역 바로 가기 키(⌘K 팔레트, ⌘\ 왼쪽 패널, ⌘J 오른쪽 well,
// ⌘N 새 대화, Esc 뜬 패널 닫기)를 셸이 맡는다. ShellStateProvider 안에서 쓴다.
import { useEffect, type ReactNode } from "react";
import { Palette } from "./palette";
import { StatusBar, type StatusCell } from "./parts/status-bar";
import { RightPanel, type RightTab } from "./right-panel";
import { StartPanel, type ThreadListProps } from "./start-panel";
import { useShell } from "./state";

export const STAGE_ID = "stage";

export interface ShellProps {
  /** 지금 화면인 주 내비 항목 id: chat, inbox, proposals, schedules, connection. */
  activeNav: string;
  /** 주 내비 항목을 눌렀을 때(받은 요청은 셸이 오른쪽 well을 연다). */
  onNavSelect?: (id: string) => void;
  /** 왼쪽 대화 목록의 고른 대화와 동작. */
  threads: ThreadListProps;
  /** 오른쪽 막대의 탭. 보통 standardRightTabs(...). */
  rightTabs: RightTab[];
  /** 상태 표시줄 칸. 보통 defaultStatusCells(...). */
  status: { start: StatusCell[]; end: StatusCell[] };
  /** 팔레트에서 항목을 골랐을 때(묶음, 라벨). */
  onPaletteRun?: (group: string, label: string) => void;
  /** 가운데 main 랜드마크 이름. */
  stageLabel?: string;
  /** 페이지의 대화 상자가 열려 있으면 Esc를 셸이 쓰지 않는다. */
  modalOpen?: boolean;
  /** 가운데 내용. 투명 면 위에 그린다(카드로 감싸지 않는다, DP-01). */
  children: ReactNode;
}

function useShellShortcuts(onNew: () => void, modalOpen: boolean) {
  const m = useShell();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !m.paletteOpen && !modalOpen) {
        if (m.layout !== "wide" && m.endOpen) return m.setEndOpen(false);
        if (m.layout === "compact" && m.startOpen) return m.setStartOpen(false);
      }
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const act: Record<string, () => void> = {
        k: () => m.setPaletteOpen(!m.paletteOpen),
        "\\": () => m.setStartOpen(!m.startOpen),
        j: () => m.setEndOpen(!m.endOpen),
        n: onNew,
      };
      const f = act[k];
      if (f !== undefined) {
        e.preventDefault();
        f();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [m, onNew, modalOpen]);
}

export function Shell({
  activeNav,
  onNavSelect,
  threads,
  rightTabs,
  status,
  onPaletteRun,
  stageLabel = "본문",
  modalOpen = false,
  children,
}: ShellProps) {
  const m = useShell();
  useShellShortcuts(threads.onNew, modalOpen);
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
          <StartPanel
            floating={compact}
            activeNav={activeNav}
            onNavSelect={onNavSelect}
            threads={threads}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 gap-1.5 p-1.5 pb-0">
            <main
              id={STAGE_ID}
              tabIndex={-1}
              aria-label={stageLabel}
              className="flex min-w-0 flex-1 flex-col outline-none"
            >
              {children}
            </main>
            <RightPanel tabs={rightTabs} />
          </div>
          <StatusBar start={status.start} end={status.end} />
        </div>
      </div>
      <Palette onRun={onPaletteRun} />
    </>
  );
}
