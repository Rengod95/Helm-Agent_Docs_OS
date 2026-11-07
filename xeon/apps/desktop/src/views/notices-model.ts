import type { MessageArgs, MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  INPUT_NEEDED_KINDS,
  isThreadlessNoticeSeq,
  type Notice,
  type NoticeKind,
} from "@fresnel/contracts/capabilities";
import { approvalAgeOf } from "./approval-card/card-model.ts";
import { runReasonTextOf } from "./pages/schedules/schedule-text.ts";
import {
  turnFailureOf,
  type TurnFailureAction,
  type TurnFailureView,
} from "./turn-failure-model.ts";

// 받은 요청 탭의 알림 묶음(p03-inbox)이 쓰는 순수 함수. 목록은 요청 결과이고 거울에 넣지 않는다(FS-03).

/**
 * 화면이 들고 있는 알림 한 건. `threadId`는 대화별 목록이나 `notify.delivered`에서, `deliveredAt`은 `notify.delivered`에서만 안다.
 * 대화 없는 알림(`threadId`가 null)은 목록의 `threadless`나 `notify.delivered`로 온다. 전달 시각이 없으면 알림의 `createdAt`을 쓴다.
 */
export interface NoticeEntry {
  readonly notice: Notice;
  readonly threadId: ThreadId | null;
  /** 전달된 시각(epoch ms). 전달 알림으로 받은 것만 있다 */
  readonly deliveredAt?: number;
}

/** 화면에 두는 알림 수 상한(`notify.list`의 한 번 최대 500과 별개로 오래된 것부터 버린다) */
export const NOTICE_KEEP = 100;

const KIND_TEXT: Readonly<Record<NoticeKind, MessageId>> = {
  completed: "desktop.notices.kind.completed",
  approval_waiting: "desktop.notices.kind.approvalWaiting",
  question_waiting: "desktop.notices.kind.questionWaiting",
  error: "desktop.notices.kind.error",
  background_completed: "desktop.notices.kind.backgroundCompleted",
};

export function noticeKindId(kind: NoticeKind): MessageId {
  return KIND_TEXT[kind];
}

/**
 * 알림 제목을 앱 말투로 바꿀 카탈로그 키. 알림 원문은 엔진이 반말로 만들어 OS 알림과 CLI도 쓰므로 원문은 두고
 * 이 앱의 토스트와 목록에서만 바꾼다. 종류와 출처 이벤트로 고르고 원문 문장은 비교하지 않는다. 못 고르면 null이라 원문 그대로다
 */
export type NoticeTitleView = {
  readonly id: MessageId;
  readonly params?: { readonly tool: string };
};

/** 승인 알림 원문은 "<말>: <도구 이름>"이다. 콜론 뒤를 도구 이름으로 읽고, 말 자체는 보지 않는다 */
const TOOL_SEPARATOR = ": ";

export function noticeTitleViewOf(notice: Notice): NoticeTitleView | null {
  switch (notice.kind) {
    case "completed":
      return { id: "desktop.notices.title.completed" };
    case "question_waiting":
      return { id: "desktop.notices.title.question" };
    case "approval_waiting": {
      const at = notice.title.indexOf(TOOL_SEPARATOR);
      if (at < 0) return null;
      const tool = notice.title.slice(at + TOOL_SEPARATOR.length);
      return tool === "plan"
        ? { id: "desktop.notices.title.approvalPlan" }
        : { id: "desktop.notices.title.approvalTool", params: { tool } };
    }
    case "background_completed":
      return notice.sourceType === "schedule.run_finished"
        ? { id: "desktop.notices.title.scheduleCompleted" }
        : { id: "desktop.notices.title.backgroundCompleted" };
    case "error":
      if (notice.sourceType === "turn.completed") return { id: "desktop.notices.title.turnFailed" };
      if (notice.sourceType === "agent.settled") {
        return { id: "desktop.notices.title.backgroundFailed" };
      }
      if (notice.sourceType === "schedule.run_finished") {
        return { id: "desktop.notices.title.scheduleFailed" };
      }
      return null;
    default:
      return assertNever(notice.kind, "noticeTitleViewOf");
  }
}

/** 알림 본문 단추 중 알림 목록에서도 되는 것. 모델 고르기와 다시 보내기는 입력창이 있는 대화에서만 되어 뺀다 */
export type NoticeAction = Extract<TurnFailureAction, "reregister-key" | "open-providers">;

/**
 * 알림 본문을 화면에 보일 모양. 실패 문장이면 대화의 오류 줄과 같은 문장과 단추이고, 원문은 정보 아이콘 뒤 "자세히"에 둔다.
 * 실패가 아닌 본문은 원문 그대로 한 줄이다.
 */
export type NoticeBodyView =
  | {
      readonly kind: "failure";
      readonly text: MessageId;
      readonly params?: Readonly<Record<string, string>>;
      readonly action: NoticeAction | null;
      /** 정보 아이콘 뒤 "자세히"에 보일 원문. 원문이 없으면 null이다 */
      readonly detail: string | null;
    }
  | {
      /** 대화 없는 예약 실행의 실패 사유. 사유 코드를 카탈로그 문장으로 바꾼 것이라 단추와 "자세히"가 없다 */
      readonly kind: "scheduleReason";
      readonly text: MessageId;
      readonly params: MessageArgs;
    }
  | { readonly kind: "plain"; readonly text: string };

