import type { Locale, MessageArgs, MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type {
  RunView,
  ScheduleEntryView,
  ScheduleError,
  ScheduleTrigger,
} from "@fresnel/contracts/capabilities";
import {
  scheduleErrorKey,
  type ScheduleErrorKey,
  type ScheduleLastRun,
  type ScheduleTriggerKind,
  type TriggerDraftResult,
} from "@fresnel/client";
import type { CommandError } from "../../commands.ts";
import { dueAgeOf } from "../shared/relative-age.ts";

// 예약 화면의 문장 조립. 값은 메시지 키와 인자로 바꾸고, 문장은 화면이 `t()`로 만든다(트리거 요약은 데이터다).
// 키 이름은 카탈로그 검사(MESSAGE_KEY_PATTERN)를 따르려고 `_` 없이 camelCase다. 오류 코드는 `SCHEDULE_ERROR_ID`로 잇는다.

/** 메시지 키와 인자. `t(id, args)`로 푼다 */
export interface MessageRef {
  readonly id: MessageId;
  readonly args: MessageArgs;
}

export function message(id: MessageId, args: MessageArgs = {}): MessageRef {
  return { id, args };
}

/** 배지 색 계열. 문자와 함께 쓴다(접근성: 색만으로 뜻을 주지 않는다) */
export type StatusTone = "info" | "success" | "danger" | "warning" | "neutral";

export interface StatusView {
  readonly label: MessageRef;
  readonly tone: StatusTone;
}

export const TRIGGER_KINDS: readonly ScheduleTriggerKind[] = [
  "interval",
  "at",
  "file_watch",
  "remote",
  "repeat",
];

const TRIGGER_KIND_ID: Readonly<Record<ScheduleTriggerKind, MessageId>> = {
  interval: "desktop.schedules.trigger.interval",
  at: "desktop.schedules.trigger.at",
  file_watch: "desktop.schedules.trigger.fileWatch",
  remote: "desktop.schedules.trigger.remote",
  repeat: "desktop.schedules.trigger.repeat",
};

export function triggerKindId(kind: ScheduleTriggerKind): MessageId {
  return TRIGGER_KIND_ID[kind];
}

/** 시각을 지역 시각의 짧은 문장으로 쓴다(`format.ts`의 포맷은 UTC 고정이라 쓰지 않는다) */
export function timeTextOf(epochMs: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(epochMs),
  );
}

/** 다음 실행 칸의 문장. 가까운 시각은 상대 문장("N분 뒤", "내일 09:00")이고, 먼 시각은 절대 시각이다 */
export function nextRunTextOf(dueMs: number, nowMs: number, locale: Locale): MessageRef {
  const age = dueAgeOf(dueMs, nowMs, timeTextOf(dueMs, locale));
  return message(age.id, age.args);
}

/** 마지막 실행의 시각: 끝난 때, 없으면 시작한 때, 그도 없으면 잡은 때다 */
export function lastRunAtOf(run: RunView): number {
  return run.endedAt ?? run.startedAt ?? run.claimedAt;
}

/** 행 메뉴의 항목 문장 */
export type RowAction = "openThread" | "reenable" | "fire" | "runs" | "edit" | "cancel" | "copy";

export const ROW_ACTION_ID: Readonly<Record<RowAction, MessageId>> = {
  openThread: "desktop.schedules.openThread",
  reenable: "desktop.schedules.reenable",
  runs: "desktop.schedules.runs.action",
  edit: "desktop.schedules.edit.action",
  fire: "desktop.schedules.fire",
  cancel: "desktop.schedules.cancel",
  copy: "desktop.schedules.copy",
};

/** 거르기 칸의 문장. 값은 `ScheduleFilter`와 같다 */
export const FILTER_ID: Readonly<Record<"enabled" | "all", MessageId>> = {
  enabled: "desktop.schedules.filter.enabled",
  all: "desktop.schedules.filter.all",
};

/** 트리거 한 줄 요약(표의 "트리거" 칸) */
export function triggerSummaryOf(trigger: ScheduleTrigger, locale: Locale): MessageRef {
  switch (trigger.kind) {
    case "interval":
      return message("desktop.schedules.summary.interval", { seconds: trigger.everySeconds });
    case "at":
      return message("desktop.schedules.summary.at", { time: timeTextOf(trigger.atMs, locale) });
    case "file_watch":
      return message("desktop.schedules.summary.fileWatch", { paths: trigger.paths.join(", ") });
    case "remote":
      return message("desktop.schedules.summary.remote");
    case "repeat":
      return message("desktop.schedules.summary.repeat", {
        seconds: trigger.intervalSeconds,
        max: trigger.maxIterations,
        until: timeTextOf(trigger.expiresAtMs, locale),
      });
    default:
      return assertNever(trigger, "ScheduleTrigger");
  }
}

type RunStatus = RunView["status"];
type RunOutcome = NonNullable<RunView["outcome"]>;

const OUTCOME_VIEW: Readonly<Record<RunOutcome, StatusView>> = {
  completed: { label: message("desktop.schedules.status.completed"), tone: "success" },
  aborted: { label: message("desktop.schedules.status.aborted"), tone: "neutral" },
  failed: { label: message("desktop.schedules.status.failed"), tone: "danger" },
  awaiting_approval: {
    label: message("desktop.schedules.status.awaitingApproval"),
    tone: "warning",
  },
};

