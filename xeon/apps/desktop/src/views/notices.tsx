import { InboxArt } from "./illustrations/index.tsx";
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { Notice, NoticeKind } from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  Alert,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  EmptyState,
  IconButton,
  Skeleton,
  toast,
} from "@caustic/react";
import {
  CalendarClock,
  CircleCheck,
  Inbox,
  Layers,
  MessageCircleQuestion,
  MessageSquare,
  TriangleAlert,
  X,
} from "@caustic/react/icons";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  useApprovalMirror,
  useLinkPhase,
  useThread,
  useThreadSummaries,
  useTurnFailures,
} from "../state/engine/index.ts";
import { useClockNow } from "./approval-card/clock.ts";
import { useCommands } from "./commands.ts";
import { InfoTip } from "./craft/info-tip.tsx";
import { arrangeInboxNotices, type InboxThread } from "./inbox-model.ts";
import {
  clearedNotices,
  highestSeqOf,
  mergeNotices,
  noticeAgeViewOf,
  noticeBodyViewOf,
  noticeItemsOf,
  noticeMarks,
  noticeShownAtOf,
  noticesAfter,
  noticeTitleViewOf,
  noticeToastVisible,
  NOTICE_KEEP,
  NOTICE_PAGE,
  NOTICE_TOAST_MS,
  readNoticePages,
  repeatTextOf,
  threadBySeqOf,
  unreadCountOf,
  type NoticeAction,
  type NoticeBodyView,
  type NoticeDay,
  type NoticeEntry,
  type NoticeItem,
  type NoticeMarks,
} from "./notices-model.ts";
import { useSelectedThreadId } from "../state/ui/index.ts";
import { useGoToThread } from "./thread-link.ts";

// 앱 안 알림(B-08). OS 알림은 플러그인 승인이 없어 하지 않는다. 받은 요청 탭에 목록을 두고,
// 전달된 알림은 토스트로도 보인다(NoticeToasts, App이 한 번 마운트).
// 목록을 지우면 그 seq까지를 모듈의 경계(`clearedNotices`)에 남긴다. 화면을 떠났다 와도, 다시 읽어도 지운 알림은 돌아오지 않는다.

type Load = "loading" | "ready" | "error";

interface FailureToasts {
  /** 열려 있는 실패 토스트 id → 대화 */
  readonly byId: Map<number, ThreadId>;
  /** 거울이 이 대화의 실패를 가진 것을 본 토스트 id. 알림이 거울보다 먼저 와도 바로 닫지 않는다 */
  readonly seen: Set<number>;
}

/** 알림에 대화 이름을 붙이려고 알림을 따로 읽는 최근 대화 수 */
const NAMED_THREADS = 30;

/** 설명 팝오버의 원문 상한(글자). 넘는 것은 자른다(대화의 오류 줄과 같다) */
const DETAIL_MAX = 1200;

/** 알림 제목. 아는 원문은 앱 말투로 바꾸고 모르는 것은 원문 그대로다 */
function noticeTitleText(notice: Notice): string {
  const view = noticeTitleViewOf(notice);
  if (view === null) return notice.title;
  return t(view.id, view.params);
}

/** 본문 보일 모양의 한 줄. 실패 문장은 카탈로그 문장이고, 평문은 원문이다 */
function bodyTextOf(view: NoticeBodyView): string {
  return view.kind === "plain" ? view.text : t(view.text, view.params);
}

