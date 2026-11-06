// OS 알림의 순수 모델(B-10). 알림 종류를 설정 묶음으로 가르고, 보낼 글과 대화를 정하고, 같은 알림을 모으고,
// 권한 상태를 화면 글로 바꾸고, 알림을 누른 뒤 갈 대화 id를 읽는다. React와 셸을 보지 않는다.
// 제목과 본문은 알림에 담겨 온 본문을 쓰지 않고 카탈로그 문구와 대화 제목으로만 만든다(명령 전문과 시크릿이 OS 알림 센터에 남지 않게).
// 시험은 값을 비교한다(test/views/os-notify-model.test.ts).
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { Notice, NoticeKind } from "@fresnel/contracts/capabilities";
import { isId, type ThreadId } from "@fresnel/contracts/conversation";
import type { ThreadOrigin } from "@fresnel/contracts/wire";

/** 설정 묶음 셋. 턴이 끝남, 승인이나 질문을 기다림, 예약이 실패함 */
export type NotifyCategory = "turnDone" | "approval" | "scheduleFailed";

export type NotifyPrefs = Readonly<Record<NotifyCategory, boolean>>;

/** 같은 묶음, 같은 대화의 알림은 이 시간(ms) 안에 하나만 보낸다 */
const COALESCE_MS = 3000;

/** 보내기로 정한 알림 한 건. 제목과 본문은 이미 화면 언어의 글이다 */
export interface OsNoticePlan {
  readonly category: NotifyCategory;
  readonly title: string;
  readonly body: string;
  readonly threadId: ThreadId | null;
}

export interface OsNoticeInput {
  /** 알림 종류만 쓴다. 본문과 제목은 읽지 않는다 */
  readonly notice: Notice;
  readonly threadId: ThreadId | null;
  /** 알림의 대화 출처. 대화를 목록에서 찾지 못했으면 `null`이다 */
  readonly threadOrigin: ThreadOrigin | null;
  /** 대화 제목. 없으면 `null`이다 */
  readonly threadTitle: string | null;
  /** 앱 창이 앞에 있으면 참이다. 앞에 있으면 알림은 보내지 않는다(앱 안 알림이 보인다) */
  readonly windowFocused: boolean;
  readonly prefs: NotifyPrefs;
}

/** 알림 종류가 어느 묶음인지. 예약 대화의 실패만 묶음에 든다(그 밖의 오류는 OS 알림으로 보내지 않는다) */
function categoryOf(kind: NoticeKind, origin: ThreadOrigin | null): NotifyCategory | null {
  switch (kind) {
    case "completed":
    case "background_completed":
      return "turnDone";
    case "approval_waiting":
    case "question_waiting":
      return "approval";
    case "error":
      return origin?.kind === "schedule" ? "scheduleFailed" : null;
    default:
      return assertNever(kind, "NoticeKind");
  }
}

const WHAT: Readonly<Record<NoticeKind, MessageId>> = {
  completed: "desktop.osNotice.what.done",
  background_completed: "desktop.osNotice.what.done",
  approval_waiting: "desktop.osNotice.what.approval",
  question_waiting: "desktop.osNotice.what.question",
  error: "desktop.osNotice.what.scheduleFailed",
};

const BODY: Readonly<Record<NoticeKind, MessageId>> = {
  completed: "desktop.osNotice.body.done",
  background_completed: "desktop.osNotice.body.done",
  approval_waiting: "desktop.osNotice.body.approval",
  question_waiting: "desktop.osNotice.body.question",
  error: "desktop.osNotice.body.scheduleFailed",
};

/** 대화 제목. 없거나 공백뿐이면 "제목 없음"(`desktop.threads.untitled`)이다 */
function threadNameOf(title: string | null): string {
  const trimmed = title?.trim() ?? "";
  return trimmed === "" ? t("desktop.threads.untitled") : trimmed;
}

/**
 * 알림 한 건을 보낼지와 무엇을 보낼지 정한다. 창이 앞에 있거나, 묶음이 꺼졌거나, 묶음이 없는 오류면 `null`이다.
 * 제목은 "무엇 · 대화 제목"이고 본문은 종류마다 정한 한 줄이다.
 */
