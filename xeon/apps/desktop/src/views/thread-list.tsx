import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import {
  Button,
  EmptyState,
  Input,
  ListNavigation,
  ListNavigationGroup,
  ListNavigationItem,
  Popover,
  Skeleton,
} from "@caustic/react";
import { memo, useState, type ReactNode } from "react";
import {
  useThreadsStatus,
  useThreadSummaries,
  useUnlistedApprovals,
} from "../state/engine/index.ts";
import { useSelectedThreadId } from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";
import { pickWorkspaceFolder, type FolderPickInvoke } from "./folder-pick.ts";
import { folderLabel, groupByWorkspace } from "./thread-groups.ts";
import { ThreadRowMenu } from "./thread-row-menu.tsx";
import { checkWorkspaceInput, createFailureText, workspaceHint } from "./workspace-model.ts";

const UNTITLED_LABEL =
  "[&_[data-slot=list-navigation-label]]:italic [&_[data-slot=list-navigation-label]]:text-text-tertiary";

/** 행 오른쪽 짧은 글자. 이어서 실행, 닫힘, 승인 수 중 하나(시안: 행 meta는 짧게) */
function metaOf(thread: ThreadSummary): string | undefined {
  if (thread.resumable !== null) return t("desktop.threads.resumableBadge");
  if (thread.status === "closed") return t("desktop.threads.closedBadge");
  if (thread.pendingApprovals > 0) {
    return t("desktop.threads.approvalsBadge", { count: thread.pendingApprovals });
  }
  return undefined;
}

const ThreadRow = memo(function ThreadRow(props: { readonly thread: ThreadSummary }): ReactNode {
  const commands = useCommands();
  const id: ThreadId = props.thread.threadId;
  const selected = useSelectedThreadId() === id;
  const unlisted = useUnlistedApprovals(id);
  const title = props.thread.title ?? t("desktop.threads.untitled");
  return (
    <>
      <ListNavigationItem
        current={selected}
        {...(props.thread.status === "running" ? { status: "running" as const } : {})}
        meta={metaOf(props.thread)}
        title={unlisted > 0 ? t("desktop.threads.unlistedApprovals") : undefined}
        className={props.thread.title === null ? UNTITLED_LABEL : undefined}
        onSelect={() => {
          commands.selectThread(id);
        }}
      >
        {title}
      </ListNavigationItem>
      {/* 행 뒤 높이 0인 칸에 ⋯를 겹친다(caustic 행에 동작 자리가 없다). 보임과 승인 수 비움은 styles.css [data-row-menu] */}
      <li
        data-row-menu=""
        className="pointer-events-none relative -mt-control-sm flex h-control-sm list-none items-center justify-end pe-1"
      >
        <ThreadRowMenu id={id} title={title} status={props.thread.status} bare />
      </li>
    </>
  );
});

/** 다른 폴더(경로를 적거나 고른 폴더)에서 새 대화를 여는 작은 창 */
function OtherFolder(props: {
  readonly folderPick: FolderPickInvoke | undefined;
  readonly creating: boolean;
  readonly onCreate: (path: string | undefined) => void;
  readonly onPickFailed: () => void;
}): ReactNode {
  const [text, setText] = useState("");
  const workspace = checkWorkspaceInput(text);
  const hint = workspaceHint(workspace);
  const folderPick = props.folderPick;
  const pick = async (invoke: FolderPickInvoke): Promise<void> => {
    const picked = await pickWorkspaceFolder(invoke);
    if (!picked.ok) {
      props.onPickFailed();
      return;
    }
    if (picked.value !== undefined) setText(picked.value);
  };
  return (
    <Popover
      size="sm"
      arrow={false}
      side="bottom"
      align="start"
      anchor={
        <Button size="xs" variant="ghost" className="justify-self-start">
          {t("desktop.threads.otherFolder")}
        </Button>
      }
    >
      <div className="grid w-64 gap-2">
        <label className="grid gap-1 text-ui-sm text-text-secondary">
          {t("desktop.threads.workspaceLabel")}
          <Input
            size="sm"
            placeholder="/Users/me/project"
            value={text}
            invalid={hint !== null}
            onValueChange={setText}
          />
        </label>
        {hint === null ? null : <div className="text-ui-sm text-danger-text">{hint}</div>}
        <div className="flex gap-2">
          {folderPick === undefined ? null : (
            <Button
              size="sm"
              variant="outline"

              disabled={props.creating}
              onClick={() => detach(pick(folderPick), rethrow)}
            >
              {t("desktop.workspace.pickFolderButton")}
            </Button>
          )}
          <Button
            size="sm"
            disabled={props.creating || workspace.kind === "invalid"}
            onClick={() => {
              props.onCreate(workspace.kind === "path" ? workspace.path : undefined);
            }}
          >
            {t("desktop.threads.newButton")}
          </Button>
        </div>
      </div>
    </Popover>
  );
}

