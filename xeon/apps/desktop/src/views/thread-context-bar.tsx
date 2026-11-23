import { Menu, MenuHeading, MenuItem, MenuSeparator, Tooltip } from "@caustic/react";
import {
  Check,
  ChevronDown,
  Folder,
  FolderOpen,
  GitBranch,
  Globe,
  Laptop,
  Monitor,
  Terminal,
  TriangleAlert,
} from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { HostClientView } from "@fresnel/contracts/wire";
import { useEffect, useState, type ReactNode } from "react";
import {
  useLinkPhase,
  useOpenThreadId,
  useThread,
  useThreadSummaries,
} from "../state/engine/index.ts";
import { useEngineTarget } from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";
import { useDesktopShell } from "./desktop-shell-context.ts";
import { useFolderPick } from "./folder-pick-context.ts";
import { useStartNewThread } from "./new-thread-flow.ts";
import { recentWorkspacesOf } from "./new-thread-model.ts";
import { transportMessageOf } from "./pages/connection/connection-text.ts";
import { readShellCapabilities } from "./shell-capabilities.ts";
import {
  contextLineOf,
  folderNameOf,
  hostOf,
  pathTailOf,
  type ContextClient,
  type ContextFolder,
  type ContextGit,
  type ContextHost,
  type ContextLine,
} from "./thread-context-model.ts";

// 대화 맥락 줄(DP-71). 대화 화면에서 입력창 바로 위, 입력창과 같은 열에 붙는 면 없는 한 줄이다.
// 왼쪽은 작업 맥락(폴더 ⌄, 저장소·브랜치), 오른쪽은 연결(이 컴퓨터·SSH·원격·웹, 다른 연결 수). 무엇을 보일지는 thread-context-model.ts가 정한다.
// 폴더 항목만 누를 수 있고, 위로 여는 메뉴에서 다른 폴더의 새 대화로 간다(엔진에 대화의 폴더를 바꾸는 명령이 없다).
// 폴더가 없어졌으면(`workspace.status`) 폴더 항목이 경고 모양으로 바뀐다. 예전 작업 폴더 띠(work-folder-band)를 대신한다.

const ICON = "size-3.5 shrink-0";

/** 웹 셸이면 브라우저 주소의 호스트, 데스크톱이거나 모르면 null */
function useWebHost(): string | null {
  const shell = useDesktopShell();
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => {
    if (shell === null) return undefined;
    let stale = false;
    detach(
      readShellCapabilities((command) => shell.invoke(command)).then((found) => {
        if (!stale && found.kind === "web") setHost(globalThis.location.hostname);
        return undefined;
      }),
      rethrow,
    );
    return () => {
      stale = true;
    };
  }, [shell]);
  return host;
}

/** 엔진이 도는 곳. 새 대화 화면의 폴더 고르기도 같은 값을 보인다 */
export function useContextHost(): ContextHost {
  return hostOf(useEngineTarget(), useWebHost());
}

