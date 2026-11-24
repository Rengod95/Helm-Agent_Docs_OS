// 플러그인 목록(`extensions`, P-13): 같은 `ext.list` 데이터의 목록 모양. 세 묶음(내가 넣은 것, 기본 제공, 앱 핵심), 찾기, 줄마다 쓰는 곳과 "프로필에 넣기".
// 전역 켜기 스위치는 없다(켜고 끔은 프로필에서만, AGE-74). 줄을 누르면 목록 대신 P-17 상세(화면과 설정, 버전 탭 포함)를 그린다.
import { PuzzleArt } from "../illustrations/index.tsx";
import { t } from "@fresnel/client/i18n";
import { pluginGroups, selectedEntry } from "@fresnel/client/workbench";
import { Alert, Button, EmptyState, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import { useCallback, useState, type ReactNode } from "react";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import { useCommands, type DependencyRefusalView } from "../commands.ts";
import { usePluginUi, usePluginUiState } from "../plugin/plugin-context.tsx";
import { firstNoticeOf, ListStatusBand, noticeTotalOf, SearchField } from "./craft-parts.tsx";
import { detachVoid, useWorkbenchController } from "./controller.ts";
import { BuilderEntry } from "./builder-entry.tsx";
import { ExtDetail } from "./ext-detail.tsx";
import { DETAIL_RAIL_INSET } from "./detail-rail.ts";
import { InstallDialog } from "./install-dialog.tsx";
import { PluginList } from "./plugin-list.tsx";
import { DEFAULT_LIST_VIEW, listViewOf, type ListView } from "./list-view.ts";
import { useProfileSet } from "./profile-put-menu.tsx";
import { RemoveDialog } from "./remove-dialog.tsx";
import { keepsDialogOpen } from "./remove-model.ts";
import { usePluginCards } from "./use-plugin-cards.ts";
import { MergeDialog } from "../craft/members/split-dialogs.tsx";
import { useSplitActions } from "../craft/members/split-source.ts";
import { LayoutGrid, Rows3, SquareStack } from "@caustic/react/icons";
import { useSafeMode } from "../safe-mode-context.ts";
import {
  HEADER_CONTROL_SIZE,
  HEADER_PRIMARY_VARIANT,
  ScreenHeader,
} from "../shell/screen-header.tsx";

export function ExtensionsScreen(): ReactNode {
  const controller = useWorkbenchController();
  const commands = useCommands();
  // 플러그인 화면 항목은 상태가 ready일 때만 믿는다. 읽는 중이나 연결 없음이면 지우기 상자가 뷰를 "확인하지 못했어요"로 보인다
  const plugin = usePluginUiState();
  const pluginUi = usePluginUi();
  const pluginEntries = plugin.phase === "ready" ? plugin.entries : null;
  const loadProfiles = useCallback(() => commands.workbench.profiles(), [commands]);
  const [installing, setInstalling] = useState(false);
  const [merging, setMerging] = useState(false);
  const split = useSplitActions();
  // 지우기 확인 상자가 가리키는 이름과, 지우는 요청이 가는 중인지
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeRefusal, setRemoveRefusal] = useState<DependencyRefusalView | null>(null);
  const profiles = useProfileSet();
  // 플러그인 카드(종류, 목적, 준비 상태)는 한 번 읽어 목록과 상세가 같이 쓴다
  const cards = usePluginCards();
  // 목록의 보기(표, 카드). 이 기기의 로컬 설정 `l4.desktop.window.pluginListView`에 남는다. 저장하지 못해도 이 화면에서는 고른 보기다
  const [view, setView] = useState<ListView>(() => commands.pluginListView() ?? DEFAULT_LIST_VIEW);
  const actions = useWorkbenchActions();
  const state = useWorkbench((s) => s);
  const ready = state.list === "ready";
  const empty = pluginGroups(state).length === 0;
  const searching = state.query.trim() !== "";
  // 자세히 보기가 열렸을 때만 그 확장이 상세가 된다
  const entry = selectedEntry(state);
  const detailEntry = state.detail === null ? null : entry;
  const headerHidden = ready && detailEntry !== null;
  // 목록 위 경고 줄: 알림이 있는 확장과 훅 알림. 안전 모드면 훅은 세지 않는다
  const safe = useSafeMode()?.active === true;
  const noticeTotal = noticeTotalOf(state.entries, state.hookNotices, safe);
  const firstNotice = firstNoticeOf(state.entries);
  // 지우기 상자의 저장 데이터 경고: `ext.list`가 준 `hasData`를 지우려는 이름으로 찾는다(옛 호스트는 없어서 경고도 없다)
  const removingHasData = state.entries.some(
    (row) => row.name === removing && row.hasData === true,
  );
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* 상세가 그려질 때만 머리를 감춘다. 상세의 머리(ext-detail.tsx)가 펼치기 단추를 가진다 */}
      <ScreenHeader
        hidden={headerHidden}
        title={t("desktop.workbench.list.title")}
        action={
          <span className="inline-flex items-center gap-2">
            {/* 합치기(AGE-33): 원본 폴더가 있는 멤버 없는 플러그인 둘 이상을 새 플러그인 하나로 묶어 리뷰에 낸다 */}
            <Button
              size={HEADER_CONTROL_SIZE}
              variant="ghost"
              onClick={() => {
                setMerging(true);
              }}
            >
              <SquareStack aria-hidden />
              {t("desktop.craft.split.merge.open")}
            </Button>
            <Button
              size={HEADER_CONTROL_SIZE}
              variant={HEADER_PRIMARY_VARIANT}
              onClick={() => {
                setInstalling(true);
              }}
            >
              {t("desktop.install.open")}
            </Button>
          </span>
        }
      />
      {/* 머리가 가려진 상세에서는 위 간격을 이 칸이 맡고, 머리가 보이면 공용 간격이 준다.
          목록과 상세 모두 최대 폭 없이 화면 머리와 같은 좌우 여백(`px-3`, 막대가 있으면 셸 규칙이 오른쪽에 막대 자리를 더한다)으로 넓게 쓴다(plugSize) */}
      <div
        className={`flex min-h-0 w-full flex-1 flex-col gap-3 px-3 pb-4${headerHidden ? " pt-6" : ""}`}
      >
        <MergeDialog
          open={merging}
          entries={state.entries}
          actions={split}
          onClose={() => {
            setMerging(false);
          }}
        />
        {installing && (
          <InstallDialog
            open
            onClose={() => {
              setInstalling(false);
            }}
            onInstalled={(itemId) => {
              detachVoid(controller.installSubmitted(itemId));
              // 설치한 확장의 화면이 재시작 없이 플러그인 화면 탭에 오른다(rtC R-1)
              detachVoid(pluginUi.runtime.refresh());
            }}
          />
        )}
        {detailEntry === null && (
          <div className="flex flex-wrap items-center gap-1.5">
            <SearchField />
            <SegmentedControl
              size="sm"
              aria-label={t("desktop.workbench.view.label")}
              value={view}
              onValueChange={(value) => {
                const next = listViewOf(value);
                setView(next);
                detachVoid(commands.savePluginListView(next).then(() => undefined));
              }}
              className="ms-auto"
            >
              <SegmentedControlItem value="table" icon={<Rows3 />}>
                {t("desktop.workbench.view.table")}
              </SegmentedControlItem>
              <SegmentedControlItem value="cards" icon={<LayoutGrid />}>
                {t("desktop.workbench.view.cards")}
              </SegmentedControlItem>
            </SegmentedControl>
          </div>
        )}
        <ListStatusBand controller={controller} />
        {noticeTotal > 0 && (
          <Alert
            tone="danger"
            layout="inline"
            size="sm"
            actions={
              firstNotice === null
                ? []
                : [
                    {
                      label: t("desktop.workbench.notices.view"),
                      onClick: () => {
                        // 알림이 있는 첫 플러그인의 상세를 연다(알림과 두 행동이 상세 머리 아래에 있다)
                        actions.pickPlugin(firstNotice.name);
                        actions.openDetail(firstNotice.name);
                      },
                    },
                  ]
            }
          >
            {t("desktop.workbench.notices.count", { count: noticeTotal })}
          </Alert>
        )}
        {ready && detailEntry !== null && (
          // 머리가 감춰진 상세는 셸의 머리 뒤 여백을 받지 못하므로 이 칸이 막대 자리를 비운다(`detail-rail.ts`)
          <div className={`min-h-0 flex-1 overflow-auto ${DETAIL_RAIL_INSET}`}>
            <ExtDetail
              key={detailEntry.name}
              entry={detailEntry}
              card={cards.cardOf(detailEntry.name)}
              readiness={cards.readinessOf(detailEntry.name)}
              onRecheck={cards.recheck}
              tab={state.detailTab}
              profiles={profiles}
              onTab={(tab) => {
                actions.selectDetailTab(tab);
              }}
              onBack={() => {
                actions.closeDetail();
              }}
              onRetry={() => {
                detachVoid(controller.retry(detailEntry.name));
              }}
              onStop={() => {
                detachVoid(controller.stop(detailEntry.name));
              }}
              onRemove={() => {
                setRemoving(detailEntry.name);
              }}
            />
          </div>
        )}
        {ready && detailEntry === null && empty && (
          <EmptyState
            media={<PuzzleArt />}
            size="sm"
            surface="none"
            title={t(
              searching ? "desktop.workbench.empty.search" : "desktop.workbench.empty.heading",
            )}
          />
        )}
        {ready && detailEntry === null && !empty && (
          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
            <PluginList profiles={profiles} cards={cards} view={view} />
          </div>
        )}
        <RemoveDialog
          name={removing}
          busy={removeBusy}
          refusal={removeRefusal}
          hasData={removingHasData}
          loadProfiles={loadProfiles}
          pluginEntries={pluginEntries}
          onCancel={() => {
            if (!removeBusy) {
              setRemoving(null);
              setRemoveRefusal(null);
            }
          }}
          onConfirm={(name) => {
            setRemoveBusy(true);
            setRemoveRefusal(null);
            detachVoid(
              controller.remove(name).then(({ outcome, refusal }) => {
                setRemoveBusy(false);
                // 의존 때문에 거절됐으면 상자를 열어 두고 그 목록을 보인다. 이미 없는 이름(3401)과 성공은 토스트로 알리고 닫는다
                const stay = keepsDialogOpen(outcome);
                setRemoveRefusal(refusal);
                if (!stay) setRemoving(null);
                return undefined;
              }),
            );
          }}
        />
      </div>
      <BuilderEntry />
    </div>
  );
}
