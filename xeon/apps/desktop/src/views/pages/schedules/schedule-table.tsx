import { t, type Locale } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { ScheduleListItem, ScheduleTrigger } from "@fresnel/contracts/capabilities";
import type { ScheduleRow } from "@fresnel/client";
import {
  Button,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Popover,
  Table,
  type TableColumn,
  type TableRow,
} from "@caustic/react";
import { Ellipsis, Info, TriangleAlert } from "@caustic/react/icons";
import { useState, type ReactNode } from "react";
import { relativeAgeOf } from "../shared/relative-age.ts";
import {
  canAct,
  missedRunsViewOf,
  rowMenuOf,
  watchOutsideViewOf,
  type ScheduleState,
} from "./schedule-model.ts";
import {
  lastRunAtOf,
  lastRunStatusOf,
  message,
  nextRunTextOf,
  ROW_ACTION_ID,
  timeTextOf,
  triggerSummaryOf,
  type MessageRef,
  type RowAction,
  type StatusTone,
} from "./schedule-text.ts";

// 예약 표(P-07). 행은 `scheduleListView`가 준 정렬 순서이고 키보드 이동 순서도 이것이다. 상태는 글자 색으로 준다(배지 없음).
// 원격 예약의 "지금 실행"과 꺼진 예약의 "다시 켜기"는 칸 옆에 바로 둔다. 나머지 동작은 행 메뉴(`Menu`)에 모으고,
// 항목과 잠금은 `rowMenuOf`가 정한다. 상대 시각은 목록을 읽은 시각(`state.nowMs`) 기준이다.
// 놓친 실행 수는 마지막 실행 아래 작은 줄로, 허용 밖 감시 경로는 트리거 칸 아래 경고로 보인다. 설명은 정보 아이콘 뒤에 둔다.

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

/**
 * 꺼진 행에 "다시 켜기"를 보일 수 있는가. 지난 시각의 `at`은 엔진이 다시 켜지 않으므로(`reenableOf`) 단추와 메뉴 항목을 숨긴다.
 * 시각이 남은 꺼진 `at`(취소한 예약)은 켤 수 있다. 끝난 반복은 여기서 가리지 않는다(호스트가 거절하고 시트가 그 글을 보인다).
 */
export function canReenableRow(row: ScheduleRow, nowMs: number): boolean {
  if (row.enabled) return false;
  const trigger = row.triggerSummary;
  return !(trigger.kind === "at" && trigger.atMs <= nowMs);
}

/**
 * 루프 한 줄 요약: "10분마다 최대 10회, …까지". 단위는 간격 요약과 같다(시간으로 나누어떨어지면 시간, 분이면 분, 아니면 초).
 * 값은 `desktop.schedules.summary.repeat*`에 채운다.
 */
