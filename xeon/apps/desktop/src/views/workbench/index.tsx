// 크래프트 화면 묶음(프로필·리뷰·플러그인·테스트·메트릭, 목적 화면 트레이스, 내비 없는 측정·구성). `desktop-registry.tsx`가 `registerWorkbench`를 부른다.
import { lazy, Suspense, useMemo, type ReactNode } from "react";
import {
  useWorkbench,
  WorkbenchStoreContext,
  type WorkbenchStore,
} from "../../state/workbench/index.ts";
import { ComposeScreen } from "../compose/compose-screen.tsx";
import { ExtensionsScreen } from "./extensions-screen.tsx";
import type { EndTabDef, ShellRegistry, TabBadge } from "../shell/registry.ts";
import { InspectTab } from "./inspect-tab.tsx";
import { MetricsScreen } from "../measure/metrics-screen.tsx";
import { CraftMetricsScreen } from "../craft/metrics/metrics-screen.tsx";
import { CraftTraceScreen } from "../craft/trace/trace-screen.tsx";
import { PluginPagesTab } from "../plugin/plugin-tabs.tsx";
import { RuntimeTab } from "../runtime/runtime-tab.tsx";
import { RecordsJump } from "./records-jump.tsx";
import { ThreadProfile } from "./thread-profile.tsx";
import { TestsScreen } from "../tests/tests-screen.tsx";
import { ReviewBadge, ReviewMark } from "../craft/review/review-badge.tsx";
import { ReviewScreen } from "../craft/review/review-screen.tsx";
import { TestChatLayer } from "../craft/test-chat/test-chat-layer.tsx";
import { AutoOffNotice, noticeCountOf } from "./craft-parts.tsx";
import { detachVoid, useWorkbenchController } from "./controller.ts";
import { HookAnswersContext, HookNoticeList } from "./hook-notice.tsx";
import {
  Eye,
  FlaskConical,
  History,
  Layers,
  ListChecks,
  Package,
  Plug,
  Rows3,
  Spline,
  SquareStack,
  Target,
} from "@caustic/react/icons";

const ProfileScreen = lazy(() =>
  import("../craft/canvas/cv6/index.tsx").then((m) => ({ default: m.Screen })),
);

function scoped(store: WorkbenchStore, children: ReactNode): ReactNode {
  return <WorkbenchStoreContext value={store}>{children}</WorkbenchStoreContext>;
}

export function registerWorkbench(registry: ShellRegistry, store: WorkbenchStore): void {
  registry.registerScreen({
    id: "profile",
    area: "workbench",
    label: "desktop.shell.nav.profile",
    icon: <Rows3 />,
    // 프로필 캔버스(C3)가 무대 가장자리까지 깔린다. @xyflow는 이 화면을 열 때 불러온다
    bleed: true,
    render: () => (
      <Suspense fallback={null}>
        <ProfileScreen />
      </Suspense>
    ),
  });
  registry.registerScreen({
    id: "craftReview",
    area: "workbench",
    label: "desktop.shell.nav.review",
    icon: <ListChecks />,
    Mark: ReviewMark,
    Badge: ReviewBadge,
    // 목록과 두 열이 창 끝까지 가고, 막대와 겹치는 줄만 화면이 비킨다(m6R5, `review-view.tsx`의 `useRailAvoid`)
    bleed: true,
    render: () => <ReviewScreen />,
  });
  registry.registerScreen({
    id: "extensions",
    area: "workbench",
    label: "desktop.shell.nav.extensions",
    icon: <Package />,
    render: () => scoped(store, <ExtensionsScreen />),
  });
  registry.registerScreen({
    id: "tests",
    area: "workbench",
    label: "desktop.shell.nav.tests",
    icon: <FlaskConical />,
    render: () => <TestsScreen />,
  });
  registry.registerScreen({
    id: "craft-metrics",
    area: "workbench",
    label: "desktop.shell.nav.craftMetrics",
    icon: <Spline />,
    render: () => <CraftMetricsScreen />,
  });
  // 내비 줄이 없는 화면 둘: 옮길 기능이 남아 있어 아직 둔다(AGE-69)
  registry.registerScreen({
    id: "metrics",
    area: "workbench",
    label: "desktop.shell.nav.metrics",
    icon: <Target />,
    render: () => <MetricsScreen />,
  });
  registry.registerScreen({
    id: "compose",
    area: "workbench",
    label: "desktop.shell.nav.compose",
    icon: <SquareStack />,
    render: () => scoped(store, <ComposeScreen />),
  });
  // 트레이스(C8)는 목적 화면이다. 내비 줄 없이 메트릭의 근거 줄과 대화의 "이 턴 기록"이 연다(`craft/trace/target.ts`)
  registry.registerScreen({
    id: "trace",
    area: "workbench",
    label: "desktop.shell.screen.trace",
    icon: <History />,
    render: () => <CraftTraceScreen />,
  });
}