export function osNoticeOf(input: OsNoticeInput): OsNoticePlan | null {
  const category = categoryOf(input.notice.kind, input.threadOrigin);
  if (category === null) return null;
  if (input.windowFocused) return null;
  if (!input.prefs[category]) return null;
  const title = t("desktop.osNotice.title", {
    what: t(WHAT[input.notice.kind]),
    thread: threadNameOf(input.threadTitle),
  });
  return {
    category,
    title,
    body: t(BODY[input.notice.kind]),
    threadId: input.threadId,
  };
}

/** 묶음과 대화 쌍의 모임 열쇠 */
function coalesceKeyOf(plan: OsNoticePlan): string {
  return `${plan.category}:${plan.threadId ?? ""}`;
}

export interface CoalesceStep {
  /** 이번 알림을 보내야 하면 참이다 */
  readonly send: boolean;
  /** 다음 판단에 넘길 보낸 시각 지도. 보내지 않으면 받은 지도를 그대로 돌려준다 */
  readonly sent: ReadonlyMap<string, number>;
}

/**
 * 같은 묶음과 같은 대화의 알림은 `COALESCE_MS` 안에 하나만 보낸다. 시각은 인자로 받아 시험에서 조종한다.
 * 창 밖으로 나온 지 `COALESCE_MS`가 지난 기록은 지도에서 뺀다.
 */
export function coalesceStep(
  sent: ReadonlyMap<string, number>,
  plan: OsNoticePlan,
  now: number,
): CoalesceStep {
  const key = coalesceKeyOf(plan);
  const last = sent.get(key);
  if (last !== undefined && now - last < COALESCE_MS) return { send: false, sent };
  const next = new Map([...sent].filter(([k, at]) => k !== key && now - at < COALESCE_MS));
  next.set(key, now);
  return { send: true, sent: next };
}

/** 권한 상태. 셸은 데스크톱에서 늘 허용으로 답하므로 실제로는 허용이나 알 수 없음이 된다 */
export type PermissionState = "granted" | "denied" | "prompt" | "unknown";

/** 설정 화면이 보이는 권한 상태 종류. `failed`는 허용이어도 마지막 전달이 실패했다는 뜻이다 */
type PermissionKind = "ok" | "denied" | "failed" | "prompt" | "unknown";

export interface PermissionView {
  readonly kind: PermissionKind;
  readonly text: MessageId;
}

const PERMISSION_TEXT: Readonly<Record<PermissionKind, MessageId>> = {
  ok: "desktop.notifySettings.state.ok",
  denied: "desktop.notifySettings.state.denied",
  failed: "desktop.notifySettings.state.failed",
  prompt: "desktop.notifySettings.state.prompt",
  unknown: "desktop.notifySettings.state.unknown",
};

/** 권한 상태와 마지막 전달 실패로 설정 화면의 권한 줄을 정한다. 거부가 실패보다 앞선다 */
export function permissionViewOf(
  state: PermissionState,
  lastDeliveryFailed: boolean,
): PermissionView {
  const kind = permissionKindOf(state, lastDeliveryFailed);
  return { kind, text: PERMISSION_TEXT[kind] };
}

function permissionKindOf(state: PermissionState, lastDeliveryFailed: boolean): PermissionKind {
  switch (state) {
    case "denied":
      return "denied";
    case "granted":
      return lastDeliveryFailed ? "failed" : "ok";
    case "prompt":
      return lastDeliveryFailed ? "failed" : "prompt";
    case "unknown":
      return lastDeliveryFailed ? "failed" : "unknown";
    default:
      return assertNever(state, "PermissionState");
  }
}

/**
 * 알림을 눌러 앞에 올라온 뒤 갈 대화 id를 읽는다. 받은 값이 문자열이고 비어 있지 않으며 `ThreadId` 형식이어야 한다.
 * 그 밖의 값은 `null`이다(잘못된 값은 무시한다).
 */
export function notifyTargetOf(raw: unknown): ThreadId | null {
  if (typeof raw !== "string" || raw === "") return null;
  return isId("thr", raw) ? raw : null;
}
