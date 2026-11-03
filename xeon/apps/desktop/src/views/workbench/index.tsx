// 크래프트 화면 묶음(개요·확장·엔진). `desktop-registry.tsx`가 `registerWorkbench`를 부른다.
import type { ReactNode } from "react";
import { WorkbenchStoreContext, type WorkbenchStore } from "../../state/workbench/index.ts";
import { CraftScreen } from "./craft-screen.tsx";
import { EngineScreen } from "./engine-screen.tsx";
import { ExtensionsScreen } from "./extensions-screen.tsx";
import type { ShellRegistry } from "../shell/registry.ts";
import { Layers, Package, Settings } from "@caustic/react/icons";

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
    id: "engine",
    area: "workbench",
    label: "desktop.shell.nav.engine",
    icon: <Settings />,
    render: () => scoped(store, <EngineScreen />),
  });
}
