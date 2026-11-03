import { assertNever } from "@fresnel/contracts";
import type {
  RunView,
  ScheduleEntryView,
  ScheduleError,
  ScheduleListItem,
  ScheduleTrigger,
} from "@fresnel/contracts/capabilities";
import type { WireParams } from "@fresnel/contracts/wire";

// 예약 화면(P-07, O-08, L4.settings-ui 예약 절)의 view-model. 순수 함수만 둔다: 호출과 화면은 앱이 맡는다.
// 트리거 요약은 문장이 아니라 데이터다. 문장은 화면이 i18n으로 만든다. 오류 값은 메시지 키로 바꾼다.

/**
 * 간격 최소값(초). cap-schedule의 `MIN_INTERVAL_SECONDS`(300)와 같다. F는 이 값을 상수로 내보내지 않고
 * 설명 문장에만 적는다. 엔진이 이보다 짧은 간격을 `interval_too_short`로 거부하므로 화면도 같은 값으로 먼저 막는다.
 */
export const SCHEDULE_MIN_INTERVAL_SECONDS = 300;

/** 입력 범위. 계약 스키마의 상한과 같다 */
export const SCHEDULE_BOUNDS = {
  intervalSeconds: { min: 1, max: 31_536_000 },
  paths: { min: 1, max: 16 },
  pathLength: { max: 4096 },
  debounceMs: { min: 0, max: 3_600_000 },
  loopIntervalSeconds: { min: 0, max: 31_536_000 },
  maxIterations: { min: 1, max: 10_000 },
};

const TITLE_MAX_CHARS = 60;
const PREVIEW_LINES = 2;
const SERVICE_ENABLED_KEY = "l0.process.service.enabled";

export type ScheduleTriggerKind = ScheduleTrigger["kind"];

/** 목록 한 줄의 마지막 실행. 목록 항목이 준 값 그대로다 */
export type ScheduleLastRun = {
  readonly status: RunView["status"];
  readonly outcome: RunView["outcome"];
  readonly reason: RunView["reason"];
  readonly threadId: string | null;
};

/** 목록 한 줄의 view-model */
export type ScheduleRow = {
  readonly id: string;
  /** 제목이 없으면 프롬프트 첫 줄을 60자까지 쓴다 */
  readonly title: string;
  readonly triggerKind: ScheduleTriggerKind;
  /** 트리거 데이터. 문장이 아니다 */
  readonly triggerSummary: ScheduleTrigger;
  readonly nextDueAt: number | null;
  readonly enabled: boolean;
  readonly iterations: number;
  readonly stoppedReason: ScheduleEntryView["stoppedReason"];
  readonly lastRun: ScheduleLastRun | null;
  /** 프롬프트 앞 두 줄 */
  readonly promptPreview: string;
  /** 두 줄을 넘는 줄이 있어 접힌 부분이 있는지 */
  readonly promptHasMore: boolean;
};

/** 줄바꿈으로 나눈 줄. CRLF도 같다 */
function linesOf(prompt: string): readonly string[] {
  return prompt.split(/\r?\n/);
}

/** 제목이 없을 때 쓰는 프롬프트 첫 줄. 빈 줄은 건너뛰고 앞뒤 공백을 떼며 60자(코드 포인트)까지 자른다 */
function titleOfPrompt(prompt: string): string {
  const first = linesOf(prompt).find((line) => line.trim() !== "") ?? "";
  return Array.from(first.trim()).slice(0, TITLE_MAX_CHARS).join("");
}

/** 목록 항목 한 건을 행으로 바꾼다 */
export function scheduleRowOf(item: ScheduleListItem): ScheduleRow {
  const { entry, lastRun } = item;
  const lines = linesOf(entry.prompt);
  return {
    id: entry.id,
    title: entry.title ?? titleOfPrompt(entry.prompt),
    triggerKind: entry.trigger.kind,
    triggerSummary: entry.trigger,
    nextDueAt: entry.nextDueAt,
    enabled: entry.enabled,
    iterations: entry.iterations,
    stoppedReason: entry.stoppedReason,
    lastRun:
      lastRun === null
        ? null
        : {
            status: lastRun.status,
            outcome: lastRun.outcome,
            reason: lastRun.reason,
            threadId: lastRun.threadId,
          },
    promptPreview: lines.slice(0, PREVIEW_LINES).join("\n"),
    promptHasMore: lines.length > PREVIEW_LINES,
  };
}

