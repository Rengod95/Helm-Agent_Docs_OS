import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { Progress } from "@caustic/react";
import { CircleCheck, CircleX, Circle, Clock, Minus } from "@caustic/react/icons";
import type { ReactNode } from "react";
import { ProgressOrb } from "../../effects/progress-orb.tsx";
import { WellEmpty, WellGroup } from "../../pages/shared/well-parts.tsx";
import { progressPercentOf, type BoardTask, type TaskBoard } from "./task-board-model.ts";

// 작업 판 그림(DP-195). 상태 없이 props만 받는다(서버 렌더 시험이 직접 그린다).
// 위에서 아래로: 진행 막대(4px) + n/m · 지금 카드(가장 크게) · 다음 · 실패 · 끝남(기본 접힘).
// 강조색은 진행 막대와 지금 점 둘뿐이다. 실패만 위험 색 아이콘, 완료는 성공 색 아이콘이다.

const ICON = "size-icon-sm flex-none";

export interface TaskBoardHandlers {
  /** 소유자 이름에 맞는 하위 에이전트 대화가 있으면 그 id. 없으면 null(소유자는 글로만 보인다) */
  readonly ownerThread: (owner: string) => string | null;
  readonly openThread: (threadId: string) => void;
  readonly toggleFinished: () => void;
}

export function TaskBoardView(props: {
  readonly board: TaskBoard;
  readonly finishedOpen: boolean;
  readonly handlers: TaskBoardHandlers;
}): ReactNode {
  const { board, handlers } = props;
  if (board.total === 0) {
    return (
      <WellEmpty
        title={t("desktop.tasks.empty.title")}
        description={t("desktop.tasks.empty.description")}
      />
    );
  }
  const pct = progressPercentOf(board.progress);
  const counts = t("desktop.tasks.progress", board.progress);
  return (
    <div className="grid gap-3">
      <div className="flex h-5 items-center gap-2.5">
        <Progress
          size="sm"
          value={pct}
          label={t("desktop.tasks.progressLabel")}
          className="min-w-0 flex-1"
        />
        <span className="flex-none text-ui-sm font-normal text-text-tertiary">{counts}</span>
      </div>
      {board.current === null ? null : <CurrentCard task={board.current} handlers={handlers} />}
      {board.next.length === 0 ? null : (
        <WellGroup title={t("desktop.tasks.group.next")} count={board.next.length}>
          <TaskRows tasks={board.next} handlers={handlers} />
        </WellGroup>
      )}
      {board.failed.length === 0 ? null : (
        <WellGroup title={t("desktop.tasks.group.failed")} count={board.failed.length}>
          <TaskRows tasks={board.failed} handlers={handlers} />
        </WellGroup>
      )}
      {board.finished.length === 0 ? null : (
        <WellGroup
          title={t("desktop.tasks.group.finished")}
          count={board.finished.length}
          fold={{ open: props.finishedOpen, onToggle: handlers.toggleFinished }}
        >
          <TaskRows tasks={board.finished} handlers={handlers} />
        </WellGroup>
      )}
    </div>
  );
}

/** "기다림: 시험 추가 외 1" */
function waitingText(task: BoardTask): string | null {
  const first = task.waitingOn[0];
  if (first === undefined) return null;
  return task.waitingOn.length === 1
    ? t("desktop.tasks.waitingOn", { task: first })
    : t("desktop.tasks.waitingOnMore", { task: first, count: task.waitingOn.length - 1 });
}

