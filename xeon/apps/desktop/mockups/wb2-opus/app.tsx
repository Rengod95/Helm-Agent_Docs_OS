// 크래프트 2차 시안 앱: 공용 셸(크래프트 영역) 위에 W6–W9 화면 하나를 꽂는다. 화면 바꾸기는 왼쪽 패널 크래프트 내비(셸)로.
// 이 시안에 없는 크래프트 화면(개요, 확장, 엔진, 플러그인 화면)과 대화 영역은 1차 시안(wb1)·P-02가 맡는다: 알림 한 줄만.
import { EmptyState } from "@caustic/react";
import {
  Layers,
  MessageSquare,
  NoticeList,
  Shell,
  defaultStatusCells,
  inbox,
  useShell,
  workbenchRightTabs,
} from "../_shell";
import { ComposeScreen } from "./screens/compose";
import { CreateScreen } from "./screens/create";
import { MetricsScreen } from "./screens/metrics";
import { NewTrialSheet } from "./screens/new-trial";
import { TrialsScreen } from "./screens/trials";
import { useMock, type Screen } from "./store";

const MINE: Screen[] = ["tests", "metrics", "compose", "create"];

function Notice() {
  const m = useMock();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center"
    >
      {m.notice !== null && (
        <span className="animate-enter rounded-lg bg-surface-raised px-3 py-1.5 text-ui-dense text-text-primary shadow-3">
          {m.notice}
        </span>
      )}
    </div>
  );
}

export function App() {
  const m = useMock();
  const shell = useShell();
  const goThread = () => {
    shell.setArea("chat");
  };
  return (
    <Shell
      activeNav={shell.area === "workbench" ? m.screen : "chat"}
      onNavSelect={(id) => {
        if ((MINE as string[]).includes(id)) m.set({ screen: id as Screen });
        else m.notify("이 화면은 크래프트 1차 시안에 있어요");
      }}
      workbench={{ onGoToThread: goThread }}
      stageLabel={shell.area === "workbench" ? "크래프트" : "대화"}
      modalOpen={m.newTrialOpen}
      threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
      rightTabs={workbenchRightTabs({
        inbox: <NoticeList notices={inbox.notices} />,
        inboxBadge: 5,
        onGoToThread: goThread,
      })}
      status={defaultStatusCells({
        layout: shell.layout,
        thread: false,
        pendingApprovals: 2,
        openEnd: shell.openEnd,
        runtime: { drive: "helm", extFailures: 1, onOpen: () => m.notify("크래프트 개요로 가요") },
      })}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        {shell.area === "chat" ? (
          <EmptyState
            size="md"
            surface="none"
            icon={<MessageSquare />}
            title="대화 영역은 P-02 시안에 있어요"
            className="mt-16"
            actions={[{ label: "크래프트로", onClick: () => shell.setArea("workbench") }]}
          />
        ) : (
          <>
            {m.screen === "tests" && <TrialsScreen />}
            {m.screen === "metrics" && <MetricsScreen />}
            {m.screen === "compose" && <ComposeScreen />}
            {m.screen === "create" && <CreateScreen />}
            {!MINE.includes(m.screen) && (
              <EmptyState
                size="md"
                surface="none"
                icon={<Layers />}
                title="크래프트 1차 시안에 있는 화면이에요"
                className="mt-16"
              />
            )}
          </>
        )}
        <Notice />
      </div>
      <NewTrialSheet />
    </Shell>
  );
}
