import { t, type Locale } from "@fresnel/client/i18n";
import type { ScheduleRow } from "@fresnel/client";
import {
  Alert,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  EmptyState,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
} from "@caustic/react";
import { Plus, TriangleAlert } from "@caustic/react/icons";
import { useId, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { ScheduleDraft } from "./schedule-draft.ts";
import {
  canAct,
  isOffline,
  rowsOf,
  type ScheduleFilter,
  type ScheduleState,
} from "./schedule-model.ts";
import { ScheduleRunsSheet } from "./schedule-runs-sheet.tsx";
import { ScheduleSheet } from "./schedule-sheet.tsx";
import { ScheduleTable, type RowHandlers } from "./schedule-table.tsx";
import { FILTER_ID } from "./schedule-text.ts";

// 예약 화면의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 바로 가기 키의 뜻은 `keyIntentOf`가, 실제 동작은 `schedules-screen.tsx`의 `SchedulesScreen`이 맡는다.

/** 거르기 값인가. 칸의 글자 값을 `ScheduleFilter`로 좁힌다 */
function filterOf(value: string): ScheduleFilter | null {
  return value === "enabled" || value === "all" ? value : null;
}

/** 화면 동작. 속성 형태로 둬서 핸들러를 `onClick`에 그대로 넘겨도 된다 */
export interface ScheduleScreenHandlers extends RowHandlers {
  readonly filter: (filter: ScheduleFilter) => void;
  readonly openNew: () => void;
  readonly retry: () => void;
  readonly enableService: () => void;
  readonly dismissNotice: () => void;
  readonly dismissCancel: () => void;
  readonly cancel: (scheduleId: string) => void;
  readonly sheetChange: (draft: ScheduleDraft) => void;
  readonly sheetSubmit: () => void;
  readonly sheetClose: () => void;
  readonly runsClose: () => void;
  readonly onKey: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export interface ScheduleScreenViewProps {
  readonly state: ScheduleState;
  readonly locale: Locale;
  /** 마지막 실행의 대화가 지금 대화 목록에 있는가 */
  readonly openable: (threadId: string) => boolean;
  readonly handlers: ScheduleScreenHandlers;
}

export function ScheduleScreenView(props: ScheduleScreenViewProps): ReactNode {
  const { state, locale, openable, handlers } = props;
  const headingId = useId();
  const rows = rowsOf(state);
  const acting = canAct(state);
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
      onKeyDown={handlers.onKey}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id={headingId} className="text-ui-strong text-text-primary">
          {t("desktop.schedules.title")}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            size="sm"
            aria-label={t("desktop.schedules.filter.label")}
            value={state.filter}
            disabled={!acting}
            onValueChange={(value) => {
              const filter = filterOf(value);
              if (filter !== null) handlers.filter(filter);
            }}
          >
            <SegmentedControlItem value="enabled">{t(FILTER_ID.enabled)}</SegmentedControlItem>
            <SegmentedControlItem value="all">{t(FILTER_ID.all)}</SegmentedControlItem>
          </SegmentedControl>
          <Button size="sm" iconStart={<Plus />} disabled={!acting} onClick={handlers.openNew}>
            {t("desktop.schedules.new")}
          </Button>
        </div>
      </div>
      {state.serviceModeOff ? (
        <Alert
          tone="warning"
          action={
            <Button size="xs" variant="outline" disabled={!acting} onClick={handlers.enableService}>
              {t("desktop.schedules.service.enable")}
            </Button>
          }
        >
          {t("desktop.schedules.service.warning")}
        </Alert>
      ) : null}
      {state.list.kind === "failed" ? (
        <Alert
          tone="danger"
          action={
            <Button size="xs" variant="outline" disabled={!acting} onClick={handlers.retry}>
              {t("desktop.schedules.retry")}
            </Button>
          }
        >
          {t(
            state.list.reason === "unsupported"
              ? "desktop.schedules.unsupported"
              : "desktop.schedules.listFailed",
          )}
        </Alert>
      ) : null}
      {isOffline(state) ? <Alert tone="info">{t("desktop.schedules.offline")}</Alert> : null}
      {state.notice === null ? null : (
        <Alert
          tone={state.notice.tone === "danger" ? "danger" : "success"}
          dismissible
          dismissLabel={t("desktop.schedules.dismiss")}
          onDismiss={handlers.dismissNotice}
        >
          {t(state.notice.text.id, state.notice.text.args)}
        </Alert>
      )}
      <ScheduleBody
        state={state}
        rows={rows}
        locale={locale}
        openable={openable}
        handlers={handlers}
      />
      <CancelDialog rows={rows} cancelId={state.cancelId} handlers={handlers} />
      <ScheduleSheet
        sheet={state.sheet}
        onChange={handlers.sheetChange}
        onSubmit={handlers.sheetSubmit}
        onClose={handlers.sheetClose}
      />
      <ScheduleRunsSheet
        runs={state.runs}
        title={rows.find((row) => row.id === state.runs?.scheduleId)?.title ?? ""}
        locale={locale}
        openable={openable}
        offline={isOffline(state)}
        onOpenThread={handlers.openThread}
        onRetry={handlers.showRuns}
        onClose={handlers.runsClose}
      />
    </section>
  );
}

function ScheduleBody(props: {
  readonly state: ScheduleState;
  readonly rows: readonly ScheduleRow[];
  readonly locale: Locale;
  readonly openable: (threadId: string) => boolean;
  readonly handlers: ScheduleScreenHandlers;
}): ReactNode {
  const { state, rows, locale, openable, handlers } = props;
  if (state.list.kind === "loading" && state.items.length === 0) {
    return (
      <div role="status" aria-busy="true" className="grid gap-2">
        <span className="sr-only">{t("desktop.schedules.loading")}</span>
        {[0, 1, 2].map((line) => (
          <Skeleton key={line} height={40} />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    if (state.list.kind !== "ready") return null;
    return (
      <EmptyState
        size="md"
        title={t("desktop.schedules.empty")}
        description={t("desktop.schedules.emptyHint")}
        actions={[
          {
            label: t("desktop.schedules.new"),
            icon: <Plus />,
            disabled: !canAct(state),
            onClick: handlers.openNew,
          },
        ]}
      />
    );
  }
  return (
    <ScheduleTable
      rows={rows}
      items={state.items}
      state={state}
      locale={locale}
      openable={openable}
      handlers={handlers}
    />
  );
}

function CancelDialog(props: {
  readonly rows: readonly ScheduleRow[];
  readonly cancelId: string | null;
  readonly handlers: ScheduleScreenHandlers;
}): ReactNode {
  const { rows, cancelId, handlers } = props;
  const target = rows.find((row) => row.id === cancelId);
  return (
    <Dialog
      kind="alert"
      open={cancelId !== null}
      onOpenChange={(open) => {
        if (!open) handlers.dismissCancel();
      }}
      icon={<TriangleAlert />}
      title={t("desktop.schedules.cancelDialog.title")}
      description={t("desktop.schedules.cancelDialog.body", { title: target?.title ?? "" })}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t("desktop.schedules.cancelDialog.keep")}
            </Button>
          </DialogClose>
          <DialogAction
            onClick={() => {
              if (cancelId !== null) handlers.cancel(cancelId);
            }}
          >
            {t("desktop.schedules.cancelDialog.confirm")}
          </DialogAction>
        </>
      }
    />
  );
}
