import { t } from "@fresnel/client/i18n";
import { Alert, Badge, Button, EmptyState, Input, Plan, Skeleton, Tooltip } from "@caustic/react";
import { useId, type ReactNode } from "react";
import {
  goalVMOf,
  taskListOf,
  type GoalVM,
  type TaskListVM,
  type WorkNotice,
  type WorkState,
} from "./work-model.ts";

// 목표와 작업 화면(P-14)의 그림. 상태와 동작은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 목표 걸기와 해제는 `work-screen.tsx`가 `/goal` 줄로 보낸다. 작업 행은 누를 수 없다(만든 턴으로 가는 값이 wire에 없다).

export interface WorkHandlers {
  readonly draftChange: (draft: string) => void;
  readonly submitGoal: () => void;
  readonly clearGoal: () => void;
  readonly retryGoal: () => void;
  readonly retryTasks: () => void;
  readonly toggleDone: () => void;
  readonly dismissNotice: () => void;
}

export interface WorkViewProps {
  /** 열린 대화가 있는가. 없으면 빈 상태만 그린다 */
  readonly threadOpen: boolean;
  readonly state: WorkState;
  readonly live: boolean;
  readonly handlers: WorkHandlers;
}

export function WorkView(props: WorkViewProps): ReactNode {
  const { threadOpen, state, live, handlers } = props;
  if (!threadOpen) {
    return (
      <EmptyState
        size="sm"
        title={t("desktop.work.noThread")}
        description={t("desktop.work.noThreadHint")}
      />
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {live ? null : (
        <Alert tone="warning" layout="inline">
          {t("desktop.work.offline")}
        </Alert>
      )}
      {state.notice === null ? null : (
        <NoticeLine notice={state.notice} onDismiss={handlers.dismissNotice} />
      )}
      <GoalPanel state={state} live={live} handlers={handlers} />
      <TasksPanel state={state} handlers={handlers} />
    </div>
  );
}

function NoticeLine(props: {
  readonly notice: WorkNotice;
  readonly onDismiss: () => void;
}): ReactNode {
  return (
    <Alert
      tone={props.notice.tone === "danger" ? "danger" : "success"}
      dismissible
      dismissLabel={t("desktop.work.dismiss")}
      onDismiss={props.onDismiss}
    >
      {props.notice.text}
    </Alert>
  );
}

function GoalPanel(props: {
  readonly state: WorkState;
  readonly live: boolean;
  readonly handlers: WorkHandlers;
}): ReactNode {
  const { state, live, handlers } = props;
  const headingId = useId();
  const goal = state.goal;
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <h2 id={headingId} className="text-ui-strong text-text-primary">
        {t("desktop.work.goal.heading")}
      </h2>
      {goal.status === "loading" ? <Skeleton height={64} /> : null}
      {goal.status === "failed" ? (
        <Alert
          tone="danger"
          action={
            <Button size="xs" variant="outline" onClick={handlers.retryGoal}>
              {t("desktop.work.retry")}
            </Button>
          }
        >
          {t("desktop.work.goal.load.failed")}
        </Alert>
      ) : null}
      {goal.status === "ready" ? (
        <GoalBody
          goal={goal.value === null ? null : goalVMOf(goal.value)}
          draft={state.draft}
          busy={state.busy}
          live={live}
          handlers={handlers}
        />
      ) : null}
    </section>
  );
}

function GoalBody(props: {
  readonly goal: GoalVM | null;
  readonly draft: string;
  readonly busy: boolean;
  readonly live: boolean;
  readonly handlers: WorkHandlers;
}): ReactNode {
  const { goal, draft, busy, live, handlers } = props;
  const writable = live && !busy;
  const active = goal !== null && goal.status === "active";
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {goal === null ? (
        <p className="text-body text-text-secondary">{t("desktop.work.goal.empty")}</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border-subtle p-3">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 whitespace-pre-wrap text-body text-text-primary">
              {goal.condition}
            </p>
            <WriteButton
              live={live}
              disabled={!writable}
              onClick={handlers.clearGoal}
              variant="outline"
              size="xs"
            >
              {t("desktop.work.goal.clear")}
            </WriteButton>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-caption text-text-secondary">
            <Badge>{t(goal.statusRef.id, goal.statusRef.args)}</Badge>
            <span>
              {t("desktop.work.goal.judged", { judged: goal.judged, max: goal.maxJudgments })}
            </span>
          </div>
          {goal.verdict === null ? null : (
            <p className="text-caption text-text-secondary">
              {t(
                goal.verdict.met
                  ? "desktop.work.goal.verdict.met"
                  : "desktop.work.goal.verdict.unmet",
              )}
              {goal.verdict.reason === "" ? "" : ` · ${goal.verdict.reason}`}
            </p>
          )}
          {goal.endRef === null ? null : (
            <p className="text-caption text-text-secondary">
              {t(goal.endRef.id, goal.endRef.args)}
            </p>
          )}
        </div>
      )}
      {active ? null : (
        <GoalForm draft={draft} writable={writable} live={live} handlers={handlers} />
      )}
    </div>
  );
}

