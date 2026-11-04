import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { memo, useState, type ReactNode } from "react";
import {
  useRecentWorkspaces,
  useThread,
  useThreadIds,
  useThreadsStatus,
  useUnlistedApprovals,
} from "../state/engine/index.ts";
import { useSelectedThreadId } from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";
import { pickWorkspaceFolder, type FolderPickInvoke } from "./folder-pick.ts";
import { checkWorkspaceInput, createFailureText, workspaceHint } from "./workspace-model.ts";

/** 폴더 후보로 보이는 기존 대화의 작업 폴더 수 */
const RECENT_WORKSPACES = 8;

const ThreadRow = memo(function ThreadRow(props: { readonly id: ThreadId }): ReactNode {
  const commands = useCommands();
  const thread = useThread(props.id);
  const selected = useSelectedThreadId() === props.id;
  const unlisted = useUnlistedApprovals(props.id);
  if (thread === undefined) return null;
  return (
    <li>
      <button
        type="button"
        className={selected ? "thread selected" : "thread"}
        aria-current={selected ? "true" : undefined}
        onClick={() => {
          commands.selectThread(props.id);
        }}
      >
        <span className="thread-title">{thread.title ?? t("desktop.threads.untitled")}</span>
        <span className="thread-meta">
          {thread.status === "running" ? (
            <span className="badge run">{t("desktop.threads.runningBadge")}</span>
          ) : null}
          {thread.status === "closed" ? (
            <span className="badge">{t("desktop.threads.closedBadge")}</span>
          ) : null}
          {thread.resumable === null ? null : (
            <span className="badge warn">{t("desktop.threads.resumableBadge")}</span>
          )}
          {thread.pendingApprovals > 0 ? (
            <span className="badge warn">
              {t("desktop.threads.approvalsBadge", { count: thread.pendingApprovals })}
            </span>
          ) : null}
          {unlisted > 0 ? (
            <span className="dim">{t("desktop.threads.unlistedApprovals")}</span>
          ) : null}
        </span>
      </button>
    </li>
  );
});

export function ThreadList(props: {
  /** 폴더 선택 창을 부르는 invoke. 없으면(웹 등) 고르기 단추를 보이지 않는다 */
  readonly folderPick?: FolderPickInvoke | undefined;
}): ReactNode {
  const commands = useCommands();
  const ids = useThreadIds();
  const status = useThreadsStatus();
  const recent = useRecentWorkspaces(RECENT_WORKSPACES);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 마지막에 쓴 폴더를 입력란에 남겨 같은 프로젝트에서 대화를 여러 개 여는 일이 쉽다
  const [workspaceText, setWorkspaceText] = useState("");
  const workspace = checkWorkspaceInput(workspaceText);
  const hint = workspaceHint(workspace);
  const folderPick = props.folderPick;

  const create = async (): Promise<void> => {
    if (workspace.kind === "invalid") return;
    const path = workspace.kind === "path" ? workspace.path : undefined;
    setCreating(true);
    setError(null);
    const result = await commands.createThread(path);
    setCreating(false);
    if (!result.ok) setError(createFailureText(result.error, path !== undefined));
  };

  // 취소는 입력란을 그대로 둔다. 창을 못 연 실패도 입력란은 그대로 두고 한 줄로만 알린다
  const pick = async (invoke: FolderPickInvoke): Promise<void> => {
    const picked = await pickWorkspaceFolder(invoke);
    if (!picked.ok) {
      setError(t("desktop.workspace.pickFailed"));
      return;
    }
    if (picked.value === undefined) return;
    setWorkspaceText(picked.value);
    setError(null);
  };

  return (
    <nav className="threads" aria-label={t("desktop.threads.listLabel")}>
      <label className="field">
        <span>{t("desktop.threads.workspaceLabel")}</span>
        <input
          type="text"
          list="workspace-recent"
          placeholder="/Users/me/project"
          value={workspaceText}
          onChange={(event) => {
            setWorkspaceText(event.currentTarget.value);
            setError(null);
          }}
        />
        <datalist id="workspace-recent">
          {recent.map((path) => (
            <option key={path} value={path} />
          ))}
        </datalist>
      </label>
      {folderPick === undefined ? null : (
        <button type="button" disabled={creating} onClick={() => detach(pick(folderPick), rethrow)}>
          {t("desktop.workspace.pickFolderButton")}
        </button>
      )}
      {hint === null ? null : <div className="error">{hint}</div>}
      <button
        type="button"
        className="primary"
        onClick={() => detach(create(), rethrow)}
        disabled={creating || workspace.kind === "invalid"}
      >
        {t("desktop.threads.newButton")}
      </button>
      {error === null ? null : (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {status === "loading" && ids.length === 0 ? (
        <div className="dim pad">{t("desktop.threads.loading")}</div>
      ) : null}
      {status === "error" ? (
        <div className="pad">
          {t("desktop.threads.loadFailed")}{" "}
          <button
            type="button"
            onClick={() => {
              commands.reloadThreads();
            }}
          >
            {t("desktop.threads.reloadButton")}
          </button>
        </div>
      ) : null}
      {status === "ready" && ids.length === 0 ? (
        <div className="dim pad">{t("desktop.threads.empty")}</div>
      ) : null}
      <ul>
        {ids.map((id) => (
          <ThreadRow key={id} id={id} />
        ))}
      </ul>
    </nav>
  );
}
