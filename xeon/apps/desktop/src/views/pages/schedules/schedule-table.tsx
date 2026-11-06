import { t, type Locale } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { ScheduleListItem } from "@fresnel/contracts/capabilities";
import type { ScheduleRow } from "@fresnel/client";
import {
  Button,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Table,
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
  ROW_ACTION_ID,
  triggerSummaryOf,
  type RowAction,
  type StatusTone,
} from "./schedule-text.ts";

// 예약 표(P-07). 행은 `scheduleListView`가 준 정렬 순서이고 키보드 이동 순서도 이것이다. 상태는 글자 색으로 준다(배지 없음).
// 원격 예약의 "지금 실행"과 꺼진 예약의 "다시 켜기"는 칸 옆에 바로 둔다. 나머지 동작은 행 메뉴(`Menu`)에 모으고,
// 항목과 잠금은 `rowMenuOf`가 정한다. 상대 시각은 목록을 읽은 시각(`state.nowMs`) 기준이다.

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
 * 상태 글자 색. 표와 실행 기록 시트가 같이 쓴다. 색만으로 뜻을 주지 않는다: 상태 글자가 따로 있다.
 */
export const STATUS_TEXT_TONE: Readonly<Record<StatusTone, string>> = {
  info: "text-text-primary",
  success: "text-text-secondary",
  danger: "text-danger-text",
  warning: "text-warning-text",
  neutral: "text-text-tertiary",
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
    { key: "trigger", header: t("desktop.schedules.columns.trigger"), width: 150 },
    { key: "next", header: t("desktop.schedules.columns.next"), width: 130 },
    { key: "last", header: t("desktop.schedules.columns.last"), width: 190 },
  ];
}

/** 끈 예약의 칸은 흐리게 그린다(배지 대신) */
function dimOf(row: ScheduleRow): string {
  return row.enabled ? "" : "opacity-60";
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
      (row) => (
        <span className={`truncate font-medium text-text-primary ${dimOf(row)}`}>{row.title}</span>
      ),
    ],
    [
      "trigger",
      (row) => {
        const summary = triggerSummaryOf(row.triggerSummary, locale);
        return (
          <span className={`font-normal text-text-secondary ${dimOf(row)}`}>
            {t(summary.id, summary.args)}
          </span>
        );
      },
    ],
    [
      "next",
      (row) => {
        if (row.nextDueAt === null) {
          return (
            <span className={`text-text-secondary ${dimOf(row)}`}>
              {t("desktop.schedules.none")}
            </span>
          );
        }
        const message = nextRunTextOf(row.nextDueAt, state.nowMs, locale);
        return (
          <span className={`font-normal tabular-nums text-text-secondary ${dimOf(row)}`}>
            {t(message.id, message.args)}
          </span>
        );
      },
    ],
    [
      "last",
      (row) => {
        const raw = entryById.get(row.id)?.lastRun ?? null;
        const threadId = row.lastRun?.threadId ?? null;
        return (
          <LastRunCell
            run={row.lastRun}
            at={raw === null ? null : lastRunAtOf(raw)}
            nowMs={state.nowMs}
            dim={dimOf(row)}
            onOpen={
              threadId !== null && openable(threadId)
                ? () => {
                    handlers.openThread(threadId);
                  }
                : null
            }
          />
        );
      },
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
    const plain = menu.filter((item) => item.action !== "cancel");
    const cancel = menu.filter((item) => item.action === "cancel");
    return (
      <div className="flex items-center justify-end gap-0.5">
        {row.enabled ? null : (
          <Button
            size="xs"
            variant="outline"
            disabled={!acting}
            onClick={() => {
              handlers.reenable(row.id);
            }}
          >
            {t("desktop.schedules.reenable")}
          </Button>
        )}
        {row.triggerKind === "remote" && row.enabled ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={!acting}
            onClick={() => {
              handlers.fire(row.id);
            }}
          >
            {t("desktop.schedules.fire")}
          </Button>
        ) : null}
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
          {plain.map((item) => (
            <MenuItem
              key={item.action}
              disabled={item.disabled}
              onSelect={() => {
                runAction(row, item.action);
              }}
            >
              {t(ROW_ACTION_ID[item.action])}
            </MenuItem>
          ))}
          {cancel.length === 0 ? null : <MenuSeparator />}
          {cancel.map((item) => (
            <MenuItem
              key={item.action}
              tone="danger"
              disabled={item.disabled}
              onSelect={() => {
                runAction(row, item.action);
              }}
            >
              {t(ROW_ACTION_ID[item.action])}
            </MenuItem>
          ))}
        </Menu>
      </div>
    );
  };

  return (
    <Table
      size="sm"
      variant="ghost"
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
  readonly dim: string;
  /** 실행이 만든 대화를 열 수 있으면 그 동작, 아니면 null */
  readonly onOpen: (() => void) | null;
}): ReactNode {
  const { run, at, nowMs, dim, onOpen } = props;
  if (run === null || at === null) {
    return (
      <span className={`text-text-tertiary ${dim}`}>{t("desktop.schedules.lastRunNone")}</span>
    );
  }
  const status = lastRunStatusOf(run);
  const age = relativeAgeOf(at, nowMs);
  const label = (
    <>
      <span className={STATUS_TEXT_TONE[status.tone]}>{t(status.label.id, status.label.args)}</span>
      <span className="text-ui-xs text-text-tertiary">{t(age.id, age.args)}</span>
    </>
  );
  if (onOpen === null) {
    return <span className={`inline-flex min-w-0 items-baseline gap-1.5 ${dim}`}>{label}</span>;
  }
  return (
    <Button
      variant="ghost"
      size="xs"
      className={`-mx-1 min-w-0 items-baseline gap-1.5 font-normal ${dim}`}
      onClick={onOpen}
    >
      {label}
    </Button>
  );
}