/** 오른쪽 "검사" 탭(§6.22.4). 같은 스토어를 읽도록 워크벤치 스토어를 받는다. `desktop-registry.tsx`가 등록한다 */
export function inspectEndTab(store: WorkbenchStore): EndTabDef {
  return {
    id: "inspect",
    area: "workbench",
    label: "desktop.shell.tab.inspect",
    icon: <Eye />,
    // 테스트 챗 창(C7)은 Craft 어디서나 떠 있어야 해서 Craft 영역의 모든 화면에 서는 이 탭과 함께 그린다(`craft/test-chat/test-chat-layer.tsx`)
    alwaysMounted: scoped(store, <TestChatLayer />),
    render: () => scoped(store, <InspectTab />),
  };
}

/** 오른쪽 "플러그인" 탭의 칸 숫자: 알림이 있는 확장 수. 스토어가 바뀌면 칸도 다시 읽는다 */
function noticeBadgeOf(store: WorkbenchStore): TabBadge {
  return {
    read: () => {
      const state = store.read.getState();
      return noticeCountOf(state.entries) + state.hookNotices.length;
    },
    subscribe: (listener) => store.read.subscribe(listener),
  };
}

/** 오른쪽 "런타임" 탭 칸의 숫자: 외부 훅 알림 수. 안전 모드면 스토어가 훅을 담지 않아 0이다 */
function hookBadgeOf(store: WorkbenchStore): TabBadge {
  return {
    read: () => store.read.getState().hookNotices.length,
    subscribe: (listener) => store.read.subscribe(listener),
  };
}

/**
 * 막대와 함께 늘 있는 부품: 탭을 열지 않아도 확장 목록을 읽어 두어 칸의 숫자가 맞는다.
 * 목록은 연결이 살아 있을 때 읽고, 확장이 바뀌면 다시 읽는다(컨트롤러가 맡는다).
 */
function ListKeeper(): ReactNode {
  useWorkbenchController();
  return null;
}

/**
 * 대화 영역의 "런타임" 탭(§4.9.8). 탭 안 맨 위에 외부 훅 알림을 두고(`RuntimeTab`), 칸의 숫자는 훅 알림 수다.
 * 워크벤치 스토어를 받아 플러그인 탭과 같은 목록을 읽는다. `desktop-registry.tsx`가 등록한다.
 */
export function runtimeEndTab(store: WorkbenchStore): EndTabDef {
  return {
    id: "runtime",
    area: "chat",
    label: "desktop.shell.tab.runtime",
    icon: <Layers />,
    badge: hookBadgeOf(store),
    // Drive 카드의 "기록 보기"가 플러그인 상세로 간다(lcM6c)
    render: () =>
      scoped(
        store,
        <RecordsJump>
          <RuntimeTab />
        </RecordsJump>,
      ),
  };
}

/**
 * 오른쪽 "플러그인" 탭 안. 맨 위에 알림이 있는 확장마다 `AutoOffNotice`(질문과 두 답)를 두고, 그 아래에 이 대화의 프로필, 그 아래는 `PluginPagesTab`이다.
 * 알림은 이 탭만 쓰므로 `PluginPagesTab`(플러그인 화면도 쓴다) 안에 넣지 않는다.
 */
function PluginPagesEndTab(): ReactNode {
  const controller = useWorkbenchController();
  const entries = useWorkbench((s) => s.entries);
  const hookAnswers = useMemo(
    () => ({
      keepOn: (hook: string) => controller.hookKeepOn(hook),
      keepOff: (hook: string) => controller.hookKeepOff(hook),
    }),
    [controller],
  );
  return (
    <>
      {/* 빈 칸은 숨긴다. 답한 결과 줄이 남도록 항목마다 부품은 그대로 둔다 */}
      <div className="grid gap-2 [&:empty]:hidden">
        {entries.map((entry) => (
          <AutoOffNotice
            key={entry.name}
            entry={entry}
            compact
            onKeepOn={() => {
              detachVoid(controller.reenable(entry.name));
            }}
            onKeepOff={() => {
              detachVoid(controller.keepOff(entry.name));
            }}
          />
        ))}
        <HookAnswersContext value={hookAnswers}>
          <HookNoticeList compact />
        </HookAnswersContext>
      </div>
      <ThreadProfile />
      <PluginPagesTab />
    </>
  );
}

/**
 * 오른쪽 "플러그인" 탭(`plugin-pages`, 대화 영역만: 이 대화에서 끄기와 이 대화의 프로필이 있다). 칸의 숫자는 알림 수이고, 탭 안 맨 위에 알림을 둔다.
 * `desktop-registry.tsx`가 등록한다. 워크벤치 스토어를 받아 같은 목록을 읽는다.
 */
export function pluginPagesEndTab(store: WorkbenchStore): EndTabDef {
  return {
    id: "plugin-pages",
    area: "chat",
    label: "desktop.plugin.tab.pages",
    icon: <Plug />,
    badge: noticeBadgeOf(store),
    alwaysMounted: scoped(store, <ListKeeper />),
    render: () => scoped(store, <PluginPagesEndTab />),
  };
}