function repeatSummaryOf(
  trigger: Extract<ScheduleTrigger, { readonly kind: "repeat" }>,
  locale: Locale,
): MessageRef {
  const seconds = trigger.intervalSeconds;
  const args = { max: trigger.maxIterations, until: timeTextOf(trigger.expiresAtMs, locale) };
  if (seconds > 0 && seconds % 3600 === 0) {
    return message("desktop.schedules.summary.repeatHours", { ...args, count: seconds / 3600 });
  }
  if (seconds > 0 && seconds % 60 === 0) {
    return message("desktop.schedules.summary.repeatMinutes", { ...args, count: seconds / 60 });
  }
  return message("desktop.schedules.summary.repeatSeconds", { ...args, count: seconds });
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
        const trigger = row.triggerSummary;
        const summary =
          trigger.kind === "repeat"
            ? repeatSummaryOf(trigger, locale)
            : triggerSummaryOf(trigger, locale);
        const text = (
          <span className={`font-normal text-text-secondary ${dimOf(row)}`}>
            {t(summary.id, summary.args)}
          </span>
        );
        // 허용 밖 감시 경로는 경고로 보인다. 경고는 흐리게 하지 않는다
        const item = entryById.get(row.id);
        const outside = item === undefined ? null : watchOutsideViewOf(item);
        if (outside === null) return text;
        return (
          <span className="flex min-w-0 flex-col items-start gap-1">
            {text}
            <WatchOutsideLine paths={outside.paths} />
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
        const next = nextRunTextOf(row.nextDueAt, state.nowMs, locale);
        return (
          <span className={`font-normal tabular-nums text-text-secondary ${dimOf(row)}`}>
            {t(next.id, next.args)}
          </span>
        );
      },
    ],
    [
      "last",
      (row) => {
        const item = entryById.get(row.id);
        const raw = item?.lastRun ?? null;
        const threadId = row.lastRun?.threadId ?? null;
        const last = (
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
        // 놓친 실행이 없으면 마지막 실행 칸만 그린다
        const missed = item === undefined ? null : missedRunsViewOf(item);
        if (missed === null) return last;
        return (
          <span className="flex min-w-0 flex-col items-start gap-0.5">
            {last}
            <MissedRunsLine count={missed.count} dim={dimOf(row)} />
          </span>
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
    // 다시 켤 수 없는 행은 칸 옆 단추와 메뉴 항목을 함께 숨긴다(`canReenableRow`)
    const reenable = canReenableRow(row, state.nowMs);
    const plain = menu.filter(
      (item) => item.action !== "cancel" && (item.action !== "reenable" || reenable),
    );
    const cancel = menu.filter((item) => item.action === "cancel");
    return (
      <div className="flex items-center justify-end gap-0.5">
        {reenable ? (
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
        ) : null}
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

/**
 * 정보 아이콘 뒤의 설명 Popover. 누르면 연다. 알림 칸의 "자세히"(`notices.tsx`의 `Detail`)와 같은 모양이다.
 * Popover 본문은 열 때만 그려진다.
 */
function HelpPopover(props: { readonly label: string; readonly children: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      trigger="click"
      size="xs"
      className="craft-glass"
      open={open}
      onOpenChange={setOpen}
      anchor={
        <IconButton label={props.label} size="xs" variant="ghost">
          <Info />
        </IconButton>
      }
    >
      <div className="max-w-96 whitespace-pre-wrap [overflow-wrap:anywhere]">{props.children}</div>
    </Popover>
  );
}

/** 놓친 실행 수 한 줄. 마지막 실행 글 아래에 작은 글로 두고, 설명은 정보 아이콘 뒤에 둔다 */
function MissedRunsLine(props: { readonly count: number; readonly dim: string }): ReactNode {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${props.dim}`}>
      <span className="text-ui-xs text-text-tertiary">
        {t("desktop.schedules.missedRuns", { count: props.count })}
      </span>
      <HelpPopover label={t("desktop.schedules.missedRuns.help.label")}>
        {t("desktop.schedules.missedRuns.help")}
      </HelpPopover>
    </span>
  );
}

/**
 * 허용 밖 감시 경로 경고. 경고 글은 항상 보이고(주황 글과 삼각형 아이콘), 경로 목록과 고치는 법은 정보 아이콘 뒤에 둔다.
 */
function WatchOutsideLine(props: { readonly paths: readonly string[] }): ReactNode {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1 text-ui-xs text-warning-text">
      <TriangleAlert aria-hidden className="size-3.5 flex-none" />
      <span>{t("desktop.schedules.watchOutside")}</span>
      <HelpPopover label={t("desktop.schedules.watchOutside.help.label")}>
        <div className="grid gap-2">
          <div className="grid gap-1">
            {props.paths.map((path) => (
              <span key={path} className="font-mono text-mono-sm text-text-primary">
                {path}
              </span>
            ))}
          </div>
          <div>{t("desktop.schedules.watchOutside.help")}</div>
        </div>
      </HelpPopover>
    </span>
  );
}
