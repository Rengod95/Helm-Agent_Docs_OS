// 크래프트 개요(`overview`, P-16): 머리(제목, 개수, 보기 바꾸기), 도구 막대(찾기, 구성 요소 필터), 캔버스, 선택 패널, 자세히 보기.
// 캔버스는 T-CANVAS가 슬롯에 등록한 지도·순서·링크이고, 등록 전에는 층 목록이 보인다. 전역만 보인다(범위·맥락 칸 없음).
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  COMPONENT_KINDS,
  selectedEntry,
  WORKBENCH_VIEWS,
  type ComponentKind,
  type WorkbenchView,
} from "@fresnel/client/workbench";
import { Button, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import type { ReactNode } from "react";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import type { CanvasSlots } from "./canvas-slots.ts";
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

const VIEW_TEXT: Readonly<Record<WorkbenchView, MessageId>> = {
  orbit: "desktop.workbench.view.orbit",
  strata: "desktop.workbench.view.strata",
  link: "desktop.workbench.view.link",
};

const KIND_TEXT: Readonly<Record<ComponentKind, MessageId>> = {
  hook: "desktop.workbench.filter.hook",
  skill: "desktop.workbench.filter.skill",
  command: "desktop.workbench.filter.command",
  tool: "desktop.workbench.filter.tool",
  mcp: "desktop.workbench.filter.mcp",
  subagent: "desktop.workbench.filter.subagent",
  ui: "desktop.workbench.filter.ui",
};

function isView(value: string): value is WorkbenchView {
  return WORKBENCH_VIEWS.some((v) => v === value);
}

function ViewSwitch(): ReactNode {
  const view = useWorkbench((s) => s.view);
  const actions = useWorkbenchActions();
  return (
    <SegmentedControl
      size="sm"
      aria-label={t("desktop.workbench.view.label")}
      value={view}
      onValueChange={(v) => {
        if (isView(v)) actions.setView(v);
      }}
    >
      {WORKBENCH_VIEWS.map((v) => (
        <SegmentedControlItem key={v} value={v}>
          {t(VIEW_TEXT[v])}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

function KindFilters(): ReactNode {
  const kinds = useWorkbench((s) => s.kinds);
  const actions = useWorkbenchActions();
  return (
    <div
      role="group"
      aria-label={t("desktop.workbench.filter.label")}
      className="flex flex-wrap gap-1"
    >
      {COMPONENT_KINDS.map((kind) => (
        <Button
          key={kind}
          size="xs"

          variant={kinds.includes(kind) ? "soft" : "outline"}
          aria-pressed={kinds.includes(kind)}
          onClick={() => {
            actions.toggleKind(kind);
          }}
        >
          {t(KIND_TEXT[kind])}
        </Button>
      ))}
    </div>
  );
}

export function CraftScreen(props: { readonly slots: CanvasSlots }): ReactNode {
  const controller = useWorkbenchController();
  const toggle = useToggleRequest(controller);
  const state = useWorkbench((s) => s);
  const actions = useWorkbenchActions();
  const entry = selectedEntry(state);
  const ready = state.list === "ready";
  const detailEntry = state.detail === null ? null : entry;
  const canvas = props.slots.render(state.view);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <header className="flex items-end gap-4">
        <div className="grid gap-0.5">
          <h1 className="text-ui-strong text-text-primary">{t("desktop.workbench.title")}</h1>
          <CountsLine />
        </div>
        <div className="ms-auto">
          <ViewSwitch />
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <SearchField />
        <KindFilters />
      </div>
      <ListStatusBand controller={controller} />
      {ready && <AutoDisabledAlerts controller={controller} />}
      {ready && detailEntry !== null && (
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
        />
      )}
      {ready && detailEntry === null && (
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
            {canvas ?? <LayerList only={state.layer} onToggle={toggle.request} />}
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
                actions.select(null);
              }}
              onReenable={() => {
                detachVoid(controller.reenable(entry.name));
              }}
            />
          )}
        </div>
      )}
      {toggle.dialog}
    </div>
  );
}
