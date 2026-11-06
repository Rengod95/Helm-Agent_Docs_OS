import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  Plan,
  Skeleton,
  Timeline,
  TimelineItem,
} from "@caustic/react";
import { ChevronRight } from "@caustic/react/icons";
import { useId, useState, type ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import {
  goalVMOf,
  planCardOf,
  planLoadViewOf,
  planVersionListOf,
  taskListOf,
  type GoalVM,
  type PlanLoadView,
  type PlanVersionListVM,
  type PlanVersionRow,
  type PlanVersionWire,
  type TaskListVM,
  type WorkNotice,
  type WorkState,
} from "./work-model.ts";

// 목표와 작업 화면(P-14)의 그림. 상태와 동작은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 목표 걸기와 해제는 `work-screen.tsx`가 `/goal` 줄로 보낸다. 작업 행은 누를 수 없다(만든 턴으로 가는 값이 wire에 없다).
// 계획 카드(W-18)는 최근 계획의 최신 판을 한 줄로 보이고, "보기"가 판 목록 대화상자를 연다.
// 연결이 없으면 마지막으로 읽은 값을 흐리게 두고 쓰기 단추만 잠근다(mockups/d03 P-14 D-offline).

export interface WorkHandlers {
  readonly draftChange: (draft: string) => void;
  readonly submitGoal: () => void;
  readonly clearGoal: () => void;
  readonly retryGoal: () => void;
  readonly retryTasks: () => void;
  readonly retryPlan: () => void;
  readonly viewPlan: () => void;
  readonly openVersions: () => void;
  readonly closeVersions: () => void;
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

/**
 * 배지 색 이름. caustic `Badge`의 `tone` 속성은 지원 중단 표시가 붙어 쓰지 않고, 같은 색 토큰을 `className`으로 입힌다.
 * 색만으로 뜻을 주지 않는다: 상태 글자가 따로 있다.
 */
type BadgeTone = "info" | "success" | "warning" | "danger" | "neutral";

const BADGE_TONE_CLASS: Readonly<Record<BadgeTone, string>> = {
  info: "bg-info-soft text-info-text",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text",
  neutral: "bg-neutral-track text-text-secondary",
};

export function WorkView(props: WorkViewProps): ReactNode {
  const { threadOpen, state, live, handlers } = props;
  if (!threadOpen) {
    return <EmptyState size="sm" title={t("desktop.work.noThread")} />;
  }
  return (
    <div className="grid gap-5">
      {live ? null : (
        <Alert tone="neutral" size="sm">
          {t("desktop.work.offline")}
        </Alert>
      )}
      {state.notice === null ? null : (
        <NoticeLine notice={state.notice} onDismiss={handlers.dismissNotice} />
      )}
      <div className={live ? "grid gap-5" : "grid gap-5 opacity-60"}>
        <GoalPanel state={state} live={live} handlers={handlers} />
        <PlanPanel state={state} live={live} handlers={handlers} />
        <TasksPanel state={state} handlers={handlers} />
      </div>
    </div>
  );
}

/** 절 머리. 가운데 글은 `h2`이고, 머리 오른쪽 칸(단추나 정보 아이콘)은 `end`로 받는다 */
function SectionHead(props: {
  readonly id: string;
  readonly title: string;
  readonly end?: ReactNode;
}): ReactNode {
  return (
    <div className="flex min-h-6 items-center gap-1.5">
      <h2
        id={props.id}
        className="m-0 flex flex-1 items-baseline gap-1.5 text-ui-sm font-semibold text-text-primary"
      >
        {props.title}
      </h2>
      {props.end}
    </div>
  );
}

/**
 * 계획 카드. 계획이 없으면(`planId`가 null) 아무것도 그리지 않는다. 있으면 최신 판의 제목, 번호, 상태 한 줄과
 * "보기"가 판 목록 대화상자를 연다. 읽기 상태(읽는 중, 오류, 못 찾음, 오프라인)는 카드 자리에 알림으로 보인다.
 */
function PlanPanel(props: {
  readonly state: WorkState;
  readonly live: boolean;
  readonly handlers: WorkHandlers;
}): ReactNode {
  const { state, live, handlers } = props;
  const headingId = useId();
  const plan = state.plan;
  if (plan.planId === null) return null;
  const view = planLoadViewOf(plan.load, live);
  const versions = plan.load.status === "ready" ? plan.load.versions : [];
  const card = view === "ready" ? planCardOf(versions) : null;
  const versionsDialog = (
    <Dialog
      open={state.versionsOpen}
      onOpenChange={(open) => {
        if (open) handlers.openVersions();
        else handlers.closeVersions();
      }}
      title={t("desktop.work.plan.versions.title")}
      showClose
      closeLabel={t("desktop.work.dismiss")}
      trigger={
        card === null ? undefined : (
          <Button size="xs" variant="ghost">
            {t("desktop.work.plan.versions.open")}
          </Button>
        )
      }
    >
      <PlanVersionsBody view={view} versions={versions} onRetry={handlers.retryPlan} />
    </Dialog>
  );
  return (
    <section aria-labelledby={headingId} className="grid gap-1.5">
      <SectionHead
        id={headingId}
        title={t("desktop.work.plan.heading")}
        end={<InfoTip text={t("desktop.work.plan.info")} />}
      />
      {card === null ? (
        <>
          <PlanNotice view={view} onRetry={handlers.retryPlan} />
          {versionsDialog}
        </>
      ) : (
        <div className="-mx-1.5 flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-ui-sm hover:bg-fill-hover">
          <span className="min-w-0 flex-1 truncate text-text-primary">{card.title}</span>
          <span className="flex-none text-ui-xs text-text-tertiary">
            {t("desktop.work.plan.version", { version: card.version })}
          </span>
          <Badge size="xs">{t(card.statusRef.id)}</Badge>
          {versionsDialog}
        </div>
      )}
    </section>
  );
}

/** 판 목록 본문. 판이 있으면 목록을, 아니면 읽기 상태의 알림을 그린다(서버 렌더 시험이 직접 그린다) */
export function PlanVersionsBody(props: {
  readonly view: PlanLoadView;
  readonly versions: readonly PlanVersionWire[];
  readonly onRetry: () => void;
}): ReactNode {
  const { view, versions, onRetry } = props;
  if (view !== "ready") return <PlanNotice view={view} onRetry={onRetry} />;
  return <PlanVersionList list={planVersionListOf(versions)} />;
}

/** 계획 읽기 상태의 알림. 판이 있을 때(`ready`)는 아무것도 그리지 않는다 */
function PlanNotice(props: {
  readonly view: PlanLoadView;
  readonly onRetry: () => void;
}): ReactNode {
  const { view, onRetry } = props;
  switch (view) {
    case "loading":
      return <Skeleton width="100%" height={28} />;
    case "offline":
      return (
        <Alert tone="neutral" size="sm">
          {t("desktop.work.offline")}
        </Alert>
      );
    case "failed":
      return (
        <Alert
          tone="danger"
          size="sm"
          action={
            <Button size="xs" variant="ghost" onClick={onRetry}>
              {t("desktop.work.retry")}
            </Button>
          }
        >
          {t("desktop.work.plan.load.failed")}
        </Alert>
      );
    case "notFound":
      return (
        <Alert tone="danger" size="sm">
          {t("desktop.work.plan.notFound")}
        </Alert>
      );
    case "ready":
      return null;
    default:
      return assertNever(view, "PlanLoadView");
  }
}

function PlanVersionList(props: { readonly list: PlanVersionListVM }): ReactNode {
  const { list } = props;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ol className="flex min-w-0 flex-col gap-3">
        {list.rows.map((row) => (
          <PlanVersionItem key={row.version} row={row} />
        ))}
      </ol>
      {list.hiddenCount > 0 ? (
        <p className="text-caption text-text-secondary">
          {t("desktop.work.plan.versions.hidden", { count: list.hiddenCount })}
        </p>
      ) : null}
    </div>
  );
}

/** 판 한 줄. 본문은 접힌 글로 보이고, 펼치면 전체 본문과 의견이 보인다 */
function PlanVersionItem(props: { readonly row: PlanVersionRow }): ReactNode {
  const { row } = props;
  const [expanded, setExpanded] = useState(false);
  const body = expanded ? row.body : row.preview;
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-border-subtle p-3">
      <div className="flex flex-wrap items-center gap-2 text-caption text-text-secondary">
        <span>{t("desktop.work.plan.version", { version: row.version })}</span>
        <Badge>{t(row.statusRef.id)}</Badge>
      </div>
      <p className="min-w-0 whitespace-pre-wrap text-body text-text-primary">{row.title}</p>
      {body === "" ? null : (
        <p className="min-w-0 whitespace-pre-wrap text-caption text-text-secondary">{body}</p>
      )}
      {expanded && row.feedback !== null ? (
        <p className="min-w-0 whitespace-pre-wrap text-caption text-text-secondary">
          {t("desktop.work.plan.versions.feedback")}: {row.feedback}
        </p>
      ) : null}
      {row.expandable ? (
        <div>
          <Button
            size="xs"
            variant="ghost"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded(!expanded);
            }}
          >
            {expanded
              ? t("desktop.work.plan.versions.collapse")
              : t("desktop.work.plan.versions.expand")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function NoticeLine(props: {
  readonly notice: WorkNotice;
  readonly onDismiss: () => void;
}): ReactNode {
  return (
    <Alert
      size="sm"
      tone={props.notice.tone}
      dismissible
      dismissLabel={t("desktop.work.dismiss")}
      onDismiss={props.onDismiss}
    >
      {props.notice.text}
    </Alert>
  );
}

/** 목표 상태 배지의 색. 상한에 닿아 멈추면 경고, 판정이 실패해 멈추면 위험으로 가른다(끝난 까닭 문장과 같은 기준) */
function goalToneOf(goal: GoalVM): BadgeTone {
  switch (goal.status) {
    case "active":
      return "info";
    case "met":
      return "success";
    case "exhausted":
      return goal.judged >= goal.maxJudgments ? "warning" : "danger";
    case "cleared":
      return "neutral";
    default:
      return assertNever(goal.status, "GoalVM.status");
  }
}

function GoalPanel(props: {
  readonly state: WorkState;
  readonly live: boolean;
  readonly handlers: WorkHandlers;
}): ReactNode {
  const { state, live, handlers } = props;
  const headingId = useId();
  const goal = state.goal;
  const vm = goal.status === "ready" && goal.value !== null ? goalVMOf(goal.value) : null;
  const writable = live && !state.busy;
  // 진행 중인 목표는 "해제"만 보이고, 끝난 목표나 목표 없음은 걸기 칸이 바로 보인다
  const active = vm !== null && vm.status === "active";
  return (
    <section aria-labelledby={headingId} className="grid gap-1.5">
      <SectionHead
        id={headingId}
        title={t("desktop.work.goal.heading")}
        end={
          active ? (
            <Button size="xs" variant="ghost" disabled={!writable} onClick={handlers.clearGoal}>
              {t("desktop.work.goal.clear")}
            </Button>
          ) : undefined
        }
      />
      {goal.status === "loading" ? <GoalSkeleton /> : null}
      {goal.status === "failed" ? (
        <Alert
          tone="danger"
          size="sm"
          action={
            <Button size="xs" variant="ghost" onClick={handlers.retryGoal}>
              {t("desktop.work.retry")}
            </Button>
          }
        >
          {t("desktop.work.goal.load.failed")}
        </Alert>
      ) : null}
      {goal.status === "ready" ? (
        <div className="grid gap-2.5">
          {vm === null ? null : <GoalSummary goal={vm} />}
          {active ? null : <GoalForm draft={state.draft} writable={writable} handlers={handlers} />}
        </div>
      ) : null}
    </section>
  );
}

function GoalSkeleton(): ReactNode {
  return (
    <div className="grid gap-2" aria-busy>
      <Skeleton width="80%" height={16} />
      <Skeleton width="100%" height={12} />
      <Skeleton width="100%" height={12} />
    </div>
  );
}

/** 목표 한 개: 조건, 상태 배지와 판정 횟수, 마지막 판정(판정 기록 한 줄), 끝난 까닭 */
function GoalSummary(props: { readonly goal: GoalVM }): ReactNode {
  const { goal } = props;
  return (
    <div className="grid gap-1.5">
      <p className="m-0 text-ui-strong text-text-primary">{goal.condition}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui-xs text-text-tertiary">
        <Badge size="xs" className={BADGE_TONE_CLASS[goalToneOf(goal)]}>
          {t(goal.statusRef.id, goal.statusRef.args)}
        </Badge>
        <span className="tabular-nums">
          {t("desktop.work.goal.judged", { judged: goal.judged, max: goal.maxJudgments })}
        </span>
      </div>
      {goal.verdict === null ? null : (
        <Timeline size="sm" aria-label={t("desktop.work.goal.verdicts")}>
          <TimelineItem
            author="system"
            title={t(
              goal.verdict.met
                ? "desktop.work.goal.verdict.met"
                : "desktop.work.goal.verdict.unmet",
            )}
            detail={goal.verdict.reason === "" ? undefined : goal.verdict.reason}
          />
        </Timeline>
      )}
      {goal.endRef === null ? null : (
        <p className="m-0 text-ui-sm font-normal text-text-secondary">
          {t(goal.endRef.id, goal.endRef.args)}
        </p>
      )}
    </div>
  );
}

function GoalForm(props: {
  readonly draft: string;
  readonly writable: boolean;
  readonly handlers: WorkHandlers;
}): ReactNode {
  const { draft, writable, handlers } = props;
  return (
    <form
      className="grid gap-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (writable) handlers.submitGoal();
      }}
    >
      <Field label={t("desktop.work.goal.set.label")} size="sm">
        <Input
          size="sm"
          value={draft}
          disabled={!writable}
          placeholder={t("desktop.work.goal.set.placeholder")}
          onChange={(event) => {
            handlers.draftChange(event.target.value);
          }}
        />
      </Field>
      <div>
        <Button type="submit" size="sm" variant="solid" disabled={!writable}>
          {t("desktop.work.goal.set.submit")}
        </Button>
      </div>
    </form>
  );
}

function TasksPanel(props: {
  readonly state: WorkState;
  readonly handlers: WorkHandlers;
}): ReactNode {
  const { state, handlers } = props;
  const headingId = useId();
  const tasks = state.tasks;
  if (tasks.status === "loading") {
    return (
      <div className="grid gap-2" aria-busy>
        <Skeleton width={64} height={12} />
        <Skeleton width="90%" height={12} />
        <Skeleton width="70%" height={12} />
        <Skeleton width="80%" height={12} />
      </div>
    );
  }
  if (tasks.status === "failed") {
    return (
      <Alert
        tone="danger"
        size="sm"
        action={
          <Button size="xs" variant="ghost" onClick={handlers.retryTasks}>
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
    return (
      <section aria-labelledby={headingId} className="grid gap-1.5">
        <SectionHead id={headingId} title={t("desktop.work.tasks.heading")} />
        <p className="m-0 text-ui-sm font-normal text-text-tertiary">
          {t("desktop.work.tasks.empty")}
        </p>
      </section>
    );
  }
  return <TaskList list={list} doneExpanded={state.doneExpanded} handlers={handlers} />;
}

function TaskList(props: {
  readonly list: TaskListVM;
  readonly doneExpanded: boolean;
  readonly handlers: WorkHandlers;
}): ReactNode {
  const { list, doneExpanded, handlers } = props;
  return (
    <div className="grid gap-1.5">
      <Plan
        bare
        title={t("desktop.work.tasks.heading")}
        // 개수 글은 뺀다(caustic Plan은 countLabel이 필수라 빈 글을 준다)
        countLabel={() => ""}
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
          <Button
            size="xs"
            variant="ghost"
            aria-expanded={doneExpanded}
            iconStart={<ChevronRight className={doneExpanded ? "rotate-90" : undefined} />}
            onClick={handlers.toggleDone}
          >
            {t("desktop.work.tasks.done")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