/** 전달된 알림을 토스트로 알린다. 연결이 다시 붙으면 구독을 다시 건다 */
export function NoticeToasts(): ReactNode {
  const commands = useCommands();
  const phase = useLinkPhase();
  const failures = useTurnFailures();
  const open = useRef<FailureToasts>({ byId: new Map(), seen: new Set() });
  // 지금 보는 대화의 실패와(오류 띠가 보인다) 창이 앞일 때 그 대화의 끝남(턴 요약 줄이 보인다)은 토스트를 내지 않는다(noticeToastVisible)
  const selected = useRef<ThreadId | null>(null);
  const selectedId = useSelectedThreadId();
  useEffect(() => {
    selected.current = selectedId;
  }, [selectedId]);
  // 다른 대화의 "끝났어요"에는 어느 대화인지(제목, 없으면 첫 입력 미리보기)를 설명 줄로 붙인다(DP-146)
  const summaries = useThreadSummaries();
  const names = useRef<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    names.current = new Map(
      summaries.flatMap((summary) => {
        const name = summary.title ?? summary.preview ?? null;
        return name === null || name === "" ? [] : [[summary.threadId, name] as const];
      }),
    );
  }, [summaries]);
  useEffect(() => {
    if (phase !== "live") return undefined;
    const off = commands.notices.onDelivered((delivered) => {
      const { notice } = delivered;
      const shown = noticeToastVisible(notice, {
        threadId: delivered.threadId,
        openThreadId: selected.current,
        windowActive: document.visibilityState === "visible" && document.hasFocus(),
      });
      if (!shown) return;
      const isTurnFailure = notice.kind === "error" && notice.sourceType === "turn.completed";
      const view = notice.body === null ? null : noticeBodyViewOf(notice);
      const sentence =
        view === null
          ? delivered.threadId === null
            ? null
            : (names.current.get(delivered.threadId) ?? null)
          : bodyTextOf(view);
      const id = toast({
        tone: notice.kind === "error" ? "danger" : "neutral",
        title: isTurnFailure && sentence !== null ? sentence : noticeTitleText(notice),
        // 턴 실패의 원문은 대화의 오류 줄이 "자세히"로 보인다. 토스트에는 싣지 않는다
        ...(sentence === null || isTurnFailure ? {} : { description: sentence }),
        ...(notice.kind === "error"
          ? { dismissLabel: t("desktop.turnFailure.toast.dismiss") }
          : { duration: NOTICE_TOAST_MS }),
      });
      // 오류 토스트는 닫기 단추로 닫을 때까지 남는다(DP-153). 같은 대화의 다음 턴이 시작되면 아래에서 닫는다
      if (isTurnFailure && delivered.threadId !== null) {
        open.current.byId.set(id, delivered.threadId);
      }
    });
    return off;
  }, [commands, phase]);
  // 같은 대화의 실패가 거울에서 사라지면(다음 턴이 시작됨) 그 토스트를 닫는다
  useEffect(() => {
    const { byId, seen } = open.current;
    for (const [id, threadId] of byId) {
      if (failures[threadId] !== undefined) seen.add(id);
      else if (seen.has(id)) {
        toast.dismiss(id);
        byId.delete(id);
        seen.delete(id);
      }
    }
  }, [failures]);
  return null;
}

// 알림에는 제공자가 없어서 키 단추도 제공자 목록만 연다(키 대화 상자는 대화 줄의 오류 단추가 연다)
/** 실패 본문의 단추 글. 대화의 오류 줄과 같은 문장을 쓴다 */
const ACTION_TEXT: Readonly<Record<NoticeAction, MessageId>> = {
  "add-key": "desktop.turnFailure.action.addKey",
  "change-key": "desktop.turnFailure.action.changeKey",
  "open-providers": "desktop.turnFailure.action.openProviders",
};

const DAY_TEXT: Readonly<Record<NoticeDay, MessageId>> = {
  today: "desktop.notices.day.today",
  yesterday: "desktop.notices.day.yesterday",
  earlier: "desktop.notices.day.earlier",
};

// 알림 목록(DP-214~216 [결정: 2026-11-15 사용자 "정보 위계계층이 명확하도록", dzN2]). 날짜 머리와 알림이 왼쪽 세로 레일 하나에 매달린다.
// 할 일(오늘의 안 읽은 오류, 답을 기다리는 질문)은 카드(무슨 일 · 왜 · 어느 대화에서 · 할 일 단추 하나)이고, 나머지는 레일 위 한 줄
// (제목 · 대화 · 시각)이다. 종류는 배지가 아니라 면(오류 카드의 옅은 위험색)과 레일 마디의 아이콘 하나로 말한다. 색은 오류 카드에만 쓴다.
// 같은 날 이어진 같은 원인은 한 장으로 접고 "같은 오류 N번"을 단다. 처음 20장을 그리고 끝에 닿으면 20장씩 더 그린다. 치수는 notices.css.

