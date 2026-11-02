// 런타임 지도 시안 A 앱: 공용 셸(크래프트 영역) 위에 지도(내비 "개요")와 구성기(내비 "구성", 만들기를 합침).
// 오른쪽 well: 검사(고른 블록) · 받은 요청 · 기록 · 대화. 맥락은 왼쪽 패널 맥락 칸 하나(결정 3).
import {
  NoticeList,
  Shell,
  SlidersHorizontal,
  defaultStatusCells,
  inbox,
  useShell,
  workbenchNav,
  workbenchRightTabs,
} from "../_shell";
import { ContextField } from "./parts/context-field";
import { Inspector } from "./parts/inspector";
import { ComposeScreen } from "./screens/compose";
import { MapScreen } from "./screens/map";
import { MockProvider, useMock, type StateId } from "./store";

function Notice() {
  const m = useMock();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-14 z-20 flex justify-center"
    >
      {m.notice !== null && (
        <span className="animate-enter rounded-lg bg-surface-raised px-3 py-1.5 text-ui-dense text-text-primary shadow-3">
          {m.notice}
        </span>
      )}
    </div>
  );
}

function Page() {
  const m = useMock();
  const shell = useShell();
  const goThread = () => shell.setArea("chat");
  const tabs = [
    { id: "inspect", label: "검사", icon: <SlidersHorizontal />, content: <Inspector /> },
    ...workbenchRightTabs({
      inbox: <NoticeList notices={inbox.notices} />,
      inboxBadge: 5,
      onGoToThread: goThread,
    }),
  ];
  return (
    <Shell
      activeNav={m.screen === "map" ? "overview" : "compose"}
      onNavSelect={(id) => {
        if (id === "overview") m.set({ screen: "map" });
        else if (id === "compose") m.set({ screen: "compose" });
        else m.notify("이 화면은 크래프트 1·2차 시안에 있어요");
      }}
      workbench={{
        onGoToThread: goThread,
        nav: workbenchNav.filter((n) => n.id !== "create"),
        contextField: (
          <ContextField
            value={m.ctx}
            onChange={(v) => {
              m.set({ ctx: v, diff: false });
              shell.setContextThreadId(v.startsWith("t") ? v : null);
            }}
            onGoToThread={goThread}
          />
        ),
      }}
      stageLabel={m.screen === "map" ? "런타임 지도" : "구성"}
      threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
      rightTabs={tabs}
      status={defaultStatusCells({
        layout: shell.layout,
        thread: false,
        pendingApprovals: 2,
        openEnd: shell.openEnd,
        runtime: { drive: "helm", extFailures: 1, onOpen: () => m.select("acme-notes") },
      })}
    >
      <div className="wbv2 relative flex min-h-0 flex-1 flex-col">
        {m.screen === "map" ? <MapScreen /> : <ComposeScreen />}
        <Notice />
      </div>
    </Shell>
  );
}

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  return (
    <MockProvider
      state={state}
      onSelect={(id) => (id !== null ? shell.openEnd("inspect") : undefined)}
    >
      <Page />
    </MockProvider>
  );
}
