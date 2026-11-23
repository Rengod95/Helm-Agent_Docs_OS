// 크래프트 플러그인 목록(P-13, AGE-76 plugMin). 세 묶음: 내가 넣은 것, 기본 제공, 앱 핵심(접힌 채 시작).
// 줄 칸: 이름, 쓰는 곳(프로필 N개 / 어느 프로필에도 없음 / 모든 대화), 상태, "프로필에 넣기" 메뉴. 켜기 스위치는 없다(켜고 끔은 프로필에서만).
// 앱 핵심 묶음 머리에는 자물쇠와 "늘 켜져 있어요. 끄거나 지울 수 없어요."가 접혀 있어도 늘 보인다. 그 안의 줄에는 메뉴가 없다.
// 줄을 누르거나 Enter·Space로 상세를 연다. 줄 사이 화살표 이동은 Table이 한다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { pluginGroups, type ExtRowVM, type PluginGroupKey } from "@fresnel/client/workbench";
import { Table, type TableColumn } from "@caustic/react";
import { ChevronDown, ChevronRight, Lock } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import { DotOrb } from "../effects/dot-orb.tsx";
import { ProfilePutMenu, type ProfileSetLoad } from "./profile-put-menu.tsx";
import { profileUseOf, profileUseText } from "./profile-use.ts";

const GROUP_TITLE: Readonly<Record<PluginGroupKey, MessageId>> = {
  mine: "desktop.workbench.group.mine",
  bundled: "desktop.workbench.group.bundled",
  core: "desktop.workbench.group.core",
};

/** 줄의 상태 한 칸. 문제가 있을 때만 주의 구슬과 글, 아니면 흐린 "준비됨" */
type RowHealth = "stopped" | "safeMode" | "problem" | "ready";

export function rowHealthOf(row: Pick<ExtRowVM, "state" | "failed">): RowHealth {
  if (row.state === "auto_disabled") return "stopped";
  if (row.state === "safe_excluded") return "safeMode";
  if (row.failed) return "problem";
  return "ready";
}

const HEALTH_TEXT: Readonly<Record<RowHealth, MessageId>> = {
  stopped: "desktop.workbench.health.stopped",
  safeMode: "desktop.workbench.health.safeMode",
  problem: "desktop.workbench.health.problem",
  ready: "desktop.workbench.health.ready",
};

export function HealthCell(props: { readonly row: Pick<ExtRowVM, "state" | "failed"> }): ReactNode {
  const health = rowHealthOf(props.row);
  if (health === "ready") {
    return <span className="text-ui-sm text-text-tertiary">{t(HEALTH_TEXT.ready)}</span>;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-ui-sm text-text-primary">
      <span
        aria-hidden="true"
        className="inline-flex size-icon-sm shrink-0 items-center justify-center"
      >
        <DotOrb state="listening" tone="warm" size={12} kind="mark" live={false} />
      </span>
      <span className="min-w-0 truncate">{t(HEALTH_TEXT[health])}</span>
    </span>
  );
}

function RowName(props: { readonly row: ExtRowVM }): ReactNode {
  const { row } = props;
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="min-w-0 truncate text-text-primary">{row.displayName ?? row.name}</span>
      {row.displayName !== null && (
        <span className="min-w-0 truncate font-mono text-mono-sm text-text-tertiary">
          {row.name}
        </span>
      )}
    </span>
  );
}

function GroupTable(props: {
  readonly label: string;
  readonly rows: readonly ExtRowVM[];
  readonly profiles: ProfileSetLoad;
}): ReactNode {
  const actions = useWorkbenchActions();
  const byName = new Map(props.rows.map((row) => [row.name, row] as const));
  const set = props.profiles.set;
  // 머리글은 그릴 때 고른다. 말투(로케일)가 연결 뒤에 바뀔 수 있다
  const columns: TableColumn[] = [
    { key: "name", header: t("desktop.workbench.col.name") },
    { key: "use", header: t("desktop.workbench.col.use"), width: 168 },
    { key: "health", header: t("desktop.workbench.col.state"), width: 136 },
    { key: "put", header: "", align: "end", width: 136 },
  ];
  return (
    <Table
      variant="ghost"
      size="xs"
      className="[&_table]:table-fixed [&_thead_th]:bg-transparent"
      dividers={false}
      aria-label={props.label}
      columns={columns}
      rows={props.rows.map((row) => ({ id: row.name }))}
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
        if (column.key === "use") {
          return (
            <span className="text-ui-sm text-text-secondary">
              {set === null ? "" : profileUseText(profileUseOf(row.name, row.appCore, set))}
            </span>
          );
        }
        if (column.key === "health") return <HealthCell row={row} />;
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
            />
          </span>
        );
      }}
    />
  );
}

function GroupHead(props: { readonly title: string; readonly count: number }): ReactNode {
  return (
    <h3 className="m-0 flex items-baseline gap-2 px-2 text-ui-sm font-medium text-text-secondary">
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2">
      <button
        type="button"
        aria-expanded={props.open}
        className="m-0 inline-flex items-center gap-2 rounded-sm border-0 bg-transparent p-0 text-ui-sm font-medium text-text-secondary outline-none hover:text-text-primary focus-visible:focus-ring"
        onClick={props.onToggle}
      >
        <span>{t(GROUP_TITLE.core)}</span>
        <span className="tabular-nums text-text-tertiary">{props.count}</span>
        {props.open ? (
          <ChevronDown aria-hidden className="size-icon-sm text-text-tertiary" />
        ) : (
          <ChevronRight aria-hidden className="size-icon-sm text-text-tertiary" />
        )}
      </button>
      <span className="inline-flex items-center gap-1.5 text-ui-sm text-text-tertiary">
        <Lock aria-hidden className="size-icon-sm" />
        <span>{t("desktop.workbench.core.locked")}</span>
      </span>
    </div>
  );
}

export function PluginList(props: { readonly profiles: ProfileSetLoad }): ReactNode {
  const state = useWorkbench((s) => s);
  const actions = useWorkbenchActions();
  // 찾는 중이면 앱 핵심도 펼쳐 보인다(찾은 줄이 접힌 묶음에 숨지 않게)
  const searching = state.query.trim() !== "";
  return (
    <div className="grid content-start gap-6">
      {pluginGroups(state).map((group) => {
        const label = t(GROUP_TITLE[group.key]);
        if (group.key !== "core") {
          return (
            <section key={group.key} aria-label={label} className="grid gap-1">
              <GroupHead title={label} count={group.rows.length} />
              <GroupTable label={label} rows={group.rows} profiles={props.profiles} />
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
            {open && <GroupTable label={label} rows={group.rows} profiles={props.profiles} />}
          </section>
        );
      })}
    </div>
  );
}