/** 켜진 항목이 먼저, 다음 기한이 빠른 순(없으면 뒤), 같으면 id 순 */
function compareRows(a: ScheduleRow, b: ScheduleRow): number {
  if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
  if (a.nextDueAt !== b.nextDueAt) {
    if (a.nextDueAt === null) return 1;
    if (b.nextDueAt === null) return -1;
    return a.nextDueAt - b.nextDueAt;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 목록을 행으로 바꾸고 정렬한다. 입력 배열은 바꾸지 않는다 */
export function scheduleListView(items: readonly ScheduleListItem[]): readonly ScheduleRow[] {
  return items.map((item) => scheduleRowOf(item)).toSorted(compareRows);
}

// ── 트리거 입력 ────────────────────────────────────────────────────────

/** 시트 입력값. 사용자가 친 그대로 두고 `triggerOfDraft`가 검사한다. 숫자 칸은 문자열이다 */
export type TriggerDraft = {
  readonly kind: ScheduleTriggerKind;
  /** 간격(초). 간격 트리거 */
  readonly intervalSeconds: string;
  /** 시각(epoch ms). 고르지 않았으면 null */
  readonly atMs: number | null;
  /** 감시 경로 */
  readonly paths: readonly string[];
  /** 감시 디바운스(ms) */
  readonly debounceMs: string;
  /** 루프 간격(초) */
  readonly loopIntervalSeconds: string;
  /** 루프 최대 반복 */
  readonly maxIterations: string;
  /** 루프 만료 시각(epoch ms 문자열) */
  readonly expiresAtMs: string;
};

/** 검사 실패가 가리키는 입력란 */
export type TriggerField =
  | "intervalSeconds"
  | "atMs"
  | "paths"
  | "debounceMs"
  | "loopIntervalSeconds"
  | "maxIterations"
  | "expiresAtMs";

export type TriggerDraftResult =
  | { readonly ok: true; readonly trigger: ScheduleTrigger }
  | {
      readonly ok: false;
      readonly field: "intervalSeconds";
      readonly code: "interval_too_short";
      readonly minSeconds: number;
    }
  | { readonly ok: false; readonly field: "atMs"; readonly code: "at_in_past" }
  | { readonly ok: false; readonly field: TriggerField; readonly code: "invalid_trigger" };

/** 숫자 칸의 글자를 정수로 읽는다. 숫자가 아니거나 안전한 정수를 넘으면 null */
function integerOf(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

function invalid(field: TriggerField): TriggerDraftResult {
  return { ok: false, field, code: "invalid_trigger" };
}

function intervalOf(text: string): TriggerDraftResult {
  const seconds = integerOf(text);
  if (seconds === null || seconds < SCHEDULE_BOUNDS.intervalSeconds.min) {
    return invalid("intervalSeconds");
  }
  if (seconds > SCHEDULE_BOUNDS.intervalSeconds.max) return invalid("intervalSeconds");
  if (seconds < SCHEDULE_MIN_INTERVAL_SECONDS) {
    return {
      ok: false,
      field: "intervalSeconds",
      code: "interval_too_short",
      minSeconds: SCHEDULE_MIN_INTERVAL_SECONDS,
    };
  }
  return { ok: true, trigger: { kind: "interval", everySeconds: seconds } };
}

function atOf(atMs: number | null, nowMs: number): TriggerDraftResult {
  if (atMs === null || !Number.isSafeInteger(atMs) || atMs < 1) return invalid("atMs");
  if (atMs <= nowMs) return { ok: false, field: "atMs", code: "at_in_past" };
  return { ok: true, trigger: { kind: "at", atMs } };
}

function watchOf(paths: readonly string[], debounceText: string): TriggerDraftResult {
  const trimmed = paths.map((path) => path.trim());
  if (trimmed.length < SCHEDULE_BOUNDS.paths.min || trimmed.length > SCHEDULE_BOUNDS.paths.max) {
    return invalid("paths");
  }
  if (trimmed.some((path) => path.length < 1 || path.length > SCHEDULE_BOUNDS.pathLength.max)) {
    return invalid("paths");
  }
  const debounceMs = integerOf(debounceText);
  if (debounceMs === null) return invalid("debounceMs");
  if (debounceMs > SCHEDULE_BOUNDS.debounceMs.max) return invalid("debounceMs");
  return { ok: true, trigger: { kind: "file_watch", paths: trimmed, debounceMs } };
}

function repeatOf(draft: TriggerDraft, nowMs: number): TriggerDraftResult {
  const intervalSeconds = integerOf(draft.loopIntervalSeconds);
  if (intervalSeconds === null || intervalSeconds > SCHEDULE_BOUNDS.loopIntervalSeconds.max) {
    return invalid("loopIntervalSeconds");
  }
  const maxIterations = integerOf(draft.maxIterations);
  if (
    maxIterations === null ||
    maxIterations < SCHEDULE_BOUNDS.maxIterations.min ||
    maxIterations > SCHEDULE_BOUNDS.maxIterations.max
  ) {
    return invalid("maxIterations");
  }
  // 만료가 지난 루프는 엔진이 `invalid_trigger`로 거부한다(loop_expiry_in_past)
  const expiresAtMs = integerOf(draft.expiresAtMs);
  if (expiresAtMs === null || expiresAtMs <= nowMs) return invalid("expiresAtMs");
  return {
    ok: true,
    trigger: { kind: "repeat", intervalSeconds, maxIterations, expiresAtMs },
  };
}

/**
 * 시트 입력을 트리거로 바꾸고 검사한다. 범위는 계약 스키마와 엔진 규칙을 따른다.
 * 간격은 1~31536000초 안에서 받고, 300초 미만이면 `interval_too_short`(최소 300초)를 돌린다.
 */
export function triggerOfDraft(draft: TriggerDraft, nowMs: number): TriggerDraftResult {
  switch (draft.kind) {
    case "interval":
      return intervalOf(draft.intervalSeconds);
    case "at":
      return atOf(draft.atMs, nowMs);
    case "file_watch":
      return watchOf(draft.paths, draft.debounceMs);
    case "remote":
      return { ok: true, trigger: { kind: "remote" } };
    case "repeat":
      return repeatOf(draft, nowMs);
    default:
      return assertNever(draft.kind, "ScheduleTrigger kind");
  }
}

/**
 * `schedule.create` 입력을 만든다. 트리거는 `triggerOfDraft`가 준 값이다.
 * 비어 있는 작업 폴더와 제목은 뺀다(exactOptionalPropertyTypes).
 */
export function createParamsOf(
  trigger: ScheduleTrigger,
  prompt: string,
  workspace: string,
  title: string,
): WireParams<"schedule.create"> {
  const folder = workspace.trim();
  const name = title.trim();
  return {
    trigger,
    prompt,
    ...(folder === "" ? {} : { workspace: folder }),
    ...(name === "" ? {} : { title: name }),
  };
}

// ── 오류 ───────────────────────────────────────────────────────────────

export type ScheduleErrorKey =
  | "desktop.schedules.error.interval_too_short"
  | "desktop.schedules.error.at_in_past"
  | "desktop.schedules.error.invalid_trigger"
  | "desktop.schedules.error.limit_reached"
  | "desktop.schedules.error.not_found"
  | "desktop.schedules.error.not_remote"
  | "desktop.schedules.error.disabled"
  | "desktop.schedules.error.store_failed";

/** 예약 오류 값의 메시지 키. 값이 들어가는 문장(최소 초 등)은 화면이 채운다 */
export function scheduleErrorKey(error: ScheduleError): ScheduleErrorKey {
  switch (error.kind) {
    case "interval_too_short":
      return "desktop.schedules.error.interval_too_short";
    case "at_in_past":
      return "desktop.schedules.error.at_in_past";
    case "invalid_trigger":
      return "desktop.schedules.error.invalid_trigger";
    case "limit_reached":
      return "desktop.schedules.error.limit_reached";
    case "not_found":
      return "desktop.schedules.error.not_found";
    case "not_remote":
      return "desktop.schedules.error.not_remote";
    case "disabled":
      return "desktop.schedules.error.disabled";
    case "store_failed":
      return "desktop.schedules.error.store_failed";
    default:
      return assertNever(error, "ScheduleError");
  }
}

// ── 서비스 모드 ────────────────────────────────────────────────────────

/** 설정 값 묶음(`settings.get`의 값 모양)을 받는다. 서비스 모드가 `true`가 아니면 경고를 보인다 */
export function serviceModeWarning(settingsValues: { readonly [key: string]: unknown }): boolean {
  return settingsValues[SERVICE_ENABLED_KEY] !== true;
}
