import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  ListNavigation,
  ListNavigationGroup,
  ListNavigationItem,
  Skeleton,
} from "@caustic/react";
import { Folder, FolderOpen, RotateCcw } from "@caustic/react/icons";
import { memo, useState, type ReactNode } from "react";
import {
  useThreadsStatus,
  useThreadSummaries,
  useThreadApprovals,
  useUnlistedApprovals,
} from "../state/engine/index.ts";
import { useShellActions } from "../state/shell/index.ts";
import { useScreen, useSelectedThreadId } from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";
import { pickWorkspaceFolder, type FolderPickInvoke } from "./folder-pick.ts";
import { useStartNewThread } from "./new-thread-flow.ts";
import { recentWorkspacesOf, type RecentWorkspace } from "./new-thread-model.ts";
import { rowResumable } from "./resume-band-model.ts";
import { folderLabel, sidebarGroupsOf } from "./thread-groups.ts";
import { rowOpensChat } from "./thread-nav-model.ts";
import { ThreadRowMenu } from "./thread-row-menu.tsx";
import { checkWorkspaceInput, createFailureText, workspaceHint } from "./workspace-model.ts";

/** 대화 상자가 닫히며 초점을 되돌리는 시간(ms)보다 넉넉히 */
const DIALOG_CLOSE_MS = 300;

/**
 * 하위 대화 행은 부모보다 한 칸 들여 쓴다. caustic 행은 `w-full`이라 왼쪽 여백만 더하면 그만큼 오른쪽으로 넘쳐 끝 배지("하위")가
 * 잘린다. 폭을 `w-auto`로 풀고 여백을 뺀 폭 안에 가둬 제목이 줄고 배지는 그대로 보이게 한다
 */
export const CHILD_ROW = "ms-4 w-auto max-w-[calc(100%-1rem)]";

const UNTITLED_LABEL =
  "[&_[data-slot=list-navigation-label]]:italic [&_[data-slot=list-navigation-label]]:text-text-tertiary";

/** 긴 제목이 열을 넓히지 않게 목록·그룹·행의 격자 열을 minmax(0,1fr)로 묶는다(말줄임은 caustic 라벨의 truncate가 한다) */
const LIST_COLUMN =
  "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1 [&_ul]:grid-cols-[minmax(0,1fr)] [&_[data-slot=list-navigation-item]]:min-w-0 [&_[data-slot=list-navigation-item]]:grid-cols-[minmax(0,1fr)]";

/** 행 오른쪽 짧은 글자. 이어서 실행, 닫힘, 승인 수 중 하나(시안: 행 meta는 짧게) */
function metaOf(thread: ThreadSummary, approvals: number, child: boolean): ReactNode {
  // 이어서 실행은 아이콘과 글(시안 threadMeta의 RotateCcw + 이어서 실행)
  if (rowResumable(thread, approvals)) {
    return (
      <span className="inline-flex items-center gap-1">
        <RotateCcw aria-hidden className="size-icon-xs" />
        {t("desktop.threads.resumableBadge")}
      </span>
    );
  }
  if (thread.status === "closed") return t("desktop.threads.closedBadge");
  if (approvals > 0) {
    return t("desktop.threads.approvalsBadge", { count: approvals });
  }
  if (child) return t("desktop.threads.subBadge");
  // 분기한 대화는 원본과 제목이 같아 구분이 안 된다. 다른 표식이 없을 때 "분기" 표식을 보인다
  return thread.forkedFrom === null ? undefined : t("desktop.threads.forkedBadge");
}