function Owner(props: { readonly owner: string; readonly handlers: TaskBoardHandlers }): ReactNode {
  const thread = props.handlers.ownerThread(props.owner);
  const text = `@${props.owner}`;
  if (thread === null) {
    return (
      <span className="flex-none truncate text-ui-sm font-normal text-text-tertiary" title={text}>
        {text}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={t("desktop.tasks.owner.open", { owner: props.owner })}
      onClick={() => {
        props.handlers.openThread(thread);
      }}
      className="max-w-32 flex-none cursor-pointer truncate rounded-sm border-0 bg-transparent p-0 text-ui-sm font-normal text-text-secondary underline decoration-border-strong underline-offset-2 outline-none hover:text-text-primary focus-visible:shadow-focus"
    >
      {text}
    </button>
  );
}

/** 지금 하는 것: 진행형 문장을 가장 크게(15/600, 세 줄까지), 원래 내용·소유자·기다림은 12 */
function CurrentCard(props: {
  readonly task: BoardTask;
  readonly handlers: TaskBoardHandlers;
}): ReactNode {
  const { task } = props;
  const headline = task.activeForm ?? task.content;
  const waiting = waitingText(task);
  return (
    <section
      aria-label={t("desktop.tasks.current")}
      data-task-current=""
      className="grid gap-1 rounded-xl border border-border-subtle bg-surface-base px-3 py-2.5"
    >
      <div className="flex h-5 min-w-0 items-center gap-1.5">
        <ProgressOrb />
        <span className="text-ui-sm text-text-tertiary">{t("desktop.tasks.current")}</span>
        <span className="flex-1" />
        {task.owner === null ? null : <Owner owner={task.owner} handlers={props.handlers} />}
      </div>
      <p className="m-0 line-clamp-3 text-title-3 text-text-primary" title={headline}>
        {headline}
      </p>
      {task.activeForm === null || task.activeForm === task.content ? null : (
        <p className="m-0 truncate text-ui-sm font-normal text-text-tertiary" title={task.content}>
          {task.content}
        </p>
      )}
      {waiting === null ? null : (
        <p className="m-0 flex items-center gap-1 text-ui-sm font-normal text-text-secondary">
          <Clock aria-hidden className="size-icon-xs flex-none" />
          <span className="truncate">{waiting}</span>
        </p>
      )}
    </section>
  );
}

function TaskIcon(props: { readonly task: BoardTask }): ReactNode {
  const { task } = props;
  switch (task.status) {
    case "in_progress":
      return <ProgressOrb />;
    case "completed":
      return <CircleCheck aria-hidden className={`${ICON} text-success-text`} />;
    case "failed":
      return <CircleX aria-hidden className={`${ICON} text-danger-text`} />;
    case "cancelled":
      return <Minus aria-hidden className={`${ICON} text-text-tertiary`} />;
    case "pending":
      return task.waitingOn.length > 0 ? (
        <Clock aria-hidden className={`${ICON} text-text-tertiary`} />
      ) : (
        <Circle aria-hidden className={`${ICON} text-text-tertiary`} />
      );
    default:
      return assertNever(task.status, "TaskStatus");
  }
}

function statusText(task: BoardTask): string {
  switch (task.status) {
    case "in_progress":
      return t("desktop.now.task.now");
    case "completed":
      return t("desktop.now.task.done");
    case "failed":
      return t("desktop.now.task.failed");
    case "cancelled":
      return t("desktop.now.task.cancelled");
    case "pending":
      return task.waitingOn.length > 0 ? t("desktop.now.task.blocked") : t("desktop.now.task.todo");
    default:
      return assertNever(task.status, "TaskStatus");
  }
}

/** 작업 줄: 아이콘 16 · 8 · 글 13(한 줄 말줄임) · 소유자. 막혔으면 둘째 줄에 기다리는 작업(12) */
function TaskRows(props: {
  readonly tasks: readonly BoardTask[];
  readonly handlers: TaskBoardHandlers;
}): ReactNode {
  return (
    <ul className="m-0 grid list-none p-0">
      {props.tasks.map((task) => {
        const text =
          task.status === "in_progress" ? (task.activeForm ?? task.content) : task.content;
        const waiting = waitingText(task);
        const tone =
          task.status === "in_progress"
            ? "text-text-primary"
            : task.status === "completed" || task.status === "cancelled"
              ? "text-text-tertiary"
              : "text-text-secondary";
        return (
          <li key={task.id} data-task={task.status} className="grid min-h-8 content-center py-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid size-icon-sm flex-none place-items-center">
                <TaskIcon task={task} />
              </span>
              <span className="sr-only">{statusText(task)}</span>
              <span
                className={`min-w-0 flex-1 truncate text-ui ${tone} ${task.status === "cancelled" ? "line-through" : ""}`}
                title={text}
              >
                {text}
              </span>
              {task.owner === null ? null : <Owner owner={task.owner} handlers={props.handlers} />}
            </div>
            {waiting === null ? null : (
              <p className="m-0 truncate ps-6 text-ui-sm font-normal text-text-tertiary">
                {waiting}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
