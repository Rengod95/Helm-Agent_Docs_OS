import { InboxArt } from "./illustrations/index.tsx";
import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { Notice } from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogAction,
  DialogClose,
  EmptyState,
  IconButton,
  Popover,
  Skeleton,
  toast,
} from "@caustic/react";
import { Info, MessageSquare, TriangleAlert } from "@caustic/react/icons";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  useApprovalMirror,
  useLinkPhase,
  useThread,
  useThreadSummaries,
  useTurnFailures,
} from "../state/engine/index.ts";
import { useClockNow } from "./approval-card/clock.ts";
import { useCommands } from "./commands.ts";
import { arrangeInboxNotices, type InboxSort, type InboxThread } from "./inbox-model.ts";
import {
  clearedNotices,
  highestSeqOf,
  mergeNotices,
  noticeAgeViewOf,
  noticeBodyViewOf,
  noticeKindId,
  noticeResolved,
  noticeShownAtOf,
  noticeToneOf,
  noticesAfter,
  noticeTitleViewOf,
  noticeToastVisible,
  threadBySeqOf,
  type NoticeAction,
  type NoticeBodyView,
  type NoticeEntry,
} from "./notices-model.ts";
import { useSelectedThreadId } from "../state/ui/index.ts";
import { useGoToThread } from "./thread-link.ts";

// 앱 안 알림(B-08). OS 알림은 플러그인 승인이 없어 하지 않는다. 받은 요청 탭에 목록을 두고,
// 전달된 알림은 토스트로도 보인다(NoticeToasts, App이 한 번 마운트).
// 목록을 지우면 그 seq까지를 모듈의 경계(`clearedNotices`)에 남긴다. 화면을 떠났다 와도, 다시 읽어도 지운 알림은 돌아오지 않는다.

type Load = "loading" | "ready" | "error";

