import type { ThreadId } from "@xeon/contracts/conversation";
import { memo, useState, type ReactNode } from "react";
import {
  useThread,
  useThreadIds,
  useThreadsStatus,
  useUnlistedApprovals,
} from "../state/engine/index.ts";
import { useSelectedThreadId } from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";

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
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    const result = await commands.createThread();
    setCreating(false);
    if (!result.ok) setError("새 대화를 만들지 못했습니다.");
  };

  return (
    <nav className="threads" aria-label="대화 목록">
      <button type="button" className="primary" onClick={() => void create()} disabled={creating}>
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
