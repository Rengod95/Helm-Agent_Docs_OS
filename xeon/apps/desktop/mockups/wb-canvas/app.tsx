// 런타임 캔버스 시안 앱: 공용 셸(크래프트 영역) 위에 캔버스 개요 하나. 왼쪽 패널 맥락 칸은 캔버스 맥락(넷)으로 바꿔 끼운다.
// 오른쪽 well: 검사(고른 블록) · 받은 요청 · 기록 · 대화. 다른 크래프트 화면은 1·2차 시안이 맡는다(알림 한 줄).
import {
  SlidersHorizontal,
  NoticeList,
  Shell,
  defaultStatusCells,
  inbox,
  useShell,
  workbenchNav,
  workbenchRightTabs,
} from "../_shell";
import { CanvasScreen } from "./canvas-screen";
import { ContextField } from "./parts/context-field";
import { Inspector } from "./parts/inspector";
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
    {
      id: "inspect",
      label: "검사",
      icon: <SlidersHorizontal />,
      content: (
        <Inspector
          id={m.selected}
          ctx={m.ctx}
          offline={m.mode === "offline"}
          onOpenDetail={() => m.notify("확장 상세(P-17)는 크래프트 1차 시안에 있어요")}
          onAction={m.notify}
        />
      ),
    },
    ...workbenchRightTabs({
      inbox: <NoticeList notices={inbox.notices} />,
      inboxBadge: 5,
      onGoToThread: goThread,
    }),
  ];
  return (
    <Shell
      activeNav="overview"
      onNavSelect={(id) => {
        if (id !== "overview") m.notify("이 화면은 크래프트 1·2차 시안에 있어요");
      }}
      workbench={{
        onGoToThread: goThread,
        // 빈(내장만)·안전 모드에는 자동 꺼짐 배지와 그룹의 플러그인 화면이 없다.
        ...(m.mode === "empty" || m.mode === "safe"
          ? {
              nav: workbenchNav.map((n) =>
                n.id === "extensions" ? { ...n, badge: undefined, badgeLabel: undefined } : n,
              ),
              pages: [],
            }
          : {}),
        contextField: (
          <ContextField
            value={m.ctx}
            onChange={(v) => {
              m.set({ ctx: v, compare: null, replay: null });
              shell.setContextThreadId(v.startsWith("t") ? v : null);
            }}
            onGoToThread={goThread}
          />
        ),
      }}
      stageLabel="크래프트 개요"
      threads={{ currentId: "t1", onSelect: () => {}, onNew: () => {} }}
      rightTabs={tabs}
      status={defaultStatusCells({
        layout: shell.layout,
        thread: false,
        pendingApprovals: 2,
        openEnd: shell.openEnd,
        runtime: {
          drive: m.mode === "safe" || m.mode === "empty" ? null : "helm",
          extFailures: m.mode === "safe" || m.mode === "empty" ? 0 : 1,
          onOpen: () => m.select("acme-notes"),
        },
        ...(m.mode === "offline"
          ? {
              link: {
                id: "link",
                text: "연결 끊김",
                dot: "danger" as const,
                title: "연결",
                description: "엔진과 연결이 끊겼어요. 14:03 기준 값이에요.",
              },
            }
          : {}),
      })}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <CanvasScreen />
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
      onSelect={(id) => {
        if (id !== null) shell.openEnd("inspect");
      }}
    >
      <Page />
    </MockProvider>
  );
}
