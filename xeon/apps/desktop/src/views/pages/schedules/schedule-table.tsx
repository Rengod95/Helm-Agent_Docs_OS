import { t, type Locale } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { ScheduleListItem } from "@fresnel/contracts/capabilities";
import type { ScheduleRow } from "@fresnel/client";
import {
  Badge,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Table,
  Tooltip,
  type TableColumn,
  type TableRow,
} from "@caustic/react";
import { Ellipsis } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { relativeAgeOf } from "../shared/relative-age.ts";
import { canAct, rowMenuOf, type ScheduleState } from "./schedule-model.ts";
import {
  lastRunAtOf,
  lastRunStatusOf,
  nextRunTextOf,
  reasonOf,
  ROW_ACTION_ID,
  stoppedOf,
  timeTextOf,
  triggerSummaryOf,
  type RowAction,
  type StatusTone,
} from "./schedule-text.ts";

// 예약 표(P-07). 행은 `scheduleListView`가 준 정렬 순서이고 키보드 이동 순서도 이것이다. 상태는 문자와 배지 색을 함께 쓴다.
// 행 동작은 행 메뉴(`Menu`)에 모은다. 항목과 잠금은 `rowMenuOf`가 정한다. 상대 시각은 목록을 읽은 시각(`state.nowMs`) 기준이고
// 절대 시각은 `Tooltip`에 둔다.

/** 행 동작. 속성 형태로 둬서 `handlers.fire`를 그대로 넘겨도 된다 */
export interface RowHandlers {
  readonly select: (id: string) => void;
  readonly toggleExpanded: (id: string) => void;
  readonly fire: (id: string) => void;
  readonly copy: (id: string) => void;
  readonly reenable: (id: string) => void;
  readonly edit: (id: string) => void;
  readonly showRuns: (id: string) => void;
  readonly askCancel: (id: string) => void;
  readonly openThread: (threadId: string) => void;
}

/**
 * 배지 색. caustic `Badge`의 `tone` 속성은 옛 값 때문에 지원 중단 표시가 붙어 쓰지 않고, 같은 색 토큰을 유틸리티로 입힌다.
 * 색만으로 뜻을 주지 않는다: 글자가 따로 있다.
 */
const TONE_CLASS: Readonly<Record<StatusTone, string>> = {
  info: "bg-info-soft text-info-text",
  success: "bg-success-soft text-success-text",
  danger: "bg-danger-soft text-danger-text",
  warning: "bg-warning-soft text-warning-text",
  neutral: "bg-neutral-track text-text-secondary",
};

export interface ScheduleTableProps {
  readonly rows: readonly ScheduleRow[];
  readonly items: readonly ScheduleListItem[];
  readonly state: ScheduleState;
  readonly locale: Locale;
  /** 마지막 실행의 대화가 지금 목록에 있는가 */
  readonly openable: (threadId: string) => boolean;
  readonly handlers: RowHandlers;
}

function columnsOf(): TableColumn[] {
  return [
    { key: "title", header: t("desktop.schedules.columns.title") },
    { key: "trigger", header: t("desktop.schedules.columns.trigger") },
    { key: "next", header: t("desktop.schedules.columns.next") },
    { key: "last", header: t("desktop.schedules.columns.last") },
    { key: "iterations", header: t("desktop.schedules.columns.iterations"), align: "end" },
    { key: "stopped", header: t("desktop.schedules.columns.stopped") },
    { key: "enabled", header: t("desktop.schedules.columns.enabled") },
  ];
}

