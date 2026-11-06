import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { Notice } from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { Alert, Button, EmptyState, Skeleton, toast } from "@caustic/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  useApprovalMirror,
  useLinkPhase,
  useThread,
  useThreadSummaries,
  useTurnFailures,
} from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import {
  mergeNotices,
  noticeKindId,
  noticeResolved,
  noticeTitleViewOf,
  threadBySeqOf,
  noticeToastVisible,
  type NoticeEntry,
} from "./notices-model.ts";
import { turnFailureOf } from "./turn-failure-model.ts";
import { useSelectedThreadId } from "../state/ui/index.ts";
import { useGoToThread } from "./thread-link.ts";

// 앱 안 알림(B-08). OS 알림은 플러그인 승인이 없어 하지 않는다. 받은 요청 탭에 목록을 두고,
// 전달된 알림은 토스트로도 보인다(NoticeToasts, App이 한 번 마운트).

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

/** 알림 제목. 아는 원문은 앱 말투로 바꾸고 모르는 것은 원문 그대로다 */
function noticeTitleText(notice: Notice): string {
  const view = noticeTitleViewOf(notice);
  if (view === null) return notice.title;
  return view.params === undefined ? t(view.id) : t(view.id, view.params);
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
      const view = isTurnFailure && notice.body !== null ? turnFailureOf(notice.body) : null;
      const id = toast({
        tone: notice.kind === "error" ? "danger" : "neutral",
        title:
          view === null
            ? noticeTitleText(notice)
            : view.params === undefined
              ? t(view.text)
              : t(view.text, view.params),
        // 원문은 대화의 오류 줄이 "자세히"로 보인다. 토스트에는 싣지 않는다
        ...(notice.body === null || isTurnFailure ? {} : { description: notice.body }),
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

function ThreadName(props: { readonly threadId: ThreadId }): ReactNode {
  const goTo = useGoToThread();
  const thread = useThread(props.threadId);
  if (thread === undefined) return null;
  const name = thread.title ?? t("desktop.threads.untitled");
  if (goTo === null) return <span className="dim">{name}</span>;
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        goTo(props.threadId);
      }}
    >
      {name}
    </Button>
  );
}

/** 받은 요청 탭의 알림 묶음 */
export function InboxNotices(): ReactNode {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [load, setLoad] = useState<Load>("loading");
  const [entries, setEntries] = useState<readonly NoticeEntry[]>([]);
  const approvals = useApprovalMirror();
  const waitingThreads = new Set(approvals.ids.flatMap((id) => approvals.byId[id]?.threadId ?? []));

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
      setEntries((now) =>
        mergeNotices(
          now,
          listed.value.notices.map((notice) => ({
            notice,
            threadId: threads.get(notice.seq) ?? null,
          })),
        ),
      );
      setLoad("ready");
    };
    detach(run(), rethrow);
  }, [commands]);

  useEffect(() => {
    if (phase !== "live") return undefined;
    read();
    return commands.notices.onDelivered((delivered) => {
      setEntries((now) =>
        mergeNotices(now, [{ notice: delivered.notice, threadId: delivered.threadId }]),
      );
    });
  }, [commands, phase, read]);

  return (
    <section className="grid gap-2" aria-label={t("desktop.notices.label")}>
      <header className="flex items-center gap-2">
        <h2 className="m-0 flex-1 text-title-4">{t("desktop.notices.title")}</h2>
        {entries.length === 0 ? null : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEntries([]);
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
      {load === "loading" && phase === "live" && entries.length === 0 ? (
        <Skeleton aria-label={t("desktop.notices.loading")} />
      ) : null}
      {load === "error" ? (
        <Alert tone="danger" size="sm" radius="md" role="alert">
          {t("desktop.notices.failed")}{" "}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLoad("loading");
              read();
            }}
          >
            {t("desktop.notices.retry")}
          </Button>
        </Alert>
      ) : null}
      {load === "ready" && entries.length === 0 ? (
        <EmptyState size="sm" surface="none" title={t("desktop.notices.empty")} />
      ) : null}
      <ul className="m-0 grid list-none gap-2 p-0">
        {entries.map(({ notice, threadId }) => (
          <li key={notice.seq} className="grid gap-0.5">
            <span className="dim">
              {noticeResolved({ notice, threadId }, waitingThreads)
                ? t("desktop.notices.kind.resolved")
                : t(noticeKindId(notice.kind))}
            </span>
            <span>{noticeTitleText(notice)}</span>
            {notice.body === null ? null : <span className="dim">{notice.body}</span>}
            {threadId === null ? null : <ThreadName threadId={threadId} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
