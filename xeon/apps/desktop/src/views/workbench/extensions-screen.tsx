// 확장 목록(`extensions`, P-13): 같은 `ext.list` 데이터의 목록 모양. 층별 묶음, 찾기, 행마다 켜기·끄기(전역). 범위 고르기는 없다.
// 고른 확장은 옆의 선택 패널이 보이고, "자세히 보기"가 열려 있으면 목록 대신 P-17 상세(버전 탭과 되돌리기 포함)를 그린다.
import { t } from "@fresnel/client/i18n";
import { selectedEntry, visibleRows } from "@fresnel/client/workbench";
import { Alert, Button, EmptyState } from "@caustic/react";
import { Plus } from "@caustic/react/icons";
import { useState, type ReactNode } from "react";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import {
  CountsLine,
  firstNoticeOf,
  ListStatusBand,
  noticeTotalOf,
  SearchField,
  useToggleRequest,
} from "./craft-parts.tsx";
import { detachVoid, useWorkbenchController } from "./controller.ts";
import { ExtDetail } from "./ext-detail.tsx";
import { BindingsPanel } from "./bindings-panel.tsx";
import { InstallDialog } from "./install-dialog.tsx";
import { LayerList } from "./layer-list.tsx";
import { RemoveDialog } from "./remove-dialog.tsx";
import { SelectionPanel } from "./selection-panel.tsx";
import { useSafeMode } from "../safe-mode-context.ts";

export function ExtensionsScreen(): ReactNode {
  const controller = useWorkbenchController();
  const [installing, setInstalling] = useState(false);
  // 지우기 확인 상자가 가리키는 이름과, 지우는 요청이 가는 중인지
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const toggle = useToggleRequest(controller);
  const actions = useWorkbenchActions();
  const state = useWorkbench((s) => s);
  const ready = state.list === "ready";
  const empty = visibleRows(state).length === 0;
  const searching = state.query.trim() !== "";
  // 자세히 보기가 열렸을 때만 그 확장이 상세가 된다. 선택 패널은 고른 확장을 본다
  const entry = selectedEntry(state);
  const detailEntry = state.detail === null ? null : entry;
  // 목록 위 경고 줄: 알림이 있는 확장과 훅 알림. 안전 모드면 훅은 세지 않는다
  const safe = useSafeMode()?.active === true;
  const noticeTotal = noticeTotalOf(state.entries, state.hookNotices, safe);
  const firstNotice = firstNoticeOf(state.entries);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <header className="flex items-start justify-between gap-2">
        <div className="grid gap-0.5">
          <h1 className="text-ui-strong text-text-primary">{t("desktop.workbench.list.title")}</h1>
          <CountsLine />
        </div>
        <Button
          size="sm"
          variant="outline"
          iconStart={<Plus />}
          onClick={() => {
            setInstalling(true);
          }}
        >
          {t("desktop.install.open")}
        </Button>
      </header>
      {installing && (
        <InstallDialog
          open
          onClose={() => {
            setInstalling(false);
          }}
          onInstalled={() => {
            detachVoid(controller.reload());
          }}
        />
      )}
      <BindingsPanel />
      <SearchField />
      <ListStatusBand controller={controller} />
      {noticeTotal > 0 && (
        <Alert
          tone="danger"
          actions={
            firstNotice === null
              ? []
              : [
                  {
                    label: t("desktop.workbench.notices.view"),
                    onClick: () => {
                      // 자세히 보기가 열려 있으면 목록으로 돌아가 그 확장을 고른다
                      actions.closeDetail();
                      if (firstNotice.isGroup) actions.pickGroup(firstNotice.name);
                      else actions.pickPlugin(firstNotice.name);
                    },
                  },
                ]
          }
        >
          {t("desktop.workbench.notices.count", { count: noticeTotal })}
        </Alert>
      )}
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
            onRemove={() => {
              setRemoving(detailEntry.name);
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
              onRemove={() => {
                setRemoving(entry.name);
              }}
            />
          )}
        </div>
      )}
      {toggle.dialog}
      <RemoveDialog
        name={removing}
        busy={removeBusy}
        onCancel={() => {
          if (!removeBusy) setRemoving(null);
        }}
        onConfirm={(name) => {
          setRemoveBusy(true);
          detachVoid(
            controller.remove(name).then(() => {
              setRemoveBusy(false);
              setRemoving(null);
              return undefined;
            }),
          );
        }}
      />
    </div>
  );
}