export function ScheduleTable(props: ScheduleTableProps): ReactNode {
  const { rows, items, state, locale, openable, handlers } = props;
  const rowById = new Map<string, ScheduleRow>(
    rows.map((row): [string, ScheduleRow] => [row.id, row]),
  );
  const entryById = new Map<string, ScheduleListItem>(
    items.map((item): [string, ScheduleListItem] => [item.entry.id, item]),
  );
  const acting = canAct(state);
  const expanded = new Set(state.expanded);

  /** 행 메뉴의 항목을 누르면 그 동작을 부른다. 대화 열기는 대화가 있을 때만 항목이 켜진다(`rowMenuOf`) */
  const runAction = (row: ScheduleRow, action: RowAction): void => {
    switch (action) {
      case "openThread": {
        const threadId = row.lastRun?.threadId ?? null;
        if (threadId !== null) handlers.openThread(threadId);
        return;
      }
      case "reenable":
        handlers.reenable(row.id);
        return;
      case "fire":
        handlers.fire(row.id);
        return;
      case "runs":
        handlers.showRuns(row.id);
        return;
      case "edit":
        handlers.edit(row.id);
        return;
      case "cancel":
        handlers.askCancel(row.id);
        return;
      case "copy":
        handlers.copy(row.id);
        return;
      default:
        return assertNever(action, "RowAction");
    }
  };

  // 열마다 칸을 그리는 함수. 열 이름은 문자열이라 switch 대신 표로 찾는다
  const cells = new Map<string, (row: ScheduleRow) => ReactNode>([
    [
      "title",
      (row) => {
        const prompt = entryById.get(row.id)?.entry.prompt ?? row.promptPreview;
        const open = expanded.has(row.id);
        return (
          <span className="grid min-w-0 gap-0.5">
            <span className="truncate font-medium text-text-primary">{row.title}</span>
            <span className="whitespace-pre-line text-ui-sm text-text-tertiary">
              {open ? prompt : row.promptPreview}
            </span>
            {row.promptHasMore ? (
              <Button
                variant="ghost"
                size="xs"
                className="justify-self-start"
                aria-expanded={open}
                onClick={() => {
                  handlers.toggleExpanded(row.id);
                }}
              >
                {open ? t("desktop.schedules.lessPrompt") : t("desktop.schedules.morePrompt")}
              </Button>
            ) : null}
          </span>
        );
      },
    ],
    [
      "trigger",
      (row) => {
        const summary = triggerSummaryOf(row.triggerSummary, locale);
        return t(summary.id, summary.args);
      },
    ],
    [
      "next",
      (row) => {
        if (row.nextDueAt === null) return t("desktop.schedules.none");
        const message = nextRunTextOf(row.nextDueAt, state.nowMs, locale);
        return (
          <Tooltip content={timeTextOf(row.nextDueAt, locale)}>
            <span>{t(message.id, message.args)}</span>
          </Tooltip>
        );
      },
    ],
    [
      "last",
      (row) => {
        const raw = entryById.get(row.id)?.lastRun ?? null;
        return (
          <LastRunCell
            run={row.lastRun}
            at={raw === null ? null : lastRunAtOf(raw)}
            nowMs={state.nowMs}
            locale={locale}
          />
        );
      },
    ],
    ["iterations", (row) => t("desktop.schedules.iterations", { count: row.iterations })],
    [
      "stopped",
      (row) =>
        row.stoppedReason === null
          ? t("desktop.schedules.none")
          : t(stoppedOf(row.stoppedReason).id),
    ],
    [
      "enabled",
      (row) => (
        <Badge className={TONE_CLASS[row.enabled ? "success" : "neutral"]}>
          {t(row.enabled ? "desktop.schedules.enabled.on" : "desktop.schedules.enabled.off")}
        </Badge>
      ),
    ],
  ]);

  const renderCell = (tableRow: TableRow, column: TableColumn): ReactNode => {
    const row = rowById.get(tableRow.id);
    const cell = cells.get(column.key);
    return row === undefined || cell === undefined ? null : cell(row);
  };

  const rowActions = (tableRow: TableRow): ReactNode => {
    const row = rowById.get(tableRow.id);
    if (row === undefined) return null;
    const threadId = row.lastRun?.threadId ?? null;
    const menu = rowMenuOf(row, acting, threadId !== null && openable(threadId));
    return (
      <Menu
        align="end"
        trigger={
          <IconButton
            label={t("desktop.schedules.rowMenu")}
            variant="ghost"
            size="xs"
            disabled={!acting}
          >
            <Ellipsis />
          </IconButton>
        }
      >
        {menu.map((item) => (
          <MenuItem
            key={item.action}
            tone={item.action === "cancel" ? "danger" : "neutral"}
            disabled={item.disabled}
            onSelect={() => {
              runAction(row, item.action);
            }}
          >
            {t(ROW_ACTION_ID[item.action])}
          </MenuItem>
        ))}
      </Menu>
    );
  };

  return (
    <Table
      aria-label={t("desktop.schedules.title")}
      columns={columnsOf()}
      rows={[...rows]}
      renderCell={renderCell}
      rowActions={rowActions}
      selectionMode="single"
      selectedKeys={state.selectedId === null ? [] : [state.selectedId]}
      onSelectedKeysChange={(keys) => {
        const id = keys[0];
        if (id !== undefined) handlers.select(id);
      }}
    />
  );
}

function LastRunCell(props: {
  readonly run: ScheduleRow["lastRun"];
  /** 마지막 실행의 시각(epoch ms). 기록이 없으면 null */
  readonly at: number | null;
  readonly nowMs: number;
  readonly locale: Locale;
}): ReactNode {
  const { run, at, nowMs, locale } = props;
  if (run === null || at === null) return t("desktop.schedules.none");
  const status = lastRunStatusOf(run);
  const age = relativeAgeOf(at, nowMs);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge className={TONE_CLASS[status.tone]}>{t(status.label.id, status.label.args)}</Badge>
      {run.reason === null ? null : (
        <span className="text-ui-sm text-text-tertiary">{t(reasonOf(run.reason).id)}</span>
      )}
      <Tooltip content={timeTextOf(at, locale)}>
        <span className="text-ui-sm text-text-tertiary">{t(age.id, age.args)}</span>
      </Tooltip>
    </span>
  );
}