/** 레일 마디의 아이콘 14. 오류 카드만 위험색이고 나머지는 글 색 계열이다 */
function NoticeIcon(props: { readonly kind: NoticeKind; readonly strong: boolean }): ReactNode {
  switch (props.kind) {
    case "error":
      return (
        <TriangleAlert
          aria-hidden
          className={props.strong ? "text-danger-text" : "text-text-tertiary"}
        />
      );
    case "approval_waiting":
      return <Inbox aria-hidden className="text-text-tertiary" />;
    case "question_waiting":
      return (
        <MessageCircleQuestion
          aria-hidden
          className={props.strong ? "text-text-secondary" : "text-text-tertiary"}
        />
      );
    case "background_completed":
      return <Layers aria-hidden className="text-text-tertiary" />;
    case "completed":
      return <CircleCheck aria-hidden className="text-text-tertiary" />;
    default:
      return assertNever(props.kind, "NoticeKind");
  }
}

/** 원문 "자세히": 앱의 정보 아이콘 하나(InfoTip, 패딩 0, 글과 4) 뒤에 둔다 */
function detailLinesOf(text: string): string {
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}…` : text;
}

/** 카드 본문. 실패는 대화의 오류 줄과 같은 문장 + 정보 아이콘, 대화 없는 예약 실패는 사유 문장, 평문은 원문이다 */
function CardBody(props: { readonly view: NoticeBodyView }): ReactNode {
  const { view } = props;
  return (
    <p className="notice-card-body">
      <span>{bodyTextOf(view)}</span>
      {view.kind === "failure" && view.detail !== null ? (
        <span className="notice-card-detail">
          <InfoTip
            text={detailLinesOf(view.detail)}
            label={t("desktop.turnFailure.detail.label")}
          />
        </span>
      ) : null}
    </p>
  );
}

/** 출처: 대화 이름(누르면 그 대화로) 또는 "예약". 모르면 그리지 않는다 */
function Source(props: { readonly entry: NoticeEntry; readonly onOpen: () => void }): ReactNode {
  const { entry } = props;
  if (entry.threadId !== null) {
    return <ThreadSource threadId={entry.threadId} onOpen={props.onOpen} />;
  }
  if (entry.notice.sourceType !== "schedule.run_finished") return null;
  return (
    <span className="notice-source" data-slot="notice-source">
      <CalendarClock aria-hidden />
      <span className="truncate">{t("desktop.notices.origin.schedule")}</span>
    </span>
  );
}

/** 대화 이름. 예약에서 만든 대화면 이름 뒤에 "(예약)"을 붙인다. 대화를 모르면 null */
function useThreadLabel(threadId: ThreadId): string | null {
  const thread = useThread(threadId);
  if (thread === undefined) return null;
  const name = thread.title ?? t("desktop.threads.untitled");
  return thread.origin?.kind === "schedule" ? t("desktop.notices.threadScheduled", { name }) : name;
}

function ThreadSource(props: {
  readonly threadId: ThreadId;
  readonly onOpen: () => void;
}): ReactNode {
  const goTo = useGoToThread();
  const label = useThreadLabel(props.threadId);
  if (label === null) return null;
  if (goTo === null) {
    return (
      <span className="notice-source" data-slot="notice-source">
        <MessageSquare aria-hidden />
        <span className="truncate">{label}</span>
      </span>
    );
  }
  const { threadId } = props;
  return (
    <button
      type="button"
      className="notice-source notice-source-link"
      data-slot="notice-source"
      aria-label={`${t("desktop.notices.source")}: ${label}`}
      title={label}
      onClick={() => {
        props.onOpen();
        goTo(threadId);
      }}
    >
      <MessageSquare aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** 줄의 곁 글: 대화 이름, 대화가 없으면 본문 한 줄(예약 실패면 사유) */
function LineMeta(props: { readonly id: string; readonly entry: NoticeEntry }): ReactNode {
  const { entry } = props;
  if (entry.threadId !== null) return <ThreadMeta id={props.id} threadId={entry.threadId} />;
  const body = noticeBodyViewOf(entry.notice);
  const text = body === null ? null : bodyTextOf(body);
  return text === null ? null : (
    <span id={props.id} className="notice-line-meta" title={text}>
      {text}
    </span>
  );
}

function ThreadMeta(props: { readonly id: string; readonly threadId: ThreadId }): ReactNode {
  const label = useThreadLabel(props.threadId);
  return label === null ? null : (
    <span id={props.id} className="notice-line-meta" title={label}>
      {label}
    </span>
  );
}

function NoticeTime(props: { readonly entry: NoticeEntry; readonly now: number }): ReactNode {
  const at = noticeShownAtOf(props.entry);
  const age = noticeAgeViewOf(props.now, at);
  return (
    <time
      className="notice-time"
      dateTime={new Date(at).toISOString()}
      title={new Date(at).toLocaleString()}
    >
      {t(age.id, age.params)}
    </time>
  );
}

function DismissButton(props: { readonly onDismiss: () => void }): ReactNode {
  return (
    <IconButton
      size="xs"
      variant="ghost"
      label={t("desktop.notices.dismiss")}
      className="notice-dismiss"
      onClick={() => {
        props.onDismiss();
      }}
    >
      <X aria-hidden />
    </IconButton>
  );
}

function seqsOf(item: NoticeItem): readonly number[] {
  return item.entries.map((entry) => entry.notice.seq);
}

/** 할 일 카드: 1줄 제목 · 반복 · 시각, 2줄 왜(본문), 3줄 어느 대화에서 · 할 일 단추 하나 */
function NoticeCard(props: { readonly item: NoticeItem; readonly now: number }): ReactNode {
  const commands = useCommands();
  const goTo = useGoToThread();
  const { item } = props;
  const entry = item.head;
  const { notice } = entry;
  const body = noticeBodyViewOf(notice);
  const action = body?.kind === "failure" ? body.action : null;
  const repeat = repeatTextOf(item);
  const read = (): void => {
    noticeMarks.markRead(seqsOf(item));
  };
  const threadId = entry.threadId;
  const answer = notice.kind === "question_waiting" && threadId !== null && goTo !== null;
  return (
    <article
      className="notice-card"
      data-tone={notice.kind === "error" ? "danger" : "neutral"}
      data-read={item.read ? "true" : undefined}
    >
      <div className="notice-card-head">
        <h4 className="notice-card-title">{noticeTitleText(notice)}</h4>
        {repeat === null ? null : (
          <span className="notice-repeat">{t(repeat.id, { count: repeat.count })}</span>
        )}
        <NoticeTime entry={entry} now={props.now} />
        <DismissButton
          onDismiss={() => {
            noticeMarks.dismiss(seqsOf(item));
          }}
        />
      </div>
      {body === null ? null : <CardBody view={body} />}
      <div className="notice-card-foot">
        <span className="min-w-0 flex-1">
          <Source entry={entry} onOpen={read} />
        </span>
        {action === null ? null : (
          <Button
            size="sm"
            variant="solid"
            onClick={() => {
              read();
              commands.requestSettingsJump({ tab: "providers", key: null });
            }}
          >
            {t(ACTION_TEXT[action])}
          </Button>
        )}
        {answer ? (
          <Button
            size="sm"
            variant="solid"
            onClick={() => {
              read();
              goTo(threadId);
            }}
          >
            {t("desktop.notices.action.answer")}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

/** 레일 위 한 줄(32): 제목 · 곁 글 · 시각. 줄 전체가 그 대화로 가는 단추이고(대화가 없으면 읽음만), hover·초점에서 시각 자리에 지우기가 뜬다 */
function NoticeLine(props: { readonly item: NoticeItem; readonly now: number }): ReactNode {
  const goTo = useGoToThread();
  const titleId = useId();
  const metaId = useId();
  const { item } = props;
  const entry = item.head;
  const title = noticeTitleText(entry.notice);
  const repeat = repeatTextOf(item);
  const threadId = entry.threadId;
  return (
    <div className="notice-line" data-read={item.read ? "true" : undefined}>
      <button
        type="button"
        className="notice-line-hit"
        aria-labelledby={`${titleId} ${metaId}`}
        onClick={() => {
          noticeMarks.markRead(seqsOf(item));
          if (threadId !== null && goTo !== null) goTo(threadId);
        }}
      />
      <span id={titleId} className="notice-line-title" title={title}>
        {title}
      </span>
      {repeat === null ? null : (
        <span className="notice-repeat">{t(repeat.id, { count: repeat.count })}</span>
      )}
      <LineMeta id={metaId} entry={entry} />
      <NoticeTime entry={entry} now={props.now} />
      <DismissButton
        onDismiss={() => {
          noticeMarks.dismiss(seqsOf(item));
        }}
      />
    </div>
  );
}

/** 날짜 머리와 장을 레일 위 한 줄씩으로 편다. 레일 선은 첫 칸 위와 끝 칸 아래에서 끊긴다 */
type RailRow =
  | { readonly kind: "day"; readonly key: string; readonly day: NoticeDay }
  | { readonly kind: "item"; readonly key: string; readonly item: NoticeItem };

function railRowsOf(items: readonly NoticeItem[]): readonly RailRow[] {
  const rows: RailRow[] = [];
  let day: NoticeDay | null = null;
  for (const item of items) {
    if (item.day !== day) {
      day = item.day;
      rows.push({ kind: "day", key: `day:${item.day}`, day: item.day });
    }
    rows.push({ kind: "item", key: item.key, item });
  }
  return rows;
}

function NoticeRail(props: {
  readonly items: readonly NoticeItem[];
  readonly now: number;
}): ReactNode {
  const rows = railRowsOf(props.items);
  return (
    <ol className="notice-rail" data-slot="notice-rail">
      {rows.map((row, index) => {
        const edge = {
          "data-rail-start": index === 0 ? "true" : undefined,
          "data-rail-end": index === rows.length - 1 ? "true" : undefined,
        };
        if (row.kind === "day") {
          return (
            <li key={row.key} className="notice-rail-row" data-shape="day" {...edge}>
              <span aria-hidden className="notice-node" />
              <h3 className="notice-day">{t(DAY_TEXT[row.day])}</h3>
            </li>
          );
        }
        const { item } = row;
        const kind = item.head.notice.kind;
        return (
          <li
            key={row.key}
            className="notice-rail-row"
            data-shape={item.prominent ? "card" : "line"}
            {...edge}
          >
            <span className="notice-node">
              <NoticeIcon kind={kind} strong={item.prominent} />
            </span>
            {item.prominent ? (
              <NoticeCard item={item} now={props.now} />
            ) : (
              <NoticeLine item={item} now={props.now} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** 끝에 닿으면 `onMore`를 부른다(IntersectionObserver). 관찰할 수 없는 곳에서는 단추가 같은 일을 한다 */
function MoreSentinel(props: { readonly onMore: () => void }): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  const more = useRef(props.onMore);
  useEffect(() => {
    more.current = props.onMore;
  }, [props.onMore]);
  useEffect(() => {
    const node = ref.current;
    if (node === null || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver((seen) => {
      if (seen.some((entry) => entry.isIntersecting)) more.current();
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <div ref={ref} className="notice-more">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          props.onMore();
        }}
      >
        {t("desktop.notices.more")}
      </Button>
    </div>
  );
}

/** 알림 묶음을 읽고 지우는 상태. 받은 요청 화면은 한 번 만들어 `InboxNotices`에 넘긴다(대화 셀렉트가 같은 목록을 본다) */
export interface NoticeFeed {
  readonly load: Load;
  readonly entries: readonly NoticeEntry[];
  readonly retry: () => void;
  readonly clear: () => void;
}

/** 대화별로 읽어 대화 이름을 붙일 때 한 대화에서 넘기는 쪽 수 상한 */
const NAMED_PAGE_CALLS = 20;

/** 알림을 읽고(연결이 살아 있을 때), 전달되는 대로 더하고, 지우면 경계를 올린다 */
export function useNoticeFeed(): NoticeFeed {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [load, setLoad] = useState<Load>("loading");
  const [entries, setEntries] = useState<readonly NoticeEntry[]>([]);

  // 대화 이름을 붙이려고 최근 대화별로 알림을 읽는다. 목록이 바뀔 때마다 다시 읽지 않도록 값은 ref로 든다
  const summaries = useThreadSummaries();
  const recentIds = useRef<readonly ThreadId[]>([]);
  useEffect(() => {
    recentIds.current = summaries.slice(0, NAMED_THREADS).map((summary) => summary.threadId);
  }, [summaries]);

  const read = useCallback((): void => {
    const run = async (): Promise<void> => {
      // 엔진은 오래된 것부터 한 쪽씩 준다. 끝까지 넘겨 새것을 든다(DP-216)
      const listed = await readNoticePages((after) => commands.notices.list(undefined, after));
      if (!listed.ok) {
        setLoad("error");
        return;
      }
      const scoped = await Promise.all(
        recentIds.current.map(async (threadId) => {
          const got = await readNoticePages(
            (after) => commands.notices.list(threadId, after),
            NOTICE_KEEP,
            NAMED_PAGE_CALLS,
          );
          return { threadId, notices: got.ok ? got.value.notices : [] };
        }),
      );
      const threads = threadBySeqOf(scoped);
      const incoming: readonly NoticeEntry[] = [
        ...listed.value.notices.map((notice) => ({
          notice,
          threadId: threads.get(notice.seq) ?? null,
        })),
        // 대화 없는 알림은 대화별 목록에 없고, 이 목록의 `threadless`로만 온다
        ...listed.value.threadless.map((notice) => ({ notice, threadId: null })),
      ];
      // 지운 경계는 읽는 동안 올라갔을 수 있어 합치는 순간에 본다
      setEntries((now) => mergeNotices(now, noticesAfter(clearedNotices, incoming)));
      setLoad("ready");
    };
    detach(run(), rethrow);
  }, [commands]);

  useEffect(() => {
    if (phase !== "live") return undefined;
    read();
    return commands.notices.onDelivered((delivered) => {
      // 전달 시각은 문자열이다. 읽히지 않으면 시각 줄 없이 둔다
      const at = Date.parse(delivered.deliveredAt);
      const entry: NoticeEntry = {
        notice: delivered.notice,
        threadId: delivered.threadId,
        ...(Number.isNaN(at) ? {} : { deliveredAt: at }),
      };
      setEntries((now) => mergeNotices(now, noticesAfter(clearedNotices, [entry])));
    });
  }, [commands, phase, read]);

  const retry = useCallback((): void => {
    setLoad("loading");
    read();
  }, [read]);

  const clear = useCallback((): void => {
    // 보통 알림과 대화 없는 알림은 경계가 따로라 band마다 가장 큰 seq까지 지운다
    clearedNotices.clearThrough(highestSeqOf(entries, "normal"));
    clearedNotices.clearThrough(highestSeqOf(entries, "threadless"));
    setEntries([]);
  }, [entries]);

  return { load, entries, retry, clear };
}

/** "모두 지우기"의 확인 상자. 되돌릴 수 없다는 말을 보이고, 기본 단추는 돌아가기다 */
function ClearDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}): ReactNode {
  return (
    <Dialog
      kind="alert"
      open={props.open}
      onOpenChange={props.onOpenChange}
      icon={<TriangleAlert />}
      title={t("desktop.notices.clearDialog.title")}
      description={t("desktop.notices.clearDialog.body")}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.notices.clearDialog.keep")}
            </Button>
          </DialogClose>
          <DialogAction
            onClick={() => {
              props.onConfirm();
            }}
          >
            {t("desktop.notices.clearDialog.confirm")}
          </DialogAction>
        </>
      }
    />
  );
}

/** 읽음·지우기 표지의 판. 바뀌면 다시 그린다 */
function useNoticeMarks(): NoticeMarks {
  useSyncExternalStore(noticeMarks.subscribe, noticeMarks.version, noticeMarks.version);
  return noticeMarks.marks();
}

/** 상태 없이 그리는 목록(서버 렌더 시험과 견본이 직접 그린다) */
export function NoticeListView(props: {
  readonly items: readonly NoticeItem[];
  readonly now: number;
  /** 그릴 장 수. 나머지는 끝에 닿으면 더 그린다 */
  readonly shown: number;
  readonly onMore: () => void;
}): ReactNode {
  const visible = props.items.slice(0, props.shown);
  return (
    <>
      <NoticeRail items={visible} now={props.now} />
      {visible.length < props.items.length ? <MoreSentinel onMore={props.onMore} /> : null}
    </>
  );
}

function NoticeList(props: { readonly feed: NoticeFeed; readonly thread: InboxThread }): ReactNode {
  const { feed } = props;
  const phase = useLinkPhase();
  const approvals = useApprovalMirror();
  const waiting = new Set(approvals.ids.flatMap((id) => approvals.byId[id]?.threadId ?? []));
  const now = useClockNow();
  const marks = useNoticeMarks();
  const [confirming, setConfirming] = useState(false);
  const [shown, setShown] = useState(NOTICE_PAGE);
  // 알림은 늘 새것 먼저다(날짜 머리와 더 보기가 그 순서를 전제한다). 정렬 셀렉트는 승인 구역만 거른다(DP-216)
  const entries = arrangeInboxNotices(feed.entries, { thread: props.thread, sort: "newest" });
  const items = noticeItemsOf(entries, { now, marks, waitingThreads: waiting });
  const unread = unreadCountOf(items);
  const more = useCallback((): void => {
    setShown((count) => count + NOTICE_PAGE);
  }, []);
  return (
    <section className="grid gap-2" aria-label={t("desktop.notices.label")}>
      <header className="flex h-7 items-center gap-2">
        <h2 className="m-0 text-ui-strong text-text-primary">{t("desktop.notices.title")}</h2>
        {unread === 0 ? null : (
          <span className="text-ui-sm text-text-tertiary">
            {t("desktop.notices.unread", { count: unread })}
          </span>
        )}
        <span className="flex-1" />
        {unread === 0 ? null : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              noticeMarks.markRead(items.flatMap(seqsOf));
            }}
          >
            {t("desktop.notices.markAllRead")}
          </Button>
        )}
        {items.length === 0 ? null : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setConfirming(true);
            }}
          >
            {t("desktop.notices.clear")}
          </Button>
        )}
      </header>
      {phase !== "live" ? (
        <Alert tone="warning" size="sm" radius="md" role="status">
          {t("desktop.notices.offline")}
        </Alert>
      ) : null}
      {feed.load === "loading" && phase === "live" && feed.entries.length === 0 ? (
        <div className="grid gap-1" aria-label={t("desktop.notices.loading")} role="status">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : null}
      {feed.load === "error" ? (
        <Alert tone="danger" size="sm" radius="md" role="alert">
          {t("desktop.notices.failed")}{" "}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              feed.retry();
            }}
          >
            {t("desktop.notices.retry")}
          </Button>
        </Alert>
      ) : null}
      {feed.load === "ready" && items.length === 0 ? (
        <EmptyState
          media={<InboxArt />}
          size="sm"
          surface="none"
          title={t("desktop.notices.empty")}
        />
      ) : null}
      {items.length === 0 ? null : (
        <NoticeListView items={items} now={now} shown={shown} onMore={more} />
      )}
      <ClearDialog
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => {
          setConfirming(false);
          feed.clear();
        }}
      />
    </section>
  );
}

/**
 * 받은 요청 탭의 알림 묶음. 화면이 `feed`를 넘기면 그 목록을 쓰고, 없으면(끝 영역 탭) 이 자리에서 읽는다.
 * 대화 거르기는 승인과 같은 값을 쓰고, 순서는 늘 새것 먼저다
 */
export function InboxNotices(props: {
  readonly feed?: NoticeFeed | undefined;
  readonly thread: InboxThread;
}): ReactNode {
  if (props.feed !== undefined) {
    return <NoticeList feed={props.feed} thread={props.thread} />;
  }
  return <OwnFeedNotices thread={props.thread} />;
}

function OwnFeedNotices(props: { readonly thread: InboxThread }): ReactNode {
  const feed = useNoticeFeed();
  return <NoticeList feed={feed} thread={props.thread} />;
}
