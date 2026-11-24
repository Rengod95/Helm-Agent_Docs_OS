// 크래프트 플러그인 목록(P-13, AGE-76 plugMin, plugTab). 세 묶음: 내가 넣은 것, 기본 제공, 앱 핵심(접힌 채 시작).
// 묶음마다 표나 카드로 그린다(보기는 목록 머리의 보기 전환이 고른다). 표 열: 이름, 종류, 쓰는 곳, 출처, 버전, 상태, "프로필에 넣기" 메뉴.
// 정렬은 이름과 종류 열만 건다. 정렬 상태는 세 표가 하나를 같이 쓴다. 켜기 스위치는 없다(켜고 끔은 프로필에서만).
// 앱 핵심 묶음 머리에는 자물쇠와 "늘 켜져 있어요. 끄거나 지울 수 없어요."가 접혀 있어도 늘 보인다. 그 안의 줄에는 메뉴가 없다.
// 줄을 누르거나 Enter·Space로 상세를 연다. 줄 사이 화살표 이동은 Table이 한다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { pluginGroups, type ExtRowVM, type PluginGroupKey } from "@fresnel/client/workbench";
import { Table, type TableColumn } from "@caustic/react";
import { ChevronDown, ChevronRight, Lock } from "@caustic/react/icons";
import { useState, type ReactNode } from "react";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import { PluginCardGrid } from "./plugin-cards.tsx";
import { HealthCell, RowName, UseText } from "./plugin-cells.tsx";
import { readinessBlocked } from "./tool-ready.ts";
import { originText } from "./origin-text.ts";
import { KindTag, pluginKindOf } from "./plugin-kind.tsx";
import { ProfilePutMenu, type ProfileSetLoad } from "./profile-put-menu.tsx";
import { sortKeyOf, sortRows, type ListView, type TableSort } from "./list-view.ts";
import type { PluginCards } from "./use-plugin-cards.ts";

// 상태 칸의 규칙(`rowHealthOf`)은 상세 머리가 같이 쓴다. 두 보기가 쓰는 칸은 `plugin-cells.tsx`에 있다
export { HealthCell, rowHealthOf } from "./plugin-cells.tsx";

const GROUP_TITLE: Readonly<Record<PluginGroupKey, MessageId>> = {
  mine: "desktop.workbench.group.mine",
  bundled: "desktop.workbench.group.bundled",
  core: "desktop.workbench.group.core",
};

function GroupTable(props: {
  readonly label: string;
  readonly rows: readonly ExtRowVM[];
  readonly profiles: ProfileSetLoad;
  readonly cards: PluginCards;
  readonly sort: TableSort | null;
  readonly onSortChange: (sort: TableSort) => void;
}): ReactNode {
  const actions = useWorkbenchActions();
  const byName = new Map(props.rows.map((row) => [row.name, row] as const));
  const set = props.profiles.set;
  // 머리글은 그릴 때 고른다. 말투(로케일)가 연결 뒤에 바뀔 수 있다. 열 폭은 세 묶음이 같다(이름 열만 남은 폭을 쓴다).
  // 다른 열은 가장 긴 값(종류 꼬리표, "어느 프로필에도 없음", "직접 설치", "준비 안 됨"과 구슬, "프로필에 넣기" 단추)이 들어가는 폭까지만 잡아
  // 한국어 이름이 다 보일 자리를 이름 열에 준다(plugWire). 폭은 칸 글 13, 꼬리표 24, 단추 sm(28)에 맞춘 값이다(plugSize)
  const columns: TableColumn[] = [
    { key: "name", header: t("desktop.workbench.col.name"), sortable: true },
    { key: "kind", header: t("desktop.workbench.col.kind"), width: 104, sortable: true },
    { key: "use", header: t("desktop.workbench.col.use"), width: 168 },
    { key: "origin", header: t("desktop.workbench.versions.col.source"), width: 104 },
    { key: "version", header: t("desktop.workbench.versions.col.version"), width: 80 },
    { key: "health", header: t("desktop.workbench.col.state"), width: 128 },
    { key: "put", header: "", align: "end", width: 152 },
  ];
  return (
    <Table
      variant="ghost"
      size="sm"
      className="[&_table]:table-fixed [&_thead_th]:bg-transparent [&_[data-slot=table-cell]]:text-ui"
      dividers={false}
      aria-label={props.label}
      columns={columns}
      rows={props.rows.map((row) => ({ id: row.name }))}
      sort={props.sort}
      onSortChange={(next) => {
        const key = sortKeyOf(next.key);
        if (key !== null) props.onSortChange({ key, direction: next.direction });
      }}
      onRowActivate={(picked) => {
        const row = byName.get(picked.id);
        if (row === undefined) return;
        actions.pickPlugin(row.name);
        actions.openDetail(row.name);
      }}
      renderCell={(picked, column) => {
        const row = byName.get(picked.id);
        if (row === undefined) return null;
        if (column.key === "name") return <RowName row={row} />;
        if (column.key === "kind") {
          const kind = pluginKindOf(props.cards.cardOf(row.name));
          return kind === null ? null : <KindTag kind={kind} />;
        }
        if (column.key === "use") return <UseText row={row} profiles={set} />;
        if (column.key === "origin") {
          if (row.origin === undefined) return null;
          return (
            <span className="block min-w-0 truncate text-ui text-text-secondary">
              {originText(row.origin)}
            </span>
          );
        }
        if (column.key === "version") {
          return (
            <span className="block min-w-0 truncate font-mono text-mono text-text-tertiary tabular-nums">
              {row.version}
            </span>
          );
        }
        if (column.key === "health") {
          return (
            <HealthCell row={row} blocked={readinessBlocked(props.cards.readinessOf(row.name))} />
          );
        }
        if (column.key !== "put" || row.appCore) return null;
        // 메뉴를 누르는 것이 줄 열기로 번지지 않게 막는다
        return (
          <span
            className="inline-flex"
            onClick={(event) => {
              event.stopPropagation();
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
            }}
          >
            <ProfilePutMenu
              name={row.name}
              title={row.displayName ?? row.name}
              load={props.profiles}
              size="sm"
            />
          </span>
        );
      }}
    />
  );
}

