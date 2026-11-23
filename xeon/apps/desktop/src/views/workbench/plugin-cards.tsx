// 플러그인 목록의 카드 보기(AGE-76 plugTab). 캔버스 판과 같은 가족이다: 카드 왼쪽 위 변에서 솟는 종류 책갈피, 무채색 면, 목적 한 줄.
// 카드 전체는 이름 단추를 늘린 링크로 누른다(상세를 연다). 프로필 메뉴는 그 위에 둔다. 묶음 머리와 찾기는 `plugin-list.tsx`가 그린다.
import { t } from "@fresnel/client/i18n";
import type { ExtRowVM } from "@fresnel/client/workbench";
import type { PluginCard } from "@fresnel/contracts/extensions";
import type { ReactNode } from "react";
import { useWorkbenchActions } from "../../state/workbench/index.ts";
import { KindGlyph } from "../craft/canvas/cv6/glyphs.tsx";
import { cardLeadOf } from "./overview-model.ts";
import { HealthCell, RowName, UseText } from "./plugin-cells.tsx";
import { kindFaceStyle, kindWord, pluginKindOf } from "./plugin-kind.tsx";
import { ProfilePutMenu, type ProfileSetLoad } from "./profile-put-menu.tsx";
import { readinessBlocked } from "./tool-ready.ts";
import type { PluginCards } from "./use-plugin-cards.ts";

function PluginCardItem(props: {
  readonly row: ExtRowVM;
  readonly card: PluginCard | null;
  /** 꼭 필요한 도구가 없거나 버전이 낮은가(`readinessBlocked`) */
  readonly blocked: boolean;
  readonly profiles: ProfileSetLoad;
}): ReactNode {
  const actions = useWorkbenchActions();
  const { row, card } = props;
  const kind = pluginKindOf(card);
  // 하는 일의 첫 줄: 목적(도구 이름이 든 기본 문장이면 설명이나 도구 수 글), 목적이 없으면 설명의 첫 문장
  const lead = card === null ? null : cardLeadOf(card);
  return (
    <li className="relative h-full min-w-0">
      {kind !== null && (
        <span
          className="absolute start-3 bottom-full inline-flex h-5 items-center gap-1 rounded-t-md px-2 text-ui-xs font-medium"
          style={kindFaceStyle(kind)}
        >
          <KindGlyph kind={kind} size={12} />
          <span>{kindWord(kind)}</span>
        </span>
      )}
      <div className="relative flex h-full min-w-0 flex-col gap-2 rounded-xl bg-surface-base p-4 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]">
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            className="min-w-0 flex-1 rounded-sm border-0 bg-transparent p-0 text-start outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:focus-ring"
            onClick={() => {
              actions.pickPlugin(row.name);
              actions.openDetail(row.name);
            }}
          >
            <RowName row={row} />
          </button>
          {/* 앱 핵심 줄에는 프로필 메뉴가 없다. 메뉴는 카드 전체 링크 위에 있어 누르면 메뉴만 연다 */}
          {!row.appCore && (
            <span className="relative z-10 shrink-0">
              <ProfilePutMenu
                name={row.name}
                title={row.displayName ?? row.name}
                load={props.profiles}
              />
            </span>
          )}
        </div>
        {lead === null ? (
          <p className="m-0 min-w-0 truncate text-ui-sm text-text-tertiary">
            {t("desktop.workbench.card.noPurpose")}
          </p>
        ) : (
          <p className="m-0 min-w-0 truncate text-ui-sm text-text-secondary">{lead.text}</p>
        )}
        <div className="mt-auto flex min-w-0 items-center justify-between gap-2">
          <UseText row={row} profiles={props.profiles.set} />
          <HealthCell row={row} blocked={props.blocked} />
        </div>
      </div>
    </li>
  );
}

/** 묶음 하나의 카드 격자. 위 간격(`pt-5`)이 종류 책갈피의 자리라 카드가 없어도 줄이 맞는다 */
export function PluginCardGrid(props: {
  readonly label: string;
  readonly rows: readonly ExtRowVM[];
  readonly profiles: ProfileSetLoad;
  readonly cards: PluginCards;
}): ReactNode {
  return (
    <ul
      aria-label={props.label}
      className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(--spacing(64),1fr))] gap-x-3 gap-y-8 p-0 pt-5"
    >
      {props.rows.map((row) => (
        <PluginCardItem
          key={row.name}
          row={row}
          card={props.cards.cardOf(row.name)}
          blocked={readinessBlocked(props.cards.readinessOf(row.name))}
          profiles={props.profiles}
        />
      ))}
    </ul>
  );
}
