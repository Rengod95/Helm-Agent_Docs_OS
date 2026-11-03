import { assertNever } from "@fresnel/contracts";
import type {
  ScheduleEntryView,
  ScheduleError,
  ScheduleTrigger,
} from "@fresnel/contracts/capabilities";
import {
  createParamsOf,
  triggerOfDraft,
  type TriggerDraft,
  type TriggerField,
} from "@fresnel/client";
import type { WireParams } from "@fresnel/contracts/wire";
import { message, scheduleErrorOf, triggerDraftErrorOf, type MessageRef } from "./schedule-text.ts";

// 새 예약 시트(O-08)의 입력 모델. 입력은 문자열 그대로 두고, 검사는 `triggerOfDraft`와 여기서 한다.
// 시각 입력(`datetime-local`)은 지역 시각이라 epoch ms로 바꾸는 함수를 함께 둔다.

const DAY_MS = 86_400_000;
const PROMPT_MAX = 20_000;
const TITLE_MAX = 200;
const DEFAULT_INTERVAL_SECONDS = 86_400;
const DEFAULT_DEBOUNCE_MS = 1000;
const DEFAULT_LOOP_INTERVAL_SECONDS = 600;
const DEFAULT_MAX_ITERATIONS = 10;

export interface ScheduleDraft {
  readonly title: string;
  readonly prompt: string;
  readonly workspace: string;
  readonly enabled: boolean;
  readonly trigger: TriggerDraft;
}

/** 오류가 붙는 입력란. 트리거 입력은 `triggerOfDraft`가 가리키는 이름을 그대로 쓴다 */
export type SheetField = "title" | "prompt" | "workspace" | TriggerField;

export interface SheetErrors {
  readonly fields: Readonly<Partial<Record<SheetField, MessageRef>>>;
  /** 입력란에 붙지 않는 오류(연결 실패, 상한 등) */
  readonly form: MessageRef | null;
}

export const NO_ERRORS: SheetErrors = { fields: {}, form: null };

function defaultTrigger(nowMs: number): TriggerDraft {
  return {
    kind: "interval",
    intervalSeconds: String(DEFAULT_INTERVAL_SECONDS),
    atMs: null,
    paths: [],
    debounceMs: String(DEFAULT_DEBOUNCE_MS),
    loopIntervalSeconds: String(DEFAULT_LOOP_INTERVAL_SECONDS),
    maxIterations: String(DEFAULT_MAX_ITERATIONS),
    expiresAtMs: String(nowMs + DAY_MS),
  };
}

/** 새 예약 시트의 처음 값. 만료 시각은 지금부터 하루 뒤다 */
export function emptyDraft(nowMs: number): ScheduleDraft {
  return { title: "", prompt: "", workspace: "", enabled: true, trigger: defaultTrigger(nowMs) };
}

function triggerDraftOf(trigger: ScheduleTrigger, base: TriggerDraft): TriggerDraft {
  switch (trigger.kind) {
    case "interval":
      return { ...base, kind: "interval", intervalSeconds: String(trigger.everySeconds) };
    case "at":
      return { ...base, kind: "at", atMs: trigger.atMs };
    case "file_watch":
      return {
        ...base,
        kind: "file_watch",
        paths: trigger.paths,
        debounceMs: String(trigger.debounceMs),
      };
    case "remote":
      return { ...base, kind: "remote" };
    case "repeat":
      return {
        ...base,
        kind: "repeat",
        loopIntervalSeconds: String(trigger.intervalSeconds),
        maxIterations: String(trigger.maxIterations),
        expiresAtMs: String(trigger.expiresAtMs),
      };
    default:
      return assertNever(trigger, "ScheduleTrigger");
  }
}

/** 복제: 같은 값으로 시트를 연다. 기한이 지난 시각이나 만료는 사용자가 고친다 */
export function draftOfEntry(entry: ScheduleEntryView, nowMs: number): ScheduleDraft {
  return {
    title: entry.title ?? "",
    prompt: entry.prompt,
    workspace: entry.workspace ?? "",
    enabled: true,
    trigger: triggerDraftOf(entry.trigger, defaultTrigger(nowMs)),
  };
}

export type DraftCheck =
  | { readonly ok: true; readonly params: WireParams<"schedule.create"> }
  | { readonly ok: false; readonly errors: SheetErrors };

/** 시트 입력을 `schedule.create` 입력으로 바꾼다. 실패하면 입력란마다 붙을 문장을 돌려준다 */
export function checkDraft(draft: ScheduleDraft, nowMs: number): DraftCheck {
  const fields: Partial<Record<SheetField, MessageRef>> = {};
  if (draft.prompt.trim() === "") {
    fields.prompt = message("desktop.schedules.promptRequired");
  } else if (draft.prompt.length > PROMPT_MAX) {
    fields.prompt = message("desktop.schedules.promptTooLong", { max: PROMPT_MAX });
  }
  if (draft.title.trim().length > TITLE_MAX) {
    fields.title = message("desktop.schedules.titleTooLong", { max: TITLE_MAX });
  }
  const trigger = triggerOfDraft(draft.trigger, nowMs);
  if (!trigger.ok) fields[trigger.field] = triggerDraftErrorOf(trigger);
  if (!trigger.ok || Object.keys(fields).length > 0) {
    return { ok: false, errors: { fields, form: null } };
  }
  return {
    ok: true,
    params: {
      ...createParamsOf(trigger.trigger, draft.prompt, draft.workspace, draft.title),
      enabled: draft.enabled,
    },
  };
}

/** `schedule.create`의 `ok: false` 값을 입력란에 붙인다. 간격과 시각은 그 입력란에, 나머지는 시트 위에 붙인다 */
export function sheetErrorsOf(error: ScheduleError): SheetErrors {
  const text = scheduleErrorOf(error);
  switch (error.kind) {
    case "interval_too_short":
      return { fields: { intervalSeconds: text }, form: null };
    case "at_in_past":
      return { fields: { atMs: text }, form: null };
    case "invalid_trigger":
    case "limit_reached":
    case "not_found":
    case "not_remote":
    case "disabled":
    case "store_failed":
      return { fields: {}, form: text };
    default:
      return assertNever(error, "ScheduleError");
  }
}

/** `datetime-local` 값("YYYY-MM-DDTHH:mm", 지역 시각)을 epoch ms로. 비었거나 읽을 수 없으면 null */
export function msOfLocalInput(text: string): number | null {
  if (text.trim() === "") return null;
  const ms = new Date(text).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function padTwo(n: number): string {
  return String(n).padStart(2, "0");
}

/** epoch ms를 `datetime-local` 값으로(지역 시각, 분 단위). 없으면 빈 문자열 */
export function localInputOf(ms: number | null): string {
  if (ms === null) return "";
  const at = new Date(ms);
  if (Number.isNaN(at.getTime())) return "";
  const date = `${String(at.getFullYear())}-${padTwo(at.getMonth() + 1)}-${padTwo(at.getDate())}`;
  return `${date}T${padTwo(at.getHours())}:${padTwo(at.getMinutes())}`;
}

/** 만료 칸의 글자(epoch ms 문자열)를 `datetime-local` 값으로 */
export function expiresInputOf(text: string): string {
  return text.trim() === "" ? "" : localInputOf(Number(text));
}

/** `datetime-local` 값을 만료 칸의 글자(epoch ms 문자열)로. 읽을 수 없으면 빈 문자열이고 검사가 막는다 */
export function expiresTextOf(local: string): string {
  const ms = msOfLocalInput(local);
  return ms === null ? "" : String(ms);
}
