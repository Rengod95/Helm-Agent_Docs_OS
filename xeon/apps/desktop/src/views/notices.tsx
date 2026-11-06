import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { Alert, Button, EmptyState, Skeleton, toast } from "@caustic/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLinkPhase, useThread } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { mergeNotices, noticeKindId, type NoticeEntry } from "./notices-model.ts";
import { useGoToThread } from "./thread-link.ts";

// 앱 안 알림(B-08). OS 알림은 플러그인 승인이 없어 하지 않는다. 받은 요청 탭에 목록을 두고,
// 전달된 알림은 토스트로도 보인다(NoticeToasts, App이 한 번 마운트).

type Load = "loading" | "ready" | "error";

/** 전달된 알림을 토스트로 알린다. 연결이 다시 붙으면 구독을 다시 건다 */
export function NoticeToasts(): ReactNode {
  const commands = useCommands();
  const phase = useLinkPhase();
  useEffect(() => {
    if (phase !== "live") return undefined;
    return commands.notices.onDelivered((delivered) => {
      const { notice } = delivered;
      toast({
        tone: notice.kind === "error" ? "danger" : "neutral",
        title: notice.title,
        ...(notice.body === null ? {} : { description: notice.body }),
        ...(notice.kind === "error" ? { duration: 0 } : {}),
      });
    });
  }, [commands, phase]);
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

  const read = useCallback((): void => {
    detach(
      commands.notices.list().then((listed) => {
        if (!listed.ok) {
          setLoad("error");
          return undefined;
        }
        setEntries((now) =>
          mergeNotices(
            now,
            listed.value.notices.map((notice) => ({ notice, threadId: null })),
          ),
        );
        setLoad("ready");
        return undefined;
      }),
      rethrow,
    );
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
            <span className="dim">{t(noticeKindId(notice.kind))}</span>
            <span>{notice.title}</span>
            {notice.body === null ? null : <span className="dim">{notice.body}</span>}
            {threadId === null ? null : <ThreadName threadId={threadId} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
