import { t } from "@fresnel/client/i18n";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useMemo, useState, type ReactNode } from "react";
import {
  useAgentRows,
  useTaskRecords,
  useThreadSummaries,
  useThreadsWithTasks,
} from "../../../state/engine/index.ts";
import { useSelectedThreadId } from "../../../state/ui/index.ts";
import { ThreadWork } from "../../pages/work/work-screen.tsx";
import { WellEmpty, WellGroup } from "../../pages/shared/well-parts.tsx";
import { useGoToThread } from "../../thread-link.ts";
import { TaskBoardView, type TaskBoardHandlers } from "./task-board.tsx";
import { openTaskGroupsOf, taskBoardOf } from "./task-board-model.ts";

// 오른쪽 막대 "작업" 탭(DP-195, 탭 id `work`, ⌘⇧T). 열린 대화의 목표·계획(`ThreadWork`)과 작업 판(거울).
// 대화가 열려 있지 않으면 끝나지 않은 작업이 있는 최근 대화들을 묶어 보인다.

export function TasksTab(): ReactNode {
  const threadId = useSelectedThreadId();
  if (threadId === null) return <OpenTasksOverview />;
  // 대화가 바뀌면 상태(초안, 접기, 알림)를 새로 시작한다
  return (
    <ThreadWork
      key={threadId}
      threadId={threadId}
      tasks={<ThreadTaskBoard threadId={threadId} />}
    />
  );
}

function ThreadTaskBoard(props: { readonly threadId: ThreadId }): ReactNode {
  const tasks = useTaskRecords(props.threadId);
  const board = useMemo(() => taskBoardOf(tasks), [tasks]);
  const agents = useAgentRows(props.threadId);
  const goTo = useGoToThread();
  const [finishedOpen, setFinishedOpen] = useState(false);
  const handlers: TaskBoardHandlers = {
    ownerThread: (owner) => {
      if (goTo === null) return null;
      // 같은 이름의 하위 에이전트가 여럿이면 마지막(가장 최근) 것이다
      const row = agents.findLast((candidate) => candidate.agent.agent === owner);
      return row === undefined ? null : row.agent.childThreadId;
    },
    openThread: (threadId) => {
      goTo?.(threadId);
    },
    toggleFinished: () => {
      setFinishedOpen((open) => !open);
    },
  };
  return <TaskBoardView board={board} finishedOpen={finishedOpen} handlers={handlers} />;
}

/** 열린 대화가 없을 때: 끝나지 않은 작업이 있는 최근 대화(최대 5) */
function OpenTasksOverview(): ReactNode {
  const threads = useThreadsWithTasks();
  const summaries = useThreadSummaries();
  const goTo = useGoToThread();
  const groups = useMemo(() => openTaskGroupsOf(threads), [threads]);
  if (groups.length === 0) {
    return (
      <WellEmpty title={t("desktop.work.noThread")} description={t("desktop.tasks.noThread")} />
    );
  }
  const titleOf = (threadId: ThreadId): string => {
    const summary = summaries.find((s) => s.threadId === threadId);
    const title = summary?.title?.trim() ?? "";
    return title !== "" ? title : (summary?.preview ?? t("desktop.approvals.card.thread.untitled"));
  };
  return (
    <WellGroup title={t("desktop.tasks.open.heading")} count={groups.length}>
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {groups.map((group) => (
          <li key={group.threadId}>
            <button
              type="button"
              disabled={goTo === null}
              onClick={() => {
                goTo?.(group.threadId);
              }}
              className="-mx-2 grid w-[calc(100%+1rem)] min-w-0 cursor-pointer gap-0.5 rounded-lg border-0 bg-transparent px-2 py-1.5 text-start outline-none transition-colors hover:bg-neutral-hover focus-visible:shadow-focus"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-ui font-medium text-text-primary">
                  {titleOf(group.threadId)}
                </span>
                <span className="flex-none text-ui-sm font-normal text-text-tertiary">
                  {t("desktop.tasks.progress", { done: group.done, total: group.total })}
                </span>
              </span>
              <span className="truncate text-ui-sm font-normal text-text-tertiary">
                {group.headline}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </WellGroup>
  );
}

/** well 머리 요약(DP-193): "3/7 끝남"과 "1개 막힘"을 간격으로 나눠 놓는다. 대화가 없거나 작업이 없으면 그리지 않는다 */
export function TasksSummary(): ReactNode {
  const threadId = useSelectedThreadId();
  return threadId === null ? null : <ThreadTasksSummary threadId={threadId} />;
}

function ThreadTasksSummary(props: { readonly threadId: ThreadId }): ReactNode {
  const tasks = useTaskRecords(props.threadId);
  const board = useMemo(() => taskBoardOf(tasks), [tasks]);
  if (board.total === 0) return null;
  const done = t("desktop.tasks.summary.done", board.progress);
  return board.blocked === 0 ? (
    done
  ) : (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="flex-none">{done}</span>{" "}
      <span>{t("desktop.tasks.summary.blocked", { count: board.blocked })}</span>
    </span>
  );
}