/** 같은 엔진에 붙은 연결 목록. 연결이 살아날 때 다시 묻고, 못 읽으면 빈 목록이다(항목을 숨긴다) */
function useHostClients(): readonly HostClientView[] {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [clients, setClients] = useState<readonly HostClientView[]>([]);
  useEffect(() => {
    if (phase !== "live") return undefined;
    let stale = false;
    detach(
      commands.connection.clients().then((read) => {
        if (!stale) setClients(read.ok ? read.value : []);
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

/** 이 대화의 작업 폴더가 없다고 확인된 경로. 다른 폴더의 확인 결과는 쓰지 않는다 */
function useFolderMissing(workspace: string | null): boolean {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [missing, setMissing] = useState<string | null>(null);
  useEffect(() => {
    if (phase !== "live" || workspace === null) return undefined;
    let stale = false;
    detach(
      commands.workspace.status(workspace).then((status) => {
        if (stale) return undefined;
        // 있거나, 확인하지 못했으면(구형 host, 읽기 실패) 경고하지 않는다
        setMissing(status.ok && !status.value.exists ? workspace : null);
        return undefined;
      }),
      rethrow,
    );
    return () => {
      stale = true;
    };
  }, [commands, phase, workspace]);
  return workspace !== null && missing === workspace;
}

export function ThreadContextBar(): ReactNode {
  const threadId = useOpenThreadId();
  if (threadId === null) return null;
  return <ThreadContextBarFor key={threadId} threadId={threadId} />;
}

function ThreadContextBarFor(props: { readonly threadId: ThreadId }): ReactNode {
  const workspace = useThread(props.threadId)?.workspace ?? null;
  const missing = useFolderMissing(workspace);
  const target = useEngineTarget();
  const webHost = useWebHost();
  const clients = useHostClients();
  // 저장소 이름과 브랜치를 주는 엔진 명령이 아직 없다. 생기면 여기서 채운다(없으면 항목이 숨는다)
  const git: ContextGit | null = null;
  const line = contextLineOf({
    workspace,
    threadId: props.threadId,
    missing,
    target,
    webHost,
    clients,
    git,
  });
  if (line === null) return null;
  return <ThreadContextBarView line={line} interactive />;
}

/** 그림만. 시험은 모델 결과를 바로 넣는다. `interactive`면 폴더 단추가 메뉴를 연다(문맥이 필요하다) */
export function ThreadContextBarView(props: {
  readonly line: ContextLine;
  readonly interactive?: boolean;
}): ReactNode {
  const { line } = props;
  return (
    <div
      role="group"
      aria-label={t("desktop.threadContext.label")}
      data-slot="thread-context-bar"
      className="mb-1.5 flex h-7 min-w-0 items-center justify-between gap-4 px-3"
    >
      <div className="flex min-w-0 items-center gap-3">
        <FolderItem folder={line.folder} interactive={props.interactive === true} />
        {line.git === null ? null : <GitItem git={line.git} />}
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-3 text-text-tertiary">
        <HostItem host={line.host} />
        {line.clients.length === 0 ? null : <ClientsItem clients={line.clients} />}
      </div>
    </div>
  );
}

function FolderItem(props: {
  readonly folder: ContextFolder;
  readonly interactive: boolean;
}): ReactNode {
  const { folder } = props;
  const shownName = folder.isDefault ? t("desktop.threadContext.folder.none") : folder.name;
  const anchor = (
    <button
      type="button"
      data-missing={folder.missing ? "" : undefined}
      title={folder.path}
      aria-label={t("desktop.threadContext.folder.change", { name: shownName })}
      className={[
        "inline-flex h-6 min-w-0 items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-ui outline-none",
        "hover:bg-neutral-hover focus-visible:focus-ring data-[state=open]:bg-neutral-hover",
        folder.missing
          ? "text-warning-text"
          : "text-text-secondary hover:text-text-primary data-[state=open]:text-text-primary",
      ].join(" ")}
    >
      {folder.missing ? <TriangleAlert className={ICON} /> : <Folder className={ICON} />}
      <span className="truncate">{shownName}</span>
      {folder.missing ? (
        <span className="shrink-0">{t("desktop.threadContext.folder.missing")}</span>
      ) : null}
      <ChevronDown className="size-3 shrink-0 opacity-70" />
    </button>
  );
  return props.interactive ? <FolderMenu path={folder.path} anchor={anchor} /> : anchor;
}

function FolderMenu(props: { readonly path: string; readonly anchor: ReactNode }): ReactNode {
  const folderPick = useFolderPick();
  const startThread = useStartNewThread(folderPick ?? undefined);
  const recent = recentWorkspacesOf(useThreadSummaries());
  const start = (path: string | undefined): void => {
    detach(
      startThread(path).then(() => undefined),
      rethrow,
    );
  };
  return (
    <Menu trigger={props.anchor} side="top" align="start" size="sm" className="min-w-64 max-w-96">
      <MenuHeading>{t("desktop.threadContext.folder.menuHeading")}</MenuHeading>
      {recent.map((item) => {
        const current = item.path === props.path;
        const tail = pathTailOf(item.path);
        return (
          <MenuItem
            key={item.path}
            icon={current ? <Check /> : <Folder />}
            title={item.path}
            end={
              tail === null ? undefined : (
                <span className="max-w-40 truncate font-mono text-footnote text-text-tertiary">
                  {tail}
                </span>
              )
            }
            onSelect={() => {
              start(item.path);
            }}
          >
            <span className="truncate">{folderNameOf(item.path)}</span>
          </MenuItem>
        );
      })}
      {folderPick === null ? null : (
        <>
          {recent.length === 0 ? null : <MenuSeparator />}
          <MenuItem
            icon={<FolderOpen />}
            onSelect={() => {
              start(undefined);
            }}
          >
            {t("desktop.threadContext.folder.openOther")}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function GitItem(props: { readonly git: ContextGit }): ReactNode {
  const { git } = props;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-text-tertiary">
      <GitBranch className={ICON} />
      <span className="truncate text-ui">{git.repo}</span>
      {git.branch === null ? null : (
        <span className="truncate font-mono text-footnote">{git.branch}</span>
      )}
    </span>
  );
}

function hostText(host: ContextHost): string {
  switch (host.kind) {
    case "local":
      return t("desktop.threadContext.host.local");
    case "ssh":
      return host.name ?? t("desktop.threadContext.host.ssh");
    case "remote":
      return host.name ?? t("desktop.threadContext.host.remote");
    case "web":
      return host.name ?? t("desktop.threadContext.host.web");
    default:
      return assertNever(host.kind, "ContextHostKind");
  }
}

function hostTip(host: ContextHost): string {
  switch (host.kind) {
    case "local":
      return t("desktop.threadContext.host.localTip");
    case "ssh":
      return t("desktop.threadContext.host.sshTip", { address: host.detail ?? hostText(host) });
    case "remote":
      return t("desktop.threadContext.host.remoteTip", { address: host.detail ?? hostText(host) });
    case "web":
      return t("desktop.threadContext.host.webTip", { host: hostText(host) });
    default:
      return assertNever(host.kind, "ContextHostKind");
  }
}

function HostIcon(props: { readonly kind: ContextHost["kind"] }): ReactNode {
  switch (props.kind) {
    case "local":
      return <Laptop className={ICON} />;
    case "ssh":
      return <Terminal className={ICON} />;
    case "remote":
    case "web":
      return <Globe className={ICON} />;
    default:
      return assertNever(props.kind, "ContextHostKind");
  }
}

export function HostItem(props: { readonly host: ContextHost }): ReactNode {
  return (
    <Tooltip content={hostTip(props.host)} side="top" align="end" delayDuration={500}>
      <span
        tabIndex={0}
        data-host={props.host.kind}
        className="inline-flex min-w-0 items-center gap-1.5 rounded-md text-ui outline-none focus-visible:focus-ring"
      >
        <HostIcon kind={props.host.kind} />
        <span className="max-w-48 truncate">{hostText(props.host)}</span>
      </span>
    </Tooltip>
  );
}

function clientText(client: ContextClient): string {
  return client.name ?? t(transportMessageOf(client.transport));
}

function ClientsItem(props: { readonly clients: readonly ContextClient[] }): ReactNode {
  const names = props.clients.map(clientText).join(", ");
  return (
    <Tooltip
      content={t("desktop.threadContext.clients.tip", { names })}
      side="top"
      align="end"
      delayDuration={500}
    >
      <span
        tabIndex={0}
        className="inline-flex items-center gap-1.5 rounded-md text-ui outline-none focus-visible:focus-ring"
      >
        <Monitor className={ICON} />
        {t("desktop.threadContext.clients.count", { count: props.clients.length })}
      </span>
    </Tooltip>
  );
}
