// 크래프트 화면 묶음(개요·확장·테스트·엔진). `desktop-registry.tsx`가 `registerWorkbench`를 부른다.
import type { ReactNode } from "react";
import {
  useWorkbench,
  WorkbenchStoreContext,
  type WorkbenchStore,
} from "../../state/workbench/index.ts";
import { CraftScreen } from "./craft-screen.tsx";
import { EngineScreen } from "./engine-screen.tsx";
import { ExtensionsScreen } from "./extensions-screen.tsx";
import type { EndTabDef, ShellRegistry, TabBadge } from "../shell/registry.ts";
import { InspectTab } from "./inspect-tab.tsx";
import { MetricsScreen } from "../measure/metrics-screen.tsx";
import { PluginPagesTab } from "../plugin/plugin-tabs.tsx";
import { TestsScreen } from "../tests/tests-screen.tsx";
import { AutoOffNotice, noticeCountOf } from "./craft-parts.tsx";
import { detachVoid, useWorkbenchController } from "./controller.ts";
import { Clock, Eye, FlaskConical, Layers, Package, Plug, Settings } from "@caustic/react/icons";

function scoped(store: WorkbenchStore, children: ReactNode): ReactNode {
  return <WorkbenchStoreContext value={store}>{children}</WorkbenchStoreContext>;
}

export function registerWorkbench(registry: ShellRegistry, store: WorkbenchStore): void {
  registry.registerScreen({
    id: "overview",
    area: "workbench",
    label: "desktop.shell.nav.overview",
    icon: <Layers />,
    render: () => scoped(store, <CraftScreen />),
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
    id: "metrics",
    area: "workbench",
    label: "desktop.shell.nav.metrics",
    icon: <Clock />,
    render: () => <MetricsScreen />,
  });
  registry.registerScreen({
    id: "engine",
    area: "workbench",
    label: "desktop.shell.nav.engine",
    icon: <Settings />,
    render: () => scoped(store, <EngineScreen />),
  });
}

/** 오른쪽 "검사" 탭(§6.22.4). 같은 스토어를 읽도록 워크벤치 스토어를 받는다. `desktop-registry.tsx`가 등록한다 */
export function inspectEndTab(store: WorkbenchStore): EndTabDef {
  return {
    id: "inspect",
    area: "workbench",
    label: "desktop.shell.tab.inspect",
    icon: <Eye />,
    render: () => scoped(store, <InspectTab />),
  };
}

/** 오른쪽 "플러그인" 탭의 칸 숫자: 알림이 있는 확장 수. 스토어가 바뀌면 칸도 다시 읽는다 */
function noticeBadgeOf(store: WorkbenchStore): TabBadge {
  return {
    read: () => noticeCountOf(store.read.getState().entries),
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
 * 오른쪽 "플러그인" 탭 안. 맨 위에 알림이 있는 확장마다 `AutoOffNotice`(질문과 두 답)를 두고, 그 아래는 `PluginPagesTab`이다.
 * 알림은 이 탭만 쓰므로 `PluginPagesTab`(플러그인 화면도 쓴다) 안에 넣지 않는다.
 */
function PluginPagesEndTab(): ReactNode {
  const controller = useWorkbenchController();
  const entries = useWorkbench((s) => s.entries);
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
      </div>
      <PluginPagesTab />
    </>
  );
}

/**
 * 오른쪽 "플러그인" 탭(`plugin-pages`, 대화·작업대 둘 다). 칸의 숫자는 알림 수이고, 탭 안 맨 위에 알림을 둔다.
 * `desktop-registry.tsx`가 등록한다. 워크벤치 스토어를 받아 같은 목록을 읽는다.
 */
export function pluginPagesEndTab(store: WorkbenchStore): EndTabDef {
  return {
    id: "plugin-pages",
    area: "both",
    label: "desktop.plugin.tab.pages",
    icon: <Plug />,
    badge: noticeBadgeOf(store),
    alwaysMounted: scoped(store, <ListKeeper />),
    render: () => scoped(store, <PluginPagesEndTab />),
  };
}
