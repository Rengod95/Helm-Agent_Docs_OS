import { t } from "@fresnel/client/i18n";
import { Popover } from "@caustic/react";
import { Folder, GitBranch, Globe, Laptop, Plug, Terminal } from "@caustic/react/icons";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { HostClientView } from "@fresnel/contracts/wire";
import { useEffect, useState, type ReactNode } from "react";
import { useLinkPhase, useOpenThread, useThreadSummaries } from "../state/engine/index.ts";
import { useEngineTarget } from "../state/ui/index.ts";
import { transportMessageOf } from "./pages/connection/connection-text.ts";
import { useCommands } from "./commands.ts";
import { useFolderPick } from "./folder-pick-context.ts";
import { useStartNewThread } from "./new-thread-flow.ts";
import { recentWorkspacesOf } from "./new-thread-model.ts";
import { RecentRow } from "./new-thread-where.tsx";
import { contextItemsOf, type ContextClient, type ContextItem } from "./thread-context-model.ts";

// 대화 맥락 줄(DP-71): 입력창 바로 위의 얇은 한 줄. 작업 폴더, 저장소·브랜치(있을 때만), 연결(이 컴퓨터·SSH·원격), 붙은 클라이언트.
// 보일 것은 `thread-context-model.ts`가 정한다. 폴더 이름만 누를 수 있고, 최근 폴더 목록을 열어 다른 폴더의 새 대화로 보낸다.

const ICON = "size-3.5 shrink-0 text-text-tertiary";

function clientText(client: ContextClient): string {
  return client.name ?? t(transportMessageOf(client.transport));
}

function Sep(): ReactNode {
  return (
    <span aria-hidden className="text-text-tertiary">
      ·
    </span>
  );
}

function FolderItem(props: {
  readonly name: string;
  readonly path: string;
  readonly tail: string | null;
}): ReactNode {
  const folderPick = useFolderPick();
  const startThread = useStartNewThread(folderPick ?? undefined);
  const recent = recentWorkspacesOf(useThreadSummaries()).filter(
    (item) => item.path !== props.path,
  );
  const [open, setOpen] = useState(false);
  return (
    <Popover
      trigger="click"
      size="sm"
      side="top"
      align="start"
      className="craft-glass"
      open={open}
      onOpenChange={setOpen}
      anchor={
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-ui text-text-primary outline-none hover:bg-neutral-hover focus-visible:focus-ring"
          title={t("desktop.threadContext.folder.path", { path: props.path })}
          aria-label={`${t("desktop.threadContext.folder.change")}: ${props.name}`}
        >
          <Folder className={ICON} aria-hidden />
          <span className="truncate">{props.name}</span>
          {props.tail === null ? null : (
            <span className="truncate font-mono text-ui-xs text-text-tertiary">{props.tail}</span>
          )}
        </button>
      }
    >
      <div className="grid w-72 gap-px">
        {recent.map((item) => (
          <RecentRow
            key={item.path}
            item={item}
            disabled={false}
            onPick={(path) => {
              setOpen(false);
              detach(startThread(path), rethrow);
            }}
          />
        ))}
        {folderPick === null ? null : (
          <button
            type="button"
            className="rounded-md px-2 py-1.5 text-left text-ui text-text-primary outline-none hover:bg-neutral-hover focus-visible:focus-ring"
            onClick={() => {
              setOpen(false);
              detach(startThread(), rethrow);
            }}
          >
            {t("desktop.emptyThread.where.open")}
          </button>
        )}
      </div>
    </Popover>
  );
}

function HostItem(props: {
  readonly host: "local" | "ssh" | "web";
  readonly name: string | null;
}): ReactNode {
  const { host, name } = props;
  const text =
    host === "local"
      ? t("desktop.threadContext.host.local")
      : host === "ssh"
        ? t("desktop.threadContext.host.ssh", { name: name ?? "" })
        : name === null
          ? t("desktop.threadContext.host.webAnon")
          : t("desktop.threadContext.host.web", { name });
  const Icon = host === "local" ? Laptop : host === "ssh" ? Terminal : Globe;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 px-1">
      <Icon className={ICON} aria-hidden />
      <span className="truncate">{text}</span>
    </span>
  );
}

function ItemView(props: { readonly item: ContextItem }): ReactNode {
  const { item } = props;
  switch (item.kind) {
    case "folder":
      return <FolderItem name={item.name} path={item.path} tail={item.tail} />;
    case "project":
      return (
        <span className="inline-flex min-w-0 items-center gap-1.5 px-1">
          <GitBranch className={ICON} aria-hidden />
          <span className="truncate">
            {t("desktop.threadContext.project", { repo: item.repo })}
          </span>
          {item.branch === null ? null : (
            <span className="truncate font-mono text-ui-xs text-text-tertiary">{item.branch}</span>
          )}
        </span>
      );
    case "host":
      return <HostItem host={item.host} name={item.name} />;
    case "clients": {
      const names = item.clients.map(clientText).join(", ");
      return (
        <span
          className="inline-flex min-w-0 items-center gap-1.5 px-1"
          title={t("desktop.threadContext.clients", { names })}
        >
          <Plug className={ICON} aria-hidden />
          <span className="truncate">{names}</span>
        </span>
      );
    }
    default:
      return assertNever(item, "ContextItem");
  }
}

/** 붙은 클라이언트 목록. 연결이 살아날 때 한 번 읽고, 못 읽으면(구형 엔진·끊김) 비워 둔다 */
function useHostClients(): readonly HostClientView[] {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [clients, setClients] = useState<readonly HostClientView[]>([]);
  useEffect(() => {
    let stale = false;
    if (phase !== "live") return undefined;
    detach(
      commands.connection.clients().then((result) => {
        if (!stale) setClients(result.ok ? result.value : []);
        return undefined;
      }),
      rethrow,
    );
    return () => {
      stale = true;
    };
  }, [commands, phase]);
  return clients;
}

export function ThreadContextBar(): ReactNode {
  const workspace = useOpenThread()?.workspace ?? null;
  const target = useEngineTarget();
  const clients = useHostClients();
  const items = contextItemsOf({ workspace, target, clients, git: null });
  if (items.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={t("desktop.threadContext.label")}
      className="mx-auto flex w-full max-w-184 min-w-0 items-center gap-1 px-3 pb-1 text-ui text-text-secondary"
    >
      {items.map((item, index) => (
        <span key={item.kind} className="inline-flex min-w-0 items-center gap-1">
          {index === 0 ? null : <Sep />}
          <ItemView item={item} />
        </span>
      ))}
    </div>
  );
}
