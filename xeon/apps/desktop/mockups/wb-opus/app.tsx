// 작업대 시안 앱: 공용 셸 하나에 두 영역을 꽂는다(§4.9, DP-18). 왼쪽 패널 내용·오른쪽 탭·가운데만 영역마다 바뀐다.
import { EmptyState, Toaster } from "@caustic/react";
import { useState } from "react";
import {
  approvals,
  chatRightTabs,
  Compass,
  defaultStatusCells,
  inbox,
  NoticeList,
  pluginPages,
  Shell,
  ToolApprovalCard,
  workbenchNav,
  workbenchRightTabs,
  type Decision,
} from "../_shell";
import { ChatRuntime } from "./screens/chat-runtime";
import { Detail } from "./screens/detail";
import { ExtensionList } from "./screens/extensions";
import { Overview } from "./screens/overview";
import { PluginView } from "./screens/plugin-view";
import { RuntimePanel } from "./screens/runtime-panel";
import { HelmWell } from "./screens/helm-well";
import { useMock, type Screen } from "./store";
import { WB_WIDTH, WorkbenchHead } from "../_shell";

/** 받은 요청 탭(두 영역 맨 위, §4.9.4): 승인은 어느 영역에서도 답한다. */
function InboxContent() {
  const [d, setD] = useState<Decision>("pending");
  return (
    <div className="grid gap-5">
      <section aria-label="승인" className="grid gap-1.5">
        <h3 className="m-0 flex items-baseline gap-1.5 text-ui-sm font-semibold text-text-primary">
          승인 <span className="tabular-nums text-text-tertiary">{d === "pending" ? 1 : 0}</span>
        </h3>
        <ToolApprovalCard
          flat
          approval={approvals.a1}
          decision={d}
          subtitle={`${approvals.a1.thread} · ${approvals.a1.at} · core`}
          onDecide={setD}
        />
      </section>
      <section aria-label="알림" className="grid gap-1.5">
        <h3 className="m-0 text-ui-sm font-semibold text-text-primary">알림</h3>
        <NoticeList notices={inbox.notices} />
      </section>
    </div>
  );
}

const NAV_OF: Record<Screen, string> = {
  overview: "overview",
  extensions: "extensions",
  detail: "extensions",
  view: "helm/inquiry",
  chat: "chat",
  other: "",
};

function Other() {
  const m = useMock();
  return (
    <>
      <WorkbenchHead title={m.otherLabel} />
      <div className={`${WB_WIDTH} grid flex-1 place-items-center`}>
        <EmptyState size="sm" surface="none" title="이 화면은 2차 시안(W6–W9)에서 그려요" />
      </div>
    </>
  );
}

export function App() {
  const m = useMock();
  const wb = m.area === "workbench";
  // 안전 모드(S2)면 L3 그룹과 외부 확장이 빠져 자동 꺼짐·drive·확장 실패가 모두 없다.
  const autoOff = m.safeMode ? 0 : m.exts.filter((e) => e.status === "auto_disabled").length;
  const nav = workbenchNav.map((n) =>
    n.id === "extensions"
      ? autoOff > 0
        ? { ...n, badge: `!${autoOff}`, badgeLabel: `자동 꺼짐 확장 ${autoOff}개` }
        : { id: n.id, label: n.label }
      : n,
  );
  const helmOn = !m.safeMode && m.ext("helm")?.status === "enabled";
  const reviewOn = !m.safeMode && m.ext("review")?.status === "enabled";
  const pages = pluginPages.map((p) => ({
    ...p,
    disabled: p.ext === "helm" ? !helmOn : p.ext === "review" ? !reviewOn : p.disabled,
  }));
  const activeNav = m.screen === "other" ? m.otherLabelId : NAV_OF[m.screen];

  const onNavSelect = (id: string) => {
    if (id === "chat") return m.go("chat");
    if (id === "proposals" || id === "schedules") return m.go("chat");
    if (id === "overview") return m.go("overview");
    if (id === "extensions") return m.go("extensions");
    if (id === "helm/inquiry") return m.go("view");
    if (id === "review/queue") return m.openDetail("review", "views");
    const n = workbenchNav.find((x) => x.id === id);
    m.go("other", n?.label ?? id, id);
  };

  return (
    <>
      <Shell
        activeNav={activeNav}
        onNavSelect={onNavSelect}
        stageLabel={wb ? "작업대" : "대화"}
        workbench={{ nav, pages, onGoToThread: () => m.go("chat") }}
        threads={{ currentId: "t1", onSelect: () => m.go("chat"), onNew: () => {} }}
        rightTabs={
          wb
            ? workbenchRightTabs({
                inbox: <InboxContent />,
                inboxBadge: 4,
                onGoToThread: () => m.go("chat"),
              })
            : chatRightTabs({
                inbox: <InboxContent />,
                inboxBadge: 4,
                runtime: <RuntimePanel />,
                runtimeBadge: 1,
                plugins: helmOn
                  ? [
                      {
                        id: "helm/panel",
                        label: "탐구",
                        icon: <Compass />,
                        ext: "helm",
                        content: <HelmWell />,
                        expand: { label: "Helm 탐구 크게 보기", onSelect: m.openView },
                      },
                    ]
                  : [],
              })
        }
        status={defaultStatusCells({
          layout: m.layout,
          thread: !wb,
          pendingApprovals: 2,
          openEnd: m.openEnd,
          ...(m.offline
            ? {
                link: {
                  id: "link",
                  text: "연결 끊김",
                  dot: "danger" as const,
                  title: "연결 끊김",
                  description:
                    "엔진과 연결이 끊겼어요. 작업대의 쓰기 동작은 연결되면 다시 쓸 수 있어요.",
                },
              }
            : {}),
          runtime: {
            drive: m.safeMode ? null : m.driveHolder,
            extFailures: m.safeMode ? 0 : 1,
            onOpen: () => (wb ? m.go("overview") : m.openEnd("runtime")),
          },
        })}
        onPaletteRun={(group, label) => {
          if (group === "대화") m.go("chat");
          else if (label === "작업대 개요") m.go("overview");
          else if (label === "확장") m.go("extensions");
          else if (label === "Helm 탐구") m.go("view");
        }}
      >
        {m.screen === "chat" ? (
          <ChatRuntime />
        ) : m.screen === "overview" ? (
          <Overview />
        ) : m.screen === "extensions" ? (
          <ExtensionList />
        ) : m.screen === "detail" ? (
          <Detail />
        ) : m.screen === "view" ? (
          <PluginView />
        ) : (
          <Other />
        )}
      </Shell>
      <Toaster label="알림" />
    </>
  );
}