function GoalForm(props: {
  readonly draft: string;
  readonly writable: boolean;
  readonly live: boolean;
  readonly handlers: WorkHandlers;
}): ReactNode {
  const { draft, writable, live, handlers } = props;
  const formId = useId();
  return (
    <form
      id={formId}
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (writable) handlers.submitGoal();
      }}
    >
      <label className="flex flex-col gap-1 text-caption text-text-secondary">
        {t("desktop.work.goal.set.label")}
        <Input
          size="sm"
          value={draft}
          disabled={!writable}
          placeholder={t("desktop.work.goal.set.placeholder")}
          onChange={(event) => {
            handlers.draftChange(event.target.value);
          }}
        />
      </label>
      <div>
        <WriteButton live={live} disabled={!writable} type="submit" size="sm">
          {t("desktop.work.goal.set.submit")}
        </WriteButton>
      </div>
    </form>
  );
}

/** 쓰기 버튼. 연결이 없으면 잠그고 이유를 `Tooltip`으로 보인다 */
function WriteButton(props: {
  readonly live: boolean;
  readonly disabled: boolean;
  readonly onClick?: () => void;
  readonly children: ReactNode;
  readonly variant?: "solid" | "outline";
  readonly size?: "xs" | "sm";
  readonly type?: "button" | "submit";
}): ReactNode {
  const { live, disabled, children, onClick, variant, size, type } = props;
  const button = (
    <Button
      type={type ?? "button"}
      size={size ?? "sm"}
      {...(variant === undefined ? {} : { variant })}
      disabled={disabled}
      {...(onClick === undefined ? {} : { onClick })}
    >
      {children}
    </Button>
  );
  if (live) return button;
  return (
    <Tooltip content={t("desktop.offline.hint")}>
      <span className="inline-flex">{button}</span>
    </Tooltip>
  );
}

function TasksPanel(props: {
  readonly state: WorkState;
  readonly handlers: WorkHandlers;
}): ReactNode {
  const { state, handlers } = props;
  const tasks = state.tasks;
  if (tasks.status === "loading") return <Skeleton height={120} />;
  if (tasks.status === "failed") {
    return (
      <Alert
        tone="danger"
        action={
          <Button size="xs" variant="outline" onClick={handlers.retryTasks}>
            {t("desktop.work.retry")}
          </Button>
        }
      >
        {t("desktop.work.tasks.load.failed")}
      </Alert>
    );
  }
  const list = taskListOf(tasks.value, state.doneExpanded);
  if (list.total === 0) {
    return <EmptyState size="sm" title={t("desktop.work.tasks.empty")} />;
  }
  return <TaskList list={list} handlers={handlers} />;
}

function TaskList(props: {
  readonly list: TaskListVM;
  readonly handlers: WorkHandlers;
}): ReactNode {
  const { list, handlers } = props;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Plan
        bare
        title={t("desktop.work.tasks.heading")}
        countLabel={(done, total) => t("desktop.work.tasks.count", { done, total })}
        statusLabels={{
          done: t("desktop.work.tasks.status.done"),
          now: t("desktop.work.tasks.status.now"),
          todo: t("desktop.work.tasks.status.todo"),
        }}
        steps={list.steps.map((step) => ({
          id: step.id,
          label: step.label,
          status: step.status,
          clickable: false,
          ...(step.detailRef === null ? {} : { detail: t(step.detailRef.id, step.detailRef.args) }),
        }))}
      />
      {list.foldable ? (
        <div>
          <Button size="xs" variant="ghost" onClick={handlers.toggleDone}>
            {list.hiddenDone > 0
              ? t("desktop.work.tasks.expandDone", { count: list.hiddenDone })
              : t("desktop.work.tasks.collapseDone")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