/** 턴 실패 토스트가 스스로 닫히는 때(ms). 오류 토스트는 caustic이 자동으로 닫지 않아 이 앱이 닫는다 */
const ERROR_TOAST_MS = 20_000;

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
  // 지금 보는 대화의 실패는 대화 끝의 오류 줄이 같은 문장과 단추를 보인다. 토스트는 내지 않는다
  const selected = useRef<ThreadId | null>(null);
  const selectedId = useSelectedThreadId();
  useEffect(() => {
    selected.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    if (phase !== "live") return undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const off = commands.notices.onDelivered((delivered) => {
      const { notice } = delivered;
      if (!noticeToastVisible(notice)) return;
      const isTurnFailure = notice.kind === "error" && notice.sourceType === "turn.completed";
      if (isTurnFailure && delivered.threadId !== null && delivered.threadId === selected.current) {
        return;
      }
      const view = notice.body === null ? null : noticeBodyViewOf(notice);
      const sentence = view === null ? null : bodyTextOf(view);
      const id = toast({
        tone: notice.kind === "error" ? "danger" : "neutral",
        title: isTurnFailure && sentence !== null ? sentence : noticeTitleText(notice),
        // 턴 실패의 원문은 대화의 오류 줄이 "자세히"로 보인다. 토스트에는 싣지 않는다
        ...(sentence === null || isTurnFailure ? {} : { description: sentence }),
        ...(notice.kind === "error"
          ? { dismissLabel: t("desktop.turnFailure.toast.dismiss") }
          : {}),
      });
      if (notice.kind !== "error") return;
      if (isTurnFailure && delivered.threadId !== null) {
        open.current.byId.set(id, delivered.threadId);
      }
      timers.add(setTimeout(() => toast.dismiss(id), ERROR_TOAST_MS));
    });
    return () => {
      off();
      for (const timer of timers) clearTimeout(timer);
    };
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

/** 실패 본문의 단추 글. 대화의 오류 줄과 같은 문장을 쓴다 */
const ACTION_TEXT: Readonly<Record<NoticeAction, MessageId>> = {
  "reregister-key": "desktop.turnFailure.action.reregisterKey",
  "open-providers": "desktop.turnFailure.action.openProviders",
};

/** 단추가 여는 설정 탭. 키 다시 등록은 시크릿, 제공자 설정 열기는 제공자 탭이다 */
function settingsTabOf(action: NoticeAction): "secrets" | "providers" {
  return action === "reregister-key" ? "secrets" : "providers";
}

/** 정보 아이콘 뒤 "자세히"의 원문. 대화의 오류 줄과 같은 팝오버다 */
function Detail(props: { readonly text: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const clipped =
    props.text.length > DETAIL_MAX ? `${props.text.slice(0, DETAIL_MAX)}…` : props.text;
  return (
    <Popover
      trigger="click"
      size="xs"
      className="craft-glass"
      open={open}
      onOpenChange={setOpen}
      anchor={
        <IconButton label={t("desktop.turnFailure.detail.label")} size="xs" variant="ghost">
          <Info />
        </IconButton>
      }
    >
      <div className="max-w-96 whitespace-pre-wrap [overflow-wrap:anywhere]">{clipped}</div>
    </Popover>
  );
}

/** 알림 본문. 실패는 위험 글 한 줄과 "자세히"와 단추, 대화 없는 예약 실패는 사유 글 한 줄, 평문은 원문 한 줄이다 */
function NoticeBody(props: { readonly view: NoticeBodyView }): ReactNode {
  const commands = useCommands();
  const { view } = props;
  if (view.kind === "plain") {
    return <span className="dim [overflow-wrap:anywhere]">{view.text}</span>;
  }
  if (view.kind === "scheduleReason") {
    return <span className="text-danger-text [overflow-wrap:anywhere]">{bodyTextOf(view)}</span>;
  }
  const { action } = view;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0 text-danger-text [overflow-wrap:anywhere]">{bodyTextOf(view)}</span>
      {view.detail === null ? null : <Detail text={view.detail} />}
      {action === null ? null : (
        <Button
          size="xs"
          variant="solid"
          onClick={() => {
            commands.requestSettingsJump({ tab: settingsTabOf(action), key: null });
          }}
        >
          {t(ACTION_TEXT[action])}
        </Button>
      )}
    </span>
  );
}

/** 대화 이름. 열 수 있으면 본문 글처럼 보이는 링크이고, 예약에서 만든 대화면 앞에 "예약 ·"을 붙인다 */
const LINK_CLASS =
  "cursor-pointer border-0 bg-transparent p-0 text-start font-ui text-text-link no-underline underline-offset-2 outline-none hover:underline focus-visible:shadow-focus";

/** 출처 줄의 틀: 대화 아이콘과 이름. 이름이 없으면 줄 자체를 그리지 않는다 */
function SourceFrame(props: { readonly children: ReactNode }): ReactNode {
  return (
    <div
      role="group"
      aria-label={t("desktop.notices.source")}
      className="flex min-w-0 items-center gap-1.5 border-t border-border-subtle pt-1.5 text-ui"
    >
      <MessageSquare aria-hidden className="size-icon-sm shrink-0 text-text-tertiary" />
      {props.children}
    </div>
  );
}

function ThreadName(props: { readonly threadId: ThreadId }): ReactNode {
  const goTo = useGoToThread();
  const thread = useThread(props.threadId);
  if (thread === undefined) return null;
  const name = thread.title ?? t("desktop.threads.untitled");
  const tag =
    thread.origin?.kind === "schedule" ? (
      <span className="dim">{`${t("desktop.notices.origin.schedule")} · `}</span>
    ) : null;
  if (goTo === null) {
    return (
      <SourceFrame>
        <span className="dim">
          {tag}
          {name}
        </span>
      </SourceFrame>
    );
  }
  return (
    <SourceFrame>
      <span className="flex min-w-0 flex-wrap items-baseline">
        {tag}
        <button
          type="button"
          className={LINK_CLASS}
          onClick={() => {
            goTo(props.threadId);
          }}
        >
          {name}
        </button>
      </span>
    </SourceFrame>
  );
}

/** 대화 없는 알림의 출처. 예약이 대화를 열기 전에 실패한 알림이면 "예약"이고, 대화 이름 링크는 없다 */
function ThreadlessOrigin(props: { readonly notice: Notice }): ReactNode {
  if (props.notice.sourceType !== "schedule.run_finished") return null;
  return (
    <SourceFrame>
      <span className="dim">{t("desktop.notices.origin.schedule")}</span>
    </SourceFrame>
  );
}

function NoticeRow(props: {
  readonly entry: NoticeEntry;
  readonly waiting: ReadonlySet<string>;
  readonly now: number;
}): ReactNode {
  const { notice, threadId } = props.entry;
  const failed = notice.kind === "error";
  const resolved = noticeResolved(props.entry, props.waiting);
  const kind = resolved ? t("desktop.notices.kind.resolved") : t(noticeKindId(notice.kind));
  const shownAt = noticeShownAtOf(props.entry);
  const age = noticeAgeViewOf(props.now, shownAt);
  const body = noticeBodyViewOf(notice);
  return (
    // 한 건이 한 카드다. 위에서 아래로: 상태 배지와 끝난 시각 → 무슨 일(제목) → 내용 → 어느 대화에서(눌러서 이동)
    <li className="grid gap-1.5 rounded-lg border border-border-subtle bg-surface-raised p-3">
      <div className="flex items-center gap-2">
        <Chip
          size="xs"
          variant="soft"
          tone={noticeToneOf(notice.kind, resolved)}
          icon={failed ? <TriangleAlert aria-hidden /> : undefined}
        >
          {kind}
        </Chip>
        <time
          className="ms-auto text-ui-xs tabular-nums text-text-tertiary"
          dateTime={new Date(shownAt).toISOString()}
          title={new Date(shownAt).toLocaleString()}
        >
          {t(age.id, age.params)}
        </time>
      </div>
      <span className="text-ui-strong text-text-primary [overflow-wrap:anywhere]">
        {noticeTitleText(notice)}
      </span>
      {body === null ? null : <NoticeBody view={body} />}
      {threadId === null ? (
        <ThreadlessOrigin notice={notice} />
      ) : (
        <ThreadName threadId={threadId} />
      )}
    </li>
  );
}

/** 알림 묶음을 읽고 지우는 상태. 받은 요청 화면은 한 번 만들어 `InboxNotices`에 넘긴다(대화 셀렉트가 같은 목록을 본다) */
export interface NoticeFeed {
  readonly load: Load;
  readonly entries: readonly NoticeEntry[];
  readonly retry: () => void;
  readonly clear: () => void;
}

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
      const listed = await commands.notices.list();
      if (!listed.ok) {
        setLoad("error");
        return;
      }
      const scoped = await Promise.all(
        recentIds.current.map(async (threadId) => {
          const got = await commands.notices.list(threadId);
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
        ...(listed.value.threadless ?? []).map((notice) => ({ notice, threadId: null })),
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

function NoticeList(props: {
  readonly feed: NoticeFeed;
  readonly thread: InboxThread;
  readonly sort: InboxSort;
}): ReactNode {
  const { feed } = props;
  const phase = useLinkPhase();
  const approvals = useApprovalMirror();
  const waiting = new Set(approvals.ids.flatMap((id) => approvals.byId[id]?.threadId ?? []));
  const now = useClockNow();
  const [confirming, setConfirming] = useState(false);
  const shown = arrangeInboxNotices(feed.entries, { thread: props.thread, sort: props.sort });
  return (
    <section className="grid gap-2" aria-label={t("desktop.notices.label")}>
      <header className="flex items-center gap-2">
        <h2 className="m-0 flex-1 text-title-4">{t("desktop.notices.title")}</h2>
        {feed.entries.length === 0 ? null : (
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
        <Skeleton aria-label={t("desktop.notices.loading")} />
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
      {feed.load === "ready" && shown.length === 0 ? (
        <EmptyState
          media={<InboxArt />}
          size="sm"
          surface="none"
          title={t("desktop.notices.empty")}
        />
      ) : null}
      <ul className="m-0 grid list-none gap-3 p-0">
        {shown.map((entry) => (
          <NoticeRow key={entry.notice.seq} entry={entry} waiting={waiting} now={now} />
        ))}
      </ul>
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
 * 거르기와 정렬은 승인과 같은 값을 쓴다
 */
export function InboxNotices(props: {
  readonly feed?: NoticeFeed | undefined;
  readonly thread: InboxThread;
  readonly sort: InboxSort;
}): ReactNode {
  if (props.feed !== undefined) {
    return <NoticeList feed={props.feed} thread={props.thread} sort={props.sort} />;
  }
  return <OwnFeedNotices thread={props.thread} sort={props.sort} />;
}

function OwnFeedNotices(props: {
  readonly thread: InboxThread;
  readonly sort: InboxSort;
}): ReactNode {
  const feed = useNoticeFeed();
  return <NoticeList feed={feed} thread={props.thread} sort={props.sort} />;
}
