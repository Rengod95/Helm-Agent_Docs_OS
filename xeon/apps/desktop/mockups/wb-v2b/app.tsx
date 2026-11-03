// 방향 B 앱: 공용 셸(크래프트) 위에 화면 여섯(지도, 그룹 하위 캔버스, 흐름, 표, 차이, 빈). 오른쪽 well = 검사기 · 블록 · 받은 요청 · 기록 · 대화.
import {
  NoticeList,
  Shell,
  SlidersHorizontal,
  Package,
  defaultStatusCells,
  inbox,
  useShell,
  workbenchNav,
  workbenchRightTabs,
} from "../_shell";
import { ContextField } from "./parts/context-field";
import { Inspector } from "./parts/inspector";
import { Library } from "./screens/library";
import { MapScreen } from "./screens/map-screen";
import { GroupScreen } from "./screens/group-screen";
import { FlowScreen } from "./screens/flow-screen";
import { TableScreen } from "./screens/table-screen";
import { DiffScreen } from "./screens/diff-screen";
import { EmptyScreen } from "./screens/empty-screen";
import { MockProvider, useMock, type StateId } from "./store";

function Notice() {
  const m = useMock();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-16 z-30 flex justify-center"
    >
      {m.notice !== null && (
        <span className="animate-enter rounded-lg bg-surface-raised px-3 py-1.5 text-ui-dense text-text-primary shadow-3">
          {m.notice}
        </span>
      )}
    </div>
  );
}

// 결정 6: 구성과 만들기를 "구성" 하나로. "새 그룹"은 구성기 안 동작.
const NAV = workbenchNav.filter((n) => n.id !== "create");

function Page() {
  const m = useMock();
  const shell = useShell();
  const goThread = () => shell.setArea("chat");
  const active = m.composer
    ? "compose"
    : m.trial
      ? "tests"
      : m.screen === "table"
        ? "metrics"
        : "overview";
  const tabs = [
    {
      id: "inspect",
      label: "검사",
      icon: <SlidersHorizontal />,
      content: <Inspector id={m.selected} failure={m.mapMode === "failure"} onAction={m.notify} />,
    },
    ...(m.composer
      ? [{ id: "library", label: "블록", icon: <Package />, content: <Library /> }]
      : []),
    ...workbenchRightTabs({
      inbox: <NoticeList notices={inbox.notices} />,
      inboxBadge: 5,
      onGoToThread: goThread,
    }),
  ];
  const screen =
    m.screen === "map" ? (
      <MapScreen />
    ) : m.screen === "group" ? (
      <GroupScreen />
    ) : m.screen === "flow" ? (
      <FlowScreen />
    ) : m.screen === "table" ? (
      <TableScreen />
    ) : m.screen === "diff" ? (
      <DiffScreen />
    ) : (
      <EmptyScreen />
    );
  const empty = m.screen === "empty";
  return (
    <Shell
      activeNav={active}
      onNavSelect={(id) => {
        if (id === "overview") m.set({ screen: "map", composer: false, edit: null, trial: false });
        else if (id === "metrics") m.set({ screen: "table", composer: false, trial: false });
        else if (id === "compose")
          m.set({ screen: "group", composer: true, edit: null, trial: false });
        else if (id === "tests")
          m.set({ screen: "flow", composer: false, trial: true, ctx: "x-helm5" });
        else m.notify("이 화면은 크래프트 1·2차 시안에 있어요");
      }}
      workbench={{
        onGoToThread: goThread,
        nav: empty
          ? NAV.map((n) =>
              n.id === "extensions" ? { ...n, badge: undefined, badgeLabel: undefined } : n,
            )
          : NAV,
        ...(empty ? { pages: [] } : {}),
        contextField: (
          <ContextField
            value={m.ctx}
            onChange={(v) => {
              m.set({
                ctx: v,
                mapMode: v === "t1" ? "thread" : m.mapMode === "thread" ? "normal" : m.mapMode,
                screen: v.startsWith("p-") ? "diff" : m.screen === "diff" ? "map" : m.screen,
              });
              shell.setContextThreadId(v.startsWith("t") ? v : null);
            }}
            onGoToThread={goThread}
          />
        ),
      }}
      stageLabel="크래프트"
      threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
      rightTabs={tabs}
      status={defaultStatusCells({
        layout: shell.layout,
        thread: false,
        pendingApprovals: 2,
        openEnd: shell.openEnd,
        runtime: {
          drive: empty ? null : "helm",
          extFailures: empty ? 0 : 1,
          onOpen: () => m.set({ screen: "map", mapMode: "failure", selected: "review" }),
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
