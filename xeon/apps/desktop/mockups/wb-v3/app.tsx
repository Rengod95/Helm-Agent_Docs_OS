// 캔버스 v3 앱: 공용 셸(크래프트) 위에 "개요"(층 × 단계 표 하나), 플러그인 상세, 프로필 차이.
// 왼쪽 패널 "보기 기준" 칸 하나가 모든 화면을 움직인다(결정 3). 오른쪽 well = 받은 요청 · 기록 · 대화.
import {
  NoticeList,
  Shell,
  defaultStatusCells,
  inbox,
  useShell,
  workbenchNav,
  workbenchRightTabs,
} from "../_shell";
import { T } from "../_shell/terms";
import { viewOf } from "./data";
import { ViewField } from "./parts/view-field";
import { DetailScreen } from "./screens/detail";
import { DiffScreen } from "./screens/diff";
import { StructureScreen } from "./screens/structure";
import { MockProvider, useMock, type StateId } from "./store";

function Notice() {
  const m = useMock();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-14 z-30 flex justify-center"
    >
      {m.notice !== null && (
        <span className="animate-enter rounded-full bg-surface-raised px-4 py-2 text-body text-text-primary shadow-3">
          {m.notice}
        </span>
      )}
    </div>
  );
}

// 결정 6: 만들기는 구성에 합침. "개요"는 "구조"로(SPEC §1).
const NAV = workbenchNav
  .filter((n) => n.id !== "create")
  .map((n) => (n.id === "overview" ? { ...n, label: T.structure } : n));

function Page() {
  const m = useMock();
  const shell = useShell();
  const goThread = () => shell.setArea("chat");
  const screen =
    m.screen === "detail" ? (
      <DetailScreen key={m.detail} />
    ) : m.screen === "diff" ? (
      <DiffScreen />
    ) : (
      <StructureScreen />
    );
  const v = viewOf(m.view);
  return (
    <Shell
      activeNav="overview"
      onNavSelect={(id) => {
        if (id === "overview") m.set({ screen: "structure", focus: null, overlay: null });
        else m.notify("이 화면은 크래프트 1·2차 시안에 있어요");
      }}
      workbench={{
        onGoToThread: goThread,
        nav: NAV,
        contextField: (
          <ViewField
            value={m.view}
            onChange={(val) => {
              const k = viewOf(val).kind;
              m.set(
                k === "preset"
                  ? {
                      preview: val,
                      view: m.view === "all" ? "t1" : m.view,
                    }
                  : { view: val },
              );
              shell.setContextThreadId(val.startsWith("t") ? val : null);
            }}
            onExplain={() =>
              m.set({
                overlay: "explain",
                screen: "structure",
              })
            }
            onGoToThread={goThread}
            preview={m.preview}
            onClearPreview={() =>
              m.set({ preview: null, screen: m.screen === "diff" ? "structure" : m.screen })
            }
          />
        ),
      }}
      stageLabel="크래프트"
      threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
      rightTabs={workbenchRightTabs({
        inbox: <NoticeList notices={inbox.notices} />,
        inboxBadge: 5,
        onGoToThread: goThread,
      })}
      status={defaultStatusCells({
        layout: shell.layout,
        thread: v.kind === "thread",
        pendingApprovals: 2,
        openEnd: shell.openEnd,
        runtime: {
          drive: "helm",
          extFailures: m.failure ? 3 : 1,
          onOpen: () =>
            m.set({ screen: "structure", failure: true, pick: { row: "L3", col: "boundary" } }),
        },
      })}
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {screen}
        <Notice />
      </div>
    </Shell>
  );
}

export function App({ state }: { state: StateId }) {
  return (
    <MockProvider state={state}>
      <Page />
    </MockProvider>
  );
}