const ThreadRow = memo(function ThreadRow(props: {
  readonly thread: ThreadSummary;
  /** 하위 에이전트가 만든 자식 대화: 부모 아래 들여 쓴 행 */
  readonly child: boolean;
}): ReactNode {
  const commands = useCommands();
  const shell = useShellActions();
  const screen = useScreen();
  const id: ThreadId = props.thread.threadId;
  const selected = useSelectedThreadId() === id;
  const unlisted = useUnlistedApprovals(id);
  const approvals = useThreadApprovals(id);
  const title = props.thread.title ?? t("desktop.threads.untitled");
  return (
    <>
      <ListNavigationItem
        current={selected}
        {...(props.thread.status === "running"
          ? {
              status: "running" as const,
              statusLabels: { running: t("desktop.threads.status.running") },
            }
          : {})}
        meta={metaOf(props.thread, approvals, props.child)}
        title={unlisted > 0 ? `${title}\n${t("desktop.threads.unlistedApprovals")}` : title}
        className={
          [props.thread.title === null ? UNTITLED_LABEL : "", props.child ? CHILD_ROW : ""]
            .filter((c) => c !== "")
            .join(" ") || undefined
        }
        onSelect={() => {
          // 설정이나 받은 요청 같은 전체 쪽이 열려 있으면 그 대화 화면으로 간다(rtE R-5)
          const model = shell.snapshot();
          if (
            rowOpensChat({
              screen,
              area: model.area,
              chatPlaceScreen: model.places.chat.screen,
            })
          ) {
            if (model.area !== "chat") shell.switchArea("chat");
            commands.showScreen("chat");
            if (model.places.chat.screen !== "chat")
              shell.updatePlace({ screen: "chat", scroll: 0 });
          }
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

/** 다른 폴더(경로를 적거나 고른 폴더)에서 새 대화를 여는 대화 상자(시안 O-07). 만들면 닫힌다 */
function OtherFolder(props: {
  readonly folderPick: FolderPickInvoke | undefined;
  readonly creating: boolean;
  readonly recent: readonly RecentWorkspace[];
  readonly onCreate: (path: string | null) => void;
  readonly onPickFailed: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pickFailed, setPickFailed] = useState(false);
  const workspace = checkWorkspaceInput(text);
  const hint = workspaceHint(workspace);
  const folderPick = props.folderPick;
  const pick = async (invoke: FolderPickInvoke): Promise<void> => {
    const picked = await pickWorkspaceFolder(invoke);
    if (!picked.ok) {
      setPickFailed(true);
      props.onPickFailed();
      return;
    }
    if (picked.value !== undefined) setText(picked.value);
  };
  // 대화 상자를 닫고 만든다. 만들지 못한 까닭은 목록 아래 줄에 보인다
  const create = (): void => {
    if (props.creating || workspace.kind === "invalid") return;
    setOpen(false);
    props.onCreate(workspace.kind === "path" ? workspace.path : null);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="sm"
      title={t("desktop.threads.newDialog.title")}
      trigger={
        <Button size="xs" variant="ghost" className="justify-self-start">
          {t("desktop.threads.otherFolder")}
        </Button>
      }
      footer={
        <>
          <span aria-hidden className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            {t("desktop.threads.newDialog.cancel")}
          </Button>
          <Button
            size="sm"
            variant="solid"
            loading={props.creating}
            disabled={props.creating || hint !== null}
            onClick={create}
          >
            {text.trim() === ""
              ? t("desktop.threads.newDialog.createNoFolder")
              : t("desktop.threads.newDialog.create")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {pickFailed ? (
          <Alert tone="danger" layout="inline" size="sm">
            {t("desktop.workspace.pickFailed")}
          </Alert>
        ) : null}
        <Field
          label={t("desktop.threads.newDialog.folderLabel")}
          optional
          optionalLabel={t("desktop.threads.newDialog.optional")}
          error={hint ?? undefined}
          size="sm"
        >
          <Input
            size="sm"
            value={text}
            invalid={hint !== null}
            spellCheck={false}
            autoComplete="off"
            placeholder="/Users/me/project"
            className="font-mono text-mono-sm"
            onValueChange={(value) => {
              setText(value);
              setPickFailed(false);
            }}
            onKeyDown={(event) => {
              // 한글 조합 중의 Enter는 글자를 확정하는 키라 만들기가 아니다
              if (event.key === "Enter" && !event.nativeEvent.isComposing) create();
            }}
            suffix={
              folderPick === undefined ? null : (
                <IconButton
                  size="xs"
                  variant="ghost"
                  label={t("desktop.workspace.pickFolderButton")}
                  disabled={props.creating}
                  onClick={() => detach(pick(folderPick), rethrow)}
                >
                  <FolderOpen />
                </IconButton>
              )
            }
          />
        </Field>
        {props.recent.length === 0 ? null : (
          <ListNavigation aria-label={t("desktop.threads.recentLabel")} size="sm" as="div">
            <ListNavigationGroup heading={t("desktop.threads.recentHeading")}>
              {props.recent.map((recent) => (
                <ListNavigationItem
                  key={recent.path}
                  icon={<Folder />}
                  current={text.trim() === recent.path}
                  meta={t("desktop.threads.recentCount", { count: recent.count })}
                  onSelect={() => {
                    setText(recent.path);
                    setPickFailed(false);
                  }}
                >
                  <span className="font-mono text-mono-sm">{recent.path}</span>
                </ListNavigationItem>
              ))}
            </ListNavigationGroup>
          </ListNavigation>
        )}
      </div>
    </Dialog>
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

  const startThread = useStartNewThread(props.folderPick);
  /** `path`: 글은 그 폴더, `undefined`는 보던 폴더(없으면 고르기), `null`은 대화 상자의 "폴더 없이 만들기" */
  const create = async (path: string | null | undefined): Promise<void> => {
    setError(null);
    setCreating(true);
    const result = await startThread(path);
    setCreating(false);
    if (result.kind === "failed")
      setError(createFailureText(result.error, typeof path === "string"));
    else if (result.kind === "pickFailed") setError(t("desktop.workspace.pickFailed"));
  };
  const start = (path: string | null | undefined): void => {
    detach(create(path), rethrow);
  };
  // 새 대화 대화 상자는 닫히면서 초점을 자기 단추로 되돌린다. 닫힌 뒤에 입력창 초점을 한 번 더 요청한다
  const startFromDialog = (path: string | null): void => {
    const run = async (): Promise<void> => {
      await create(path);
      window.setTimeout(() => {
        commands.requestComposer(null);
      }, DIALOG_CLOSE_MS);
    };
    detach(run(), rethrow);
  };

  const groups = sidebarGroupsOf(threads);
  const recent = recentWorkspacesOf(threads);
  return (
    <div className={LIST_COLUMN}>
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
            {group.items.map((row) => (
              <ThreadRow key={row.thread.threadId} thread={row.thread} child={row.child} />
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
          recent={recent}
          onCreate={startFromDialog}
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
