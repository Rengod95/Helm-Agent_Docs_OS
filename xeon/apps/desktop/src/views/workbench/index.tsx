// 크래프트 화면 묶음(개요·확장·테스트·엔진). `desktop-registry.tsx`가 `registerWorkbench`를 부른다.
import type { ReactNode } from "react";
import { WorkbenchStoreContext, type WorkbenchStore } from "../../state/workbench/index.ts";
import { CraftScreen } from "./craft-screen.tsx";
import { EngineScreen } from "./engine-screen.tsx";
import { ExtensionsScreen } from "./extensions-screen.tsx";
import type { EndTabDef, ShellRegistry } from "../shell/registry.ts";
import { InspectTab } from "./inspect-tab.tsx";
import { MetricsScreen } from "../measure/metrics-screen.tsx";
import { TestsScreen } from "../tests/tests-screen.tsx";
import { Clock, Eye, FlaskConical, Layers, Package, Settings } from "@caustic/react/icons";

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