function GroupHead(props: { readonly title: string; readonly count: number }): ReactNode {
  return (
    <h3 className="m-0 flex items-baseline gap-2 px-2.5 text-ui-strong text-text-secondary">
      <span>{props.title}</span>
      <span className="tabular-nums text-text-tertiary">{props.count}</span>
    </h3>
  );
}

/** 앱 핵심 묶음의 머리: 펴고 접는 단추(글은 다른 묶음 머리와 같은 자리에서 시작하고 화살표는 뒤에 둔다)와, 늘 보이는 자물쇠 문장 */
function CoreHead(props: {
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5">
      <button
        type="button"
        aria-expanded={props.open}
        className="m-0 inline-flex items-center gap-2 rounded-sm border-0 bg-transparent p-0 text-ui-strong text-text-secondary outline-none hover:text-text-primary focus-visible:focus-ring"
        onClick={props.onToggle}
      >
        <span>{t(GROUP_TITLE.core)}</span>
        <span className="tabular-nums text-text-tertiary">{props.count}</span>
        {props.open ? (
          <ChevronDown aria-hidden className="size-icon-md text-text-tertiary" />
        ) : (
          <ChevronRight aria-hidden className="size-icon-md text-text-tertiary" />
        )}
      </button>
      <span className="inline-flex items-center gap-1.5 text-ui text-text-tertiary">
        <Lock aria-hidden className="size-icon-md" />
        <span>{t("desktop.workbench.core.locked")}</span>
      </span>
    </div>
  );
}

export function PluginList(props: {
  readonly profiles: ProfileSetLoad;
  readonly cards: PluginCards;
  readonly view: ListView;
}): ReactNode {
  const state = useWorkbench((s) => s);
  const actions = useWorkbenchActions();
  // 정렬은 표 머리를 누를 때 걸린다. 세 묶음의 표가 이 하나를 같이 쓰고, 카드 보기도 같은 순서를 따른다
  const [sort, setSort] = useState<TableSort | null>(null);
  // 찾는 중이면 앱 핵심도 펼쳐 보인다(찾은 줄이 접힌 묶음에 숨지 않게)
  const searching = state.query.trim() !== "";
  const kindOfName = (name: string) => pluginKindOf(props.cards.cardOf(name));
  // 묶음 하나의 몸: 정렬을 걸고 고른 보기대로 표나 카드를 그린다
  const body = (label: string, rows: readonly ExtRowVM[]): ReactNode => {
    const sorted = sortRows(rows, sort, kindOfName);
    if (props.view === "cards") {
      return (
        <PluginCardGrid label={label} rows={sorted} profiles={props.profiles} cards={props.cards} />
      );
    }
    return (
      <GroupTable
        label={label}
        rows={sorted}
        profiles={props.profiles}
        cards={props.cards}
        sort={sort}
        onSortChange={setSort}
      />
    );
  };
  return (
    <div className="grid content-start gap-6">
      {pluginGroups(state).map((group) => {
        const label = t(GROUP_TITLE[group.key]);
        if (group.key !== "core") {
          return (
            <section key={group.key} aria-label={label} className="grid gap-1">
              <GroupHead title={label} count={group.rows.length} />
              {body(label, group.rows)}
            </section>
          );
        }
        const open = state.coreOpen || searching;
        return (
          <section key={group.key} aria-label={label} className="grid gap-1">
            <CoreHead
              count={group.rows.length}
              open={open}
              onToggle={() => {
                actions.setCoreOpen(!open);
              }}
            />
            {open && body(label, group.rows)}
          </section>
        );
      })}
    </div>
  );
}