/** 상태 코드 뒤에 JSON이 붙거나 JSON만 온 본문. 원문을 본문 줄에 그대로 두지 않는다 */
const RAW_FAILURE = /^\s*(?:\d{3}\s*)?\{/;

function noticeActionOf(action: TurnFailureAction | null): NoticeAction | null {
  return action === "reregister-key" || action === "open-providers" ? action : null;
}

function failureViewOf(view: TurnFailureView): NoticeBodyView {
  return {
    kind: "failure",
    text: view.text,
    ...(view.params === undefined ? {} : { params: view.params }),
    action: noticeActionOf(view.action),
    detail: view.detail,
  };
}

/**
 * 알림 본문의 보일 모양. 오류 알림은 대화의 턴 실패 문장으로 바꾼다(`turnFailureOf`). 알 수 없는 오류가 JSON이면 원문 대신
 * 일반 실패 문장을 보인다. 오류가 아니거나 알 수 없는 평문이면 본문을 그대로 보인다. 본문이 없으면 null이다.
 */
export function noticeBodyViewOf(notice: Notice): NoticeBodyView | null {
  const { body } = notice;
  if (notice.kind !== "error") return body === null ? null : { kind: "plain", text: body };
  // 대화 없는 예약 실행의 본문은 실패 사유 코드다. 코드를 원문으로 보이지 않고 사유 문장으로 바꾼다
  if (notice.sourceType === "schedule.run_finished" && body !== null) {
    const reason = runReasonTextOf(body);
    return { kind: "scheduleReason", text: reason.id, params: reason.args };
  }
  if (body === null) {
    return { kind: "failure", text: "desktop.turnFailure.unknown", action: null, detail: null };
  }
  const view = turnFailureOf(body);
  if (view.kind === "unknown" && !RAW_FAILURE.test(body)) return { kind: "plain", text: body };
  return failureViewOf(view);
}

/** 지난 시간의 카탈로그 키와 값. 승인 카드의 요청 시각("N분 전")과 같은 말이다 */
export type NoticeAgeView = {
  readonly id: MessageId;
  readonly params?: { readonly count: number };
};

/** 알림이 보인 뒤 지난 시간. 시각은 `noticeShownAtOf`가 고른 것이다 */
export function noticeAgeViewOf(now: number, at: number): NoticeAgeView {
  const age = approvalAgeOf(now, at);
  switch (age.unit) {
    case "now":
      return { id: "desktop.approvals.age.now" };
    case "minutes":
      return { id: "desktop.approvals.age.minutes", params: { count: age.count } };
    case "hours":
      return { id: "desktop.approvals.age.hours", params: { count: age.count } };
    case "days":
      return { id: "desktop.approvals.age.days", params: { count: age.count } };
    default:
      return assertNever(age, "notice age");
  }
}

/** 알림 줄의 시각: 전달된 알림은 전달 시각이고, 목록으로 읽은 알림은 알림이 생긴 시각(`createdAt`)이다 */
export function noticeShownAtOf(entry: NoticeEntry): number {
  return entry.deliveredAt ?? entry.notice.createdAt;
}

/**
 * 이 알림을 화면 토스트로도 알리나. 새 승인 요청은 낭독 영역(`live-announcer.tsx`)이 이미 읽고, 토스트 영역과 토스트 자체도 낭독 영역이라
 * 같은 문장이 세 번 읽힌다. 승인 알림은 목록과 OS 알림, 대화의 승인 카드와 사이드바 승인 수로 알리고 토스트는 띄우지 않는다
 */
export function noticeToastVisible(notice: Notice): boolean {
  return notice.kind !== "approval_waiting";
}

/**
 * 알림의 새것 먼저 순서. 시각(`createdAt`)이 큰 것이 먼저이고, 같으면 seq가 큰 것이 먼저다. 대화 없는 알림의 seq는 실행 id의
 * 해시라 seq만으로는 시간 순서가 되지 않는다.
 */
export function newestFirstOf(a: Notice, b: Notice): number {
  return b.createdAt - a.createdAt || b.seq - a.seq;
}

/**
 * 같은 seq는 한 번만 둔다(목록 읽기와 전달 알림이 겹칠 수 있다). 새것이 위로 오고 상한을 넘으면 오래된 것을 버린다.
 * 같은 알림이 두 번 오면 대화와 전달 시각은 아는 쪽을 쓴다.
 */
export function mergeNotices(
  current: readonly NoticeEntry[],
  incoming: readonly NoticeEntry[],
): readonly NoticeEntry[] {
  const seen = new Map<number, NoticeEntry>();
  for (const entry of current) seen.set(entry.notice.seq, entry);
  for (const entry of incoming) {
    const known = seen.get(entry.notice.seq);
    seen.set(entry.notice.seq, known === undefined ? entry : joinEntries(known, entry));
  }
  return [...seen.values()]
    .toSorted((a, b) => newestFirstOf(a.notice, b.notice))
    .slice(0, NOTICE_KEEP);
}

/** 같은 알림의 두 줄을 한 줄로 합친다. 대화와 전달 시각은 먼저 안 쪽이 있으면 그것을 쓴다(목록 읽기는 둘 다 모른다) */
function joinEntries(known: NoticeEntry, incoming: NoticeEntry): NoticeEntry {
  const threadId = known.threadId ?? incoming.threadId;
  const deliveredAt = known.deliveredAt ?? incoming.deliveredAt;
  return {
    notice: incoming.notice,
    threadId,
    ...(deliveredAt === undefined ? {} : { deliveredAt }),
  };
}

/**
 * 알림의 band. 보통 알림과 대화 없는 알림은 seq 범위가 달라(`THREADLESS_NOTICE_SEQ_BASE`) 경계도 따로 둔다.
 * 대화 없는 알림의 seq가 이 범위에 있어 보통 알림의 경계를 올리면 나중의 보통 알림이 모두 가려지기 때문이다.
 */
export type NoticeBand = "normal" | "threadless";

function bandOf(seq: number): NoticeBand {
  return isThreadlessNoticeSeq(seq) ? "threadless" : "normal";
}

/** 목록의 한 band에서 가장 큰 seq. 그 band에 알림이 없으면 0이다 */
export function highestSeqOf(entries: readonly NoticeEntry[], band: NoticeBand): number {
  return entries.reduce(
    (top, entry) => (bandOf(entry.notice.seq) === band ? Math.max(top, entry.notice.seq) : top),
    0,
  );
}

/**
 * 경계 seq 뒤의 알림만 남긴다. 알림은 자기 band의 경계와 비교한다. 경계 이하는 지운 알림이라 다시 읽혀도 버린다
 */
export function noticesAfter(
  boundary: Pick<ClearedBoundary, "read" | "readThreadless">,
  entries: readonly NoticeEntry[],
): readonly NoticeEntry[] {
  const normal = boundary.read();
  const threadless = boundary.readThreadless();
  return entries.filter((entry) => {
    const through = bandOf(entry.notice.seq) === "threadless" ? threadless : normal;
    return entry.notice.seq > through;
  });
}

/**
 * 지운 알림의 경계 seq. band마다 따로 둔다. 지울 때마다 그 band의 가장 큰 seq로 올리고 내리지 않는다. 화면이 unmount되어도
 * 남도록 모듈에 하나 둔다. 앱을 다시 열면 0으로 돌아간다(알림 목록도 그때 다시 읽는다).
 */
export interface ClearedBoundary {
  /** 보통 알림의 경계 seq */
  readonly read: () => number;
  /** 대화 없는 알림의 경계 seq */
  readonly readThreadless: () => number;
  /** `seq`가 속한 band의 경계를 올린다 */
  readonly clearThrough: (seq: number) => void;
  /** 경계가 바뀔 때 부른다. 지운 뒤에도 보여야 하는 값이 다시 읽게 한다. 반환값은 해제 함수다 */
  readonly subscribe: (listener: () => void) => () => void;
}

export function createClearedBoundary(): ClearedBoundary {
  let through = 0;
  let throughThreadless = 0;
  const listeners = new Set<() => void>();
  return {
    read: () => through,
    readThreadless: () => throughThreadless,
    clearThrough: (seq) => {
      if (bandOf(seq) === "threadless") throughThreadless = Math.max(throughThreadless, seq);
      else through = Math.max(through, seq);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** 받은 요청 화면이 지운 알림의 경계. 목록을 읽거나 합칠 때마다 이 값보다 큰 알림만 든다 */
export const clearedNotices: ClearedBoundary = createClearedBoundary();

/** 알림 목록은 알림의 대화를 싣지 않는다. 대화별로 읽은 목록에서 알림 seq(DB 전역 단조)를 대화로 잇는다. 같은 seq가 둘이면 먼저 온 것이 이긴다 */
export function threadBySeqOf(
  reads: readonly { readonly threadId: ThreadId; readonly notices: readonly Notice[] }[],
): ReadonlyMap<number, ThreadId> {
  const found = new Map<number, ThreadId>();
  for (const read of reads) {
    for (const notice of read.notices) {
      if (!found.has(notice.seq)) found.set(notice.seq, read.threadId);
    }
  }
  return found;
}

/**
 * 사용자의 답을 기다리던 알림(승인·질문 대기)이 이미 풀렸나. 알림은 요청 id를 싣지 않아 대화 단위로 본다:
 * 알림의 대화가 알려져 있고 그 대화에 지금 기다리는 승인이 없으면 풀린 것이다. 대화를 모르면 풀렸다고 하지 않는다
 */
export function noticeResolved(entry: NoticeEntry, waitingThreads: ReadonlySet<string>): boolean {
  if (!INPUT_NEEDED_KINDS.includes(entry.notice.kind)) return false;
  return entry.threadId !== null && !waitingThreads.has(entry.threadId);
}
