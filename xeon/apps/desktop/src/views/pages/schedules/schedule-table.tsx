import { t, type Locale } from "@fresnel/client/i18n";
import type { ScheduleListItem } from "@fresnel/contracts/capabilities";
import type { ScheduleRow } from "@fresnel/client";
import { Badge, Button, Table, type TableColumn, type TableRow } from "@caustic/react";
import { Play } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { canAct, type ScheduleState } from "./schedule-model.ts";
import {
  lastRunStatusOf,
  reasonOf,
  stoppedOf,
  timeTextOf,
  triggerSummaryOf,
  type StatusTone,
} from "./schedule-text.ts";

// 예약 표(P-07). 행은 `scheduleListView`가 준 정렬 순서이고 키보드 이동 순서도 이것이다. 상태는 문자와 배지 색을 함께 쓴다.

/** 행 동작. 속성 형태로 둬서 `handlers.fire`를 그대로 넘겨도 된다 */
export interface RowHandlers {
  readonly select: (id: string) => void;
  readonly toggleExpanded: (id: string) => void;
  readonly fire: (id: string) => void;
  readonly copy: (id: string) => void;
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
      (row) =>
        row.nextDueAt === null ? t("desktop.schedules.none") : timeTextOf(row.nextDueAt, locale),
    ],
    [
      "last",
      (row) => {
        const threadId = row.lastRun?.threadId ?? null;
        return (
          <LastRunCell
            run={row.lastRun}
            openable={threadId !== null && openable(threadId)}
            disabled={!acting}
            onOpen={() => {
              if (threadId !== null) handlers.openThread(threadId);
            }}
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
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        {row.triggerKind === "remote" ? (
          <Button
            variant="ghost"
            size="xs"
            iconStart={<Play />}
            disabled={!acting}
            onClick={() => {
              handlers.fire(row.id);
            }}
          >
            {t("desktop.schedules.fire")}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="xs"
          disabled={!acting}
          onClick={() => {
            handlers.copy(row.id);
          }}
        >
          {t("desktop.schedules.copy")}
        </Button>
        {row.enabled ? (
          <Button
            variant="ghost"
            size="xs"
            className="text-danger-text"
            disabled={!acting}
            onClick={() => {
              handlers.askCancel(row.id);
            }}
          >
            {t("desktop.schedules.cancel")}
          </Button>
        ) : null}
      </span>
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
  readonly openable: boolean;
  readonly disabled: boolean;
  readonly onOpen: () => void;
}): ReactNode {
  const { run } = props;
  if (run === null) return t("desktop.schedules.none");
  const status = lastRunStatusOf(run);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge className={TONE_CLASS[status.tone]}>{t(status.label.id, status.label.args)}</Badge>
      {run.reason === null ? null : (
        <span className="text-ui-sm text-text-tertiary">{t(reasonOf(run.reason).id)}</span>
      )}
      {run.threadId !== null && props.openable ? (
        <Button variant="ghost" size="xs" disabled={props.disabled} onClick={props.onOpen}>
          {t("desktop.schedules.openThread")}
        </Button>
      ) : null}
    </span>
  );
}
