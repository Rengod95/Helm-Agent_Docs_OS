import { detach, rethrow } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
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
        <span className="thread-title">{thread.title ?? "제목 없음"}</span>
        <span className="thread-meta">
          {thread.status === "running" ? <span className="badge run">실행 중</span> : null}
          {thread.status === "closed" ? <span className="badge">닫힘</span> : null}
          {thread.resumable === null ? null : <span className="badge warn">이어서 실행</span>}
          {thread.pendingApprovals > 0 ? (
            <span className="badge warn">승인 {thread.pendingApprovals}</span>
          ) : null}
          {unlisted > 0 ? <span className="dim">승인 대기 중, 목록을 불러오지 못함</span> : null}
        </span>
      </button>
    </li>
  );
});

export function ThreadList(): ReactNode {
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

  const create = async (): Promise<void> => {
    if (workspace.kind === "invalid") return;
    const path = workspace.kind === "path" ? workspace.path : undefined;
    setCreating(true);
    setError(null);
    const result = await commands.createThread(path);
    setCreating(false);
    if (!result.ok) setError(createFailureText(result.error, path !== undefined));
  };

  return (
    <nav className="threads" aria-label="대화 목록">
      <label className="field">
        <span>작업 폴더 (선택)</span>
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
      {hint === null ? null : <div className="error">{hint}</div>}
      <button
        type="button"
        className="primary"
        onClick={() => detach(create(), rethrow)}
        disabled={creating || workspace.kind === "invalid"}
      >
        새 대화
      </button>
      {error === null ? null : (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {status === "loading" && ids.length === 0 ? (
        <div className="dim pad">목록을 읽는 중…</div>
      ) : null}
      {status === "error" ? (
        <div className="pad">
          목록을 불러오지 못했습니다.{" "}
          <button
            type="button"
            onClick={() => {
              commands.reloadThreads();
            }}
          >
            다시 읽기
          </button>
        </div>
      ) : null}
      {status === "ready" && ids.length === 0 ? (
        <div className="dim pad">대화가 없습니다.</div>
      ) : null}
      <ul>
        {ids.map((id) => (
          <ThreadRow key={id} id={id} />
        ))}
      </ul>
    </nav>
  );
}
