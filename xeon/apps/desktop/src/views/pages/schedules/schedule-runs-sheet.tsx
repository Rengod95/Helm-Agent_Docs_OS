import { t, type Locale } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { Alert, Button, EmptyState, Sheet, Skeleton } from "@caustic/react";
import type { ReactNode } from "react";
import type { RunRecord, RunsState } from "./schedule-model.ts";
import { STATUS_TEXT_TONE } from "./schedule-table.tsx";
import { isMissedReason, RUN_OUTCOME_VIEW, runReasonTextOf, timeTextOf } from "./schedule-text.ts";

// 실행 기록 시트(P-07, W-07 `schedule.runs`). 읽기 전용이다. 읽는 중, 비었음, 읽기 실패(목록 바로 위 danger Alert + 다시 읽기),
// 연결 끊김(다시 읽기 잠금)을 그린다. 실패와 건너뜀의 이유는 호스트의 사유 코드를 문장으로 바꿔 보인다(코드 이름은 보이지 않는다).
// 상태는 배지 없이 글자 색으로 준다. 놓친 실행(앱이 꺼진 동안 밀린 기한)만 작은 표식을 단다.

export interface ScheduleRunsSheetProps {
  readonly runs: RunsState | null;
  /** 시트 제목에 쓰는 예약 이름 */
  readonly title: string;
  readonly locale: Locale;
  readonly openable: (threadId: string) => boolean;
  readonly offline: boolean;
  readonly onOpenThread: (threadId: string) => void;
  readonly onRetry: (scheduleId: string) => void;
  readonly onClose: () => void;
}

function timeOf(iso: string, locale: Locale): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : timeTextOf(ms, locale);
}

function RunLine(props: {
  readonly run: RunRecord;
  readonly locale: Locale;
  readonly openable: (threadId: string) => boolean;
  readonly onOpenThread: (threadId: string) => void;
}): ReactNode {
  const { run, locale, openable, onOpenThread } = props;
  const status = RUN_OUTCOME_VIEW[run.outcome];
  const threadId = run.threadId;
  // 놓친 실행 표식은 사유 코드가 `missed`·`too_old`인 건너뜀 기록에만 붙는다. 따라잡은 실행(`missed`만 참)은 와이어에 없다
  const missed = run.error !== null && isMissedReason(run.error);
  const reason = run.error === null ? null : runReasonTextOf(run.error);
  return (
    <li className="grid gap-1 py-1.5">
      <span className="flex flex-wrap items-center gap-2 text-ui-sm">
        <span className={STATUS_TEXT_TONE[status.tone]}>
          {t(status.label.id, status.label.args)}
        </span>
        {missed ? (
          <span className="rounded-sm bg-neutral-track px-1.5 text-ui-xs text-text-secondary">
            {t("desktop.schedules.runs.missed")}
          </span>
        ) : null}
        <span className="tabular-nums text-text-secondary">{timeOf(run.startedAt, locale)}</span>
        {threadId === null ? null : (
          <Button
            size="xs"
            variant="ghost"
            disabled={!openable(threadId)}
            onClick={() => {
              onOpenThread(threadId);
            }}
          >
            {t("desktop.schedules.openThread")}
          </Button>
        )}
      </span>
      {reason === null ? null : (
        <span className={missed ? "text-ui-sm text-text-secondary" : "text-ui-sm text-danger-text"}>
          {t(reason.id, reason.args)}
        </span>
      )}
    </li>
  );
}

/** 시트 안쪽. 서버 렌더 시험이 시트 틀(포털) 없이 직접 그린다 */
export function RunsBody(props: ScheduleRunsSheetProps & { readonly runs: RunsState }): ReactNode {
  const { runs } = props;
  switch (runs.kind) {
    case "loading":
      return (
        <div role="status" aria-busy="true" className="grid gap-2">
          <span className="sr-only">{t("desktop.schedules.runs.loading")}</span>
          {[0, 1, 2].map((line) => (
            <Skeleton key={line} height={32} />
          ))}
        </div>
      );
    case "failed":
      return (
        <Alert
          tone="danger"
          action={
            <Button
              size="xs"
              variant="outline"
              disabled={props.offline}
              onClick={() => {
                props.onRetry(runs.scheduleId);
              }}
            >
              {t("desktop.schedules.retry")}
            </Button>
          }
        >
          {t(
            runs.reason === "unsupported"
              ? "desktop.schedules.unsupported"
              : "desktop.schedules.runs.failed",
          )}
        </Alert>
      );
    case "ready":
      if (runs.runs.length === 0) {
        return <EmptyState size="sm" title={t("desktop.schedules.runs.empty")} />;
      }
      return (
        <ul className="m-0 grid list-none p-0">
          {runs.runs.map((run) => (
            <RunLine
              key={run.runId}
              run={run}
              locale={props.locale}
              openable={props.openable}
              onOpenThread={props.onOpenThread}
            />
          ))}
        </ul>
      );
    default:
      return assertNever(runs, "RunsState");
  }
}

export function ScheduleRunsSheet(props: ScheduleRunsSheetProps): ReactNode {
  const { runs } = props;
  return (
    <Sheet
      open={runs !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={t("desktop.schedules.runs.title", { title: props.title })}
      size="sm"
    >
      {runs === null ? null : <RunsBody {...props} runs={runs} />}
    </Sheet>
  );
}
