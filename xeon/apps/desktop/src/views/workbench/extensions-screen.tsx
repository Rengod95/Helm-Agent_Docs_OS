// 확장 목록(`extensions`, P-13): 같은 `ext.list` 데이터의 목록 모양. 층별 묶음, 찾기, 행마다 켜기·끄기(전역). 범위 고르기는 없다.
// 고른 확장은 옆의 선택 패널이 보이고, "자세히 보기"가 열려 있으면 목록 대신 P-17 상세(버전 탭과 되돌리기 포함)를 그린다.
import { t } from "@fresnel/client/i18n";
import { selectedEntry, visibleRows } from "@fresnel/client/workbench";
import { EmptyState } from "@caustic/react";
import type { ReactNode } from "react";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import {
  AutoDisabledAlerts,
  CountsLine,
  ListStatusBand,
  SearchField,
  useToggleRequest,
} from "./craft-parts.tsx";
import { detachVoid, useWorkbenchController } from "./controller.ts";
import { ExtDetail } from "./ext-detail.tsx";
import { LayerList } from "./layer-list.tsx";
import { SelectionPanel } from "./selection-panel.tsx";

export function ExtensionsScreen(): ReactNode {
  const controller = useWorkbenchController();
  const toggle = useToggleRequest(controller);
  const actions = useWorkbenchActions();
  const state = useWorkbench((s) => s);
  const ready = state.list === "ready";
  const empty = visibleRows(state).length === 0;
  const searching = state.query.trim() !== "";
  // 자세히 보기가 열렸을 때만 그 확장이 상세가 된다. 선택 패널은 고른 확장을 본다
  const entry = selectedEntry(state);
  const detailEntry = state.detail === null ? null : entry;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <header className="grid gap-0.5">
        <h1 className="text-ui-strong text-text-primary">{t("desktop.workbench.list.title")}</h1>
        <CountsLine />
      </header>
      <SearchField />
      <ListStatusBand controller={controller} />
      {ready && <AutoDisabledAlerts controller={controller} />}
      {ready && detailEntry !== null && (
        <div className="min-h-0 flex-1 overflow-auto">
          <ExtDetail
            key={detailEntry.name}
            state={state}
            entry={detailEntry}
            onBack={() => {
              actions.closeDetail();
            }}
            onToggle={(target) => {
              toggle.request(detailEntry.name, target);
            }}
            onKeepOn={() => {
              detachVoid(controller.reenable(detailEntry.name));
            }}
            onKeepOff={() => {
              detachVoid(controller.keepOff(detailEntry.name));
            }}
          />
        </div>
      )}
      {ready && detailEntry === null && empty && (
        <EmptyState
          size="sm"
          surface="none"
          title={t(
            searching ? "desktop.workbench.empty.search" : "desktop.workbench.empty.heading",
          )}
        />
      )}
      {ready && detailEntry === null && !empty && (
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
            <LayerList onToggle={toggle.request} />
          </div>
          {entry !== null && (
            <SelectionPanel
              state={state}
              entry={entry}
              onToggle={(target) => {
                toggle.request(entry.name, target);
              }}
              onDetail={() => {
                actions.openDetail(entry.name);
              }}
              onClear={() => {
                actions.clearPick();
              }}
              onReenable={() => {
                detachVoid(controller.reenable(entry.name));
              }}
              onKeepOff={() => {
                detachVoid(controller.keepOff(entry.name));
              }}
            />
          )}
        </div>
      )}
      {toggle.dialog}
    </div>
  );
}
