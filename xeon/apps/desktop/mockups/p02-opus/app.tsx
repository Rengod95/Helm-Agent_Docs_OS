// P-02 대화 화면. 공용 셸(../_shell) 안에 대화 내용(StageContent)과 받은 요청 탭 내용(InboxContent)을 꽂는다.
import { useEffect } from "react";
import { defaultStatusCells, Shell, standardRightTabs, threads, type StatusCell } from "../_shell";
import { InboxContent } from "./inbox";
import { LockedDialog } from "./locked-dialog";
import { StageContent } from "./stage";
import { useMock } from "./store";

/** 이 화면만의 바로 가기 키: ⌘. 중단, ⌘L 입력창. ⌘K·⌘\\·⌘J·⌘N·Esc는 셸이 맡는다. */
function usePageShortcuts() {
  const m = useMock();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === ".") {
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

export function App() {
  const m = useMock();
  usePageShortcuts();
  const link: StatusCell | undefined = m.reconnecting
    ? {
        id: "link",
        text: "다시 맞추는 중 (2/3)",
        dot: "warning",
        title: "다시 맞추는 중",
        description: "연결이 끊겨 엔진과 상태를 다시 맞추고 있어요 (3번 중 2번째).",
        action: { label: "다시 연결", onSelect: m.reconnect },
      }
    : undefined;
  return (
    <>
      <Shell
        activeNav="chat"
        stageLabel="대화"
        modalOpen={m.lockedOpen}
        threads={{
          currentId: m.currentId,
          draft: m.view === "empty",
          onSelect: m.selectThread,
          onNew: m.newThread,
        }}
        rightTabs={standardRightTabs({
          inbox: <InboxContent />,
          inboxBadge: m.pendingApprovals + 3,
          ...(m.view === "none" ? { only: ["inbox"] } : {}),
        })}
        status={defaultStatusCells({
          layout: m.layout,
          thread: m.view === "thread",
          pendingApprovals: m.pendingApprovals,
          openEnd: m.openEnd,
          link,
        })}
        onPaletteRun={(group, label) => {
          if (group === "대화") {
            const t = threads.find((x) => x.title === label);
            if (t) m.selectThread(t.id);
          } else if (label === "새 대화") m.newThread();
          else if (label === "중단") m.stop();
        }}
      >
        <StageContent />
      </Shell>
      <LockedDialog />
    </>
  );
}
