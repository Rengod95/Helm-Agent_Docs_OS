// 크래프트 v5: 에이전트가 무엇으로 이뤄졌나(지도), 무엇이 언제 어떤 순서로 도나(순서), 고른 것이 무엇인가(카드).
// 범위 막대·표는 없다. 어디에 적용되나는 플러그인 카드에서 "꺼짐 · 이 대화 · 이 프로젝트 · 모든 대화"로 바로 정한다.
import { useEffect } from "react";
import {
  Shell,
  defaultStatusCells,
  inbox,
  NoticeList,
  useShell,
  workbenchRightTabs,
} from "../_shell";
import { T } from "../_shell/terms";
import { Builder } from "./builder";
import { Canvas } from "./canvas";
import { PluginDetail } from "./detail";
import { DragGhost } from "./drag";
import { Drawer } from "./lanes";
import { MockProvider, useMock } from "./store";

const NAV = [
  { id: "craft", label: T.workbench },
  { id: "tests", label: T.trials, badge: "1*", badgeLabel: "실행 중 1개" },
  { id: "metrics", label: T.metrics },
];

function Notice() {
  const m = useMock();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-14 z-40 flex justify-center"
    >
      {m.notice !== null && (
        <span className="animate-enter rounded-full bg-surface-raised px-4 py-2 text-body text-text-primary shadow-3">
          {m.notice}
        </span>
      )}
    </div>
  );
}

function Page() {
  const m = useMock();
  const shell = useShell();
  const b = m.builder;
  const { select } = m;
  const idle = !m.drawer.open && b === null;
  const { view, closeDetail, closeRing } = m;
  // Esc: 자세히 보기에서는 돌아가고, 아니면 선택과 패널을 푼다(열린 서랍·빌더가 없을 때).
  useEffect(() => {
    if (!idle) return undefined;
    const key = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (view === "detail") closeDetail();
      else {
        closeRing();
        select({ k: "agent" }, false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [idle, select, view, closeDetail, closeRing]);
  return (
    <Shell
      activeNav="craft"
      onNavSelect={() => {}}
      workbench={{ nav: NAV, onGoToThread: () => shell.setArea("chat"), contextField: <></> }}
      stageLabel={T.workbench}
      threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
      rightTabs={workbenchRightTabs({
        inbox: <NoticeList notices={inbox.notices} />,
        inboxBadge: 5,
        onGoToThread: () => shell.setArea("chat"),
      })}
      status={defaultStatusCells({
        layout: shell.layout,
        thread: true,
        pendingApprovals: 2,
        openEnd: shell.openEnd,
        runtime: { drive: "helm", extFailures: 3, onOpen: () => m.openDrawer(null) },
      })}
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          {m.view === "detail" ? <PluginDetail /> : <Canvas />}
        </div>
        {m.drawer.open && <Drawer />}
        {b !== null && (
          <div className="absolute inset-0 z-20 border-t border-border-subtle bg-bg-app shadow-3">
            <Builder
              hook={b.hook}
              templateId={b.template}
              onTemplate={m.setTemplate}
              onClose={m.closeBuilder}
              onCreate={({ name, template, reach }) =>
                m.create({ name, hook: b.hook, template, reach })
              }
            />
          </div>
        )}
        <Notice />
        <DragGhost />
      </div>
    </Shell>
  );
}

export function App() {
  return (
    <MockProvider>
      <Page />
    </MockProvider>
  );
}
