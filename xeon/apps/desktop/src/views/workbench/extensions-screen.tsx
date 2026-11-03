// 확장 목록(`extensions`, P-13): 같은 `ext.list` 데이터의 목록 모양. 층별 묶음, 찾기, 행마다 켜기·끄기(전역). 범위 고르기는 없다.
import { t } from "@fresnel/client/i18n";
import { visibleRows } from "@fresnel/client/workbench";
import { EmptyState } from "@caustic/react";
import type { ReactNode } from "react";
import { useWorkbench } from "../../state/workbench/index.ts";
import {
  AutoDisabledAlerts,
  CountsLine,
  ListStatusBand,
  SearchField,
  useToggleRequest,
} from "./craft-parts.tsx";
import { useWorkbenchController } from "./controller.ts";
import { LayerList } from "./layer-list.tsx";

export function ExtensionsScreen(): ReactNode {
  const controller = useWorkbenchController();
  const toggle = useToggleRequest(controller);
  const ready = useWorkbench((s) => s.list === "ready");
  const empty = useWorkbench((s) => visibleRows(s).length === 0);
  const searching = useWorkbench((s) => s.query.trim() !== "");
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-6">
      <header className="grid gap-0.5">
        <h1 className="text-ui-strong text-text-primary">{t("desktop.workbench.list.title")}</h1>
        <CountsLine />
      </header>
      <SearchField />
      <ListStatusBand controller={controller} />
      {ready && <AutoDisabledAlerts controller={controller} />}
      {ready && empty && (
        <EmptyState
          size="sm"
          surface="none"
          title={t(
            searching ? "desktop.workbench.empty.search" : "desktop.workbench.empty.heading",
          )}
        />
      )}
      {ready && !empty && <LayerList onToggle={toggle.request} />}
      {toggle.dialog}
    </div>
  );
}
