import { t } from "@fresnel/client/i18n";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { EmptyState, IconButton } from "@caustic/react";
import { ChevronRight, Maximize2 } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { placeBeside, useBesideApp } from "./app-beside.ts";
import { useAppMoves } from "./app-moves.ts";
import { usePluginUiState } from "./plugin-context.tsx";
import { duplicateTitlesOf, screenTitleOf } from "./panel-screen-tabs.ts";
import { besideAppEntriesOf } from "./plugin-pick.ts";
import { PluginView, screenKeyOf } from "./plugin-view.tsx";

// 대화 옆 "앱" 탭(AGE-78, L4.desktop-ux §6.25 "앱"). 앱 작업 공간의 "대화 옆에"가 둔 화면 하나를 대화 오른쪽 패널에 그린다.
// 머리 한 줄: 앱 이름, 크게 보기(앱 작업 공간으로). 닫기는 패널 머리의 닫기가 맡는다. 둔 앱이 없으면 열 수 있는 앱 목록을 보인다.
// 본문은 `PluginView`(머리 없이)라 작업 공간과 같은 판정(꺼짐, 프로필 밖, 막힘)을 따른다.

/** 둔 앱이 없을 때: 열 수 있는 앱(페이지 화면) 목록. 누르면 그 앱을 둔다 */
function PickApp(props: { readonly entries: readonly ExtUiEntry[] }): ReactNode {
  const duplicated = duplicateTitlesOf(props.entries);
  return (
    <div className="grid content-start gap-3 p-3">
      <EmptyState
        size="sm"
        surface="none"
        title={t("desktop.apps.beside.empty.title")}
        description={t("desktop.apps.beside.empty.body")}
      />
      {props.entries.length === 0 ? null : (
        <ul aria-label={t("desktop.apps.label")} className="m-0 grid list-none gap-1 p-0">
          {props.entries.map((entry) => (
            <li key={screenKeyOf(entry)}>
              <button
                type="button"
                className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-start outline-none hover:bg-neutral-hover focus-visible:focus-ring"
                onClick={() => {
                  placeBeside(screenKeyOf(entry));
                }}
              >
                <span className="min-w-0 flex-1 truncate text-ui text-text-primary">
                  {screenTitleOf(entry)}
                </span>
                {duplicated.has(screenTitleOf(entry)) ? (
                  <span className="min-w-0 max-w-1/2 flex-none truncate text-ui text-text-tertiary">
                    {entry.extension}
                  </span>
                ) : null}
                <ChevronRight aria-hidden className="size-icon-sm flex-none text-text-tertiary" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AppBesideTab(): ReactNode {
  const key = useBesideApp();
  const state = usePluginUiState();
  const moves = useAppMoves();
  const pages = besideAppEntriesOf(state);
  const entry = key === undefined ? undefined : pages.find((item) => screenKeyOf(item) === key);
  if (entry === undefined) return <PickApp entries={pages} />;
  const name = screenTitleOf(entry);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 flex-none items-center gap-1 px-3">
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-text-primary">
          {name}
        </span>
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.apps.beside.expand")}
          onClick={() => {
            moves.open(entry.extension, screenKeyOf(entry));
          }}
        >
          <Maximize2 aria-hidden />
        </IconButton>
      </div>
      <PluginView
        key={`${screenKeyOf(entry)}@${entry.version}`}
        entry={entry}
        bare
        onManage={() => {
          moves.manage(entry.extension);
        }}
      />
    </div>
  );
}