export function ThreadList(props: {
  /** 폴더 선택 창을 부르는 invoke. 없으면(웹 등) 고르기 단추를 보이지 않는다 */
  readonly folderPick?: FolderPickInvoke | undefined;
}): ReactNode {
  const commands = useCommands();
  const threads = useThreadSummaries();
  const status = useThreadsStatus();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (path: string | undefined): Promise<void> => {
    setCreating(true);
    setError(null);
    const result = await commands.createThread(path);
    setCreating(false);
    if (!result.ok) setError(createFailureText(result.error, path !== undefined));
  };
  const start = (path: string | undefined): void => {
    detach(create(path), rethrow);
  };

  const groups = groupByWorkspace(threads);
  return (
    <div className="grid gap-1">
      <ListNavigation
        aria-label={t("desktop.threads.listLabel")}
        kind="sessions"
        size="sm"
        as="div"
      >
        {groups.map((group) => (
          <ListNavigationGroup
            key={group.workspace ?? ""}
            heading={
              group.workspace === null ? (
                t("desktop.threads.noFolder")
              ) : (
                <span className="font-mono text-mono-sm normal-case" title={group.workspace}>
                  {folderLabel(group.workspace)}
                </span>
              )
            }
            addLabel={
              group.workspace === null
                ? t("desktop.threads.newButton")
                : t("desktop.threads.newIn", { folder: folderLabel(group.workspace) })
            }
            onAdd={() => {
              start(group.workspace ?? undefined);
            }}
          >
            {group.items.map((thread) => (
              <ThreadRow key={thread.threadId} thread={thread} />
            ))}
          </ListNavigationGroup>
        ))}
      </ListNavigation>
      {status === "loading" && threads.length === 0 ? (
        <div
          role="status"
          aria-label={t("desktop.threads.loading")}
          className="grid gap-1.5 px-2 pt-1"
        >
          {[70, 55, 82, 48, 64].map((w) => (
            <Skeleton key={w} className="h-4" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : null}
      {status === "error" ? (
        <EmptyState
          size="sm"
          surface="none"
          title={t("desktop.threads.loadFailed")}
          actions={
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                commands.reloadThreads();
              }}
            >
              {t("desktop.threads.reloadButton")}
            </Button>
          }
        />
      ) : null}
      {status === "ready" && threads.length === 0 ? (
        <EmptyState
          size="sm"
          surface="none"
          title={t("desktop.threads.empty")}
          actions={
            <Button
              size="xs"
              variant="outline"
              disabled={creating}
              onClick={() => {
                start(undefined);
              }}
            >
              {t("desktop.threads.newButton")}
            </Button>
          }
        />
      ) : null}
      <div className="px-1.5">
        <OtherFolder
          folderPick={props.folderPick}
          creating={creating}
          onCreate={start}
          onPickFailed={() => {
            setError(t("desktop.workspace.pickFailed"));
          }}
        />
      </div>
      {error === null ? null : (
        <div role="alert" className="px-2 text-ui-sm text-danger-text">
          {error}
        </div>
      )}
    </div>
  );
}