const STATUS_VIEW: Readonly<Record<Exclude<RunStatus, "finished">, StatusView>> = {
  claimed: { label: message("desktop.schedules.status.running"), tone: "info" },
  started: { label: message("desktop.schedules.status.running"), tone: "info" },
  skipped: { label: message("desktop.schedules.status.skipped"), tone: "neutral" },
  failed: { label: message("desktop.schedules.status.failed"), tone: "danger" },
};

/** 마지막 실행의 상태 문장과 배지 색. `finished`는 결과(outcome)로 갈린다 */
export function lastRunStatusOf(run: ScheduleLastRun): StatusView {
  if (run.status !== "finished") return STATUS_VIEW[run.status];
  if (run.outcome === null) {
    return { label: message("desktop.schedules.status.finished"), tone: "neutral" };
  }
  return OUTCOME_VIEW[run.outcome];
}

const REASON_ID: Readonly<Record<NonNullable<RunView["reason"]>, MessageId>> = {
  missed: "desktop.schedules.reason.missed",
  too_old: "desktop.schedules.reason.tooOld",
  min_interval: "desktop.schedules.reason.minInterval",
  overlap: "desktop.schedules.reason.overlap",
  rate_limited: "desktop.schedules.reason.rateLimited",
  host_exit: "desktop.schedules.reason.hostExit",
  start_failed: "desktop.schedules.reason.startFailed",
  run_failed: "desktop.schedules.reason.runFailed",
};

export function reasonOf(reason: NonNullable<RunView["reason"]>): MessageRef {
  return message(REASON_ID[reason]);
}

const STOPPED_ID: Readonly<Record<NonNullable<ScheduleEntryView["stoppedReason"]>, MessageId>> = {
  cancelled: "desktop.schedules.stopped.cancelled",
  completed: "desktop.schedules.stopped.completed",
  max_iterations: "desktop.schedules.stopped.maxIterations",
  expired: "desktop.schedules.stopped.expired",
  host_exit: "desktop.schedules.stopped.hostExit",
  run_failed: "desktop.schedules.stopped.runFailed",
};

export function stoppedOf(reason: NonNullable<ScheduleEntryView["stoppedReason"]>): MessageRef {
  return message(STOPPED_ID[reason]);
}

/** 예약 오류 코드 → 메시지 키. 키는 카탈로그 규칙에 맞게 camelCase다 */
export const SCHEDULE_ERROR_ID: Readonly<Record<ScheduleErrorKey, MessageId>> = {
  "desktop.schedules.error.interval_too_short": "desktop.schedules.error.intervalTooShort",
  "desktop.schedules.error.at_in_past": "desktop.schedules.error.atInPast",
  "desktop.schedules.error.invalid_trigger": "desktop.schedules.error.invalidTrigger",
  "desktop.schedules.error.limit_reached": "desktop.schedules.error.limitReached",
  "desktop.schedules.error.not_found": "desktop.schedules.error.notFound",
  "desktop.schedules.error.not_remote": "desktop.schedules.error.notRemote",
  "desktop.schedules.error.disabled": "desktop.schedules.error.disabled",
  "desktop.schedules.error.store_failed": "desktop.schedules.error.storeFailed",
};

/** `ok: false`의 오류 값을 문장으로. 값이 들어가는 문장은 인자를 채운다 */
export function scheduleErrorOf(error: ScheduleError): MessageRef {
  const id = SCHEDULE_ERROR_ID[scheduleErrorKey(error)];
  switch (error.kind) {
    case "interval_too_short":
      return message(id, { minSeconds: error.minSeconds });
    case "limit_reached":
      return message(id, { max: error.max });
    case "at_in_past":
    case "invalid_trigger":
    case "not_found":
    case "not_remote":
    case "disabled":
    case "store_failed":
      return message(id);
    default:
      return assertNever(error, "ScheduleError");
  }
}

/** 시트 입력 검사(`triggerOfDraft`)가 준 실패의 문장 */
export function triggerDraftErrorOf(
  failure: Extract<TriggerDraftResult, { readonly ok: false }>,
): MessageRef {
  switch (failure.code) {
    case "interval_too_short":
      return message("desktop.schedules.error.intervalTooShort", {
        minSeconds: failure.minSeconds,
      });
    case "at_in_past":
      return message("desktop.schedules.error.atInPast");
    case "invalid_trigger":
      return message("desktop.schedules.error.invalidTrigger");
    default:
      return assertNever(failure, "TriggerDraftResult");
  }
}

/** 연결이나 host 자체의 실패(transport)를 화면 문장으로. 기대한 실패(`ok: false`)는 `scheduleErrorOf`가 맡는다 */
export function commandErrorOf(error: CommandError): MessageRef {
  switch (error.kind) {
    case "offline":
      return message("desktop.schedules.offline");
    case "unsupported":
      return message("desktop.schedules.unsupported");
    case "failed":
    case "locked":
    case "rejected":
    case "switching":
      return message("desktop.schedules.actionFailed");
    default:
      return assertNever(error, "CommandError");
  }
}

/** 실행 기록 한 줄의 결과 배지. `running`은 진행 중이다 */
export const RUN_OUTCOME_VIEW: Readonly<
  Record<"running" | "ok" | "failed" | "skipped", StatusView>
> = {
  running: { label: message("desktop.schedules.status.running"), tone: "info" },
  ok: { label: message("desktop.schedules.status.completed"), tone: "success" },
  failed: { label: message("desktop.schedules.status.failed"), tone: "danger" },
  skipped: { label: message("desktop.schedules.status.skipped"), tone: "neutral" },
};
