import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { Alert, Badge, Button, Input, Skeleton } from "@caustic/react";
import { Target } from "@caustic/react/icons";
import { useId, type ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import { goalVMOf, type GoalVM, type WorkNotice, type WorkState } from "./work-model.ts";

// 작업 탭(P-14, DP-195)의 목표 그림과 작업 판 자리. 상태와 동작은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 위에서 아래로: 목표 띠(있으면 조건·판정·해제, 없으면 걸기 한 줄) · 작업 판(`tasks`, 거울에서 그린다).
// 목표 걸기와 해제는 `work-screen.tsx`가 `/goal` 줄로 보낸다.
// 연결이 없으면 마지막으로 읽은 값을 흐리게 두고 쓰기 단추만 잠근다(mockups/d03 P-14 D-offline).

export interface WorkHandlers {
  readonly draftChange: (draft: string) => void;
  readonly submitGoal: () => void;
  readonly clearGoal: () => void;
  readonly retryGoal: () => void;
  readonly dismissNotice: () => void;
}

export interface WorkViewProps {
  readonly state: WorkState;
  readonly live: boolean;
  readonly handlers: WorkHandlers;
  /** 작업 판(거울에서 그린다). 목표·계획 아래에 놓인다 */
  readonly tasks: ReactNode;
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
  const { state, live, handlers } = props;
  return (
    <div className="grid gap-3">
      {live ? null : (
        <Alert tone="neutral" size="sm">
          {t("desktop.work.offline")}
        </Alert>
      )}
      {state.notice === null ? null : (
        <NoticeLine notice={state.notice} onDismiss={handlers.dismissNotice} />
      )}
      <div className={live ? "grid gap-3" : "grid gap-3 opacity-60"}>
        <GoalPanel state={state} live={live} handlers={handlers} />
      </div>
      {props.tasks}
    </div>
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
  // 진행 중인 목표는 "해제"만 보이고, 끝난 목표나 목표 없음은 걸기 한 줄이 바로 보인다
  const active = vm !== null && vm.status === "active";
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-1.5 rounded-xl border border-border-subtle bg-surface-base px-3 py-2.5"
    >
      <div className="flex h-6 min-w-0 items-center gap-1.5">
        <Target aria-hidden className="size-icon-sm flex-none text-text-tertiary" />
        <h3 id={headingId} className="m-0 flex items-center gap-1 text-ui-sm text-text-tertiary">
          {t("desktop.work.goal.heading")}
          {active ? null : <InfoTip text={t("desktop.work.goal.info")} />}
        </h3>
        {vm === null || active ? null : (
          <Badge size="xs" className={BADGE_TONE_CLASS[goalToneOf(vm)]}>
            {t(vm.statusRef.id, vm.statusRef.args)}
          </Badge>
        )}
        <span className="flex-1" />
        {vm === null ? null : (
          <span className="flex-none text-ui-sm font-normal tabular-nums text-text-tertiary">
            {t("desktop.work.goal.judged", { judged: vm.judged, max: vm.maxJudgments })}
          </span>
        )}
        {active ? (
          <Button size="xs" variant="ghost" disabled={!writable} onClick={handlers.clearGoal}>
            {t("desktop.work.goal.clear")}
          </Button>
        ) : null}
      </div>
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
        <>
          {vm === null ? null : <GoalSummary goal={vm} />}
          {active ? null : <GoalForm draft={state.draft} writable={writable} handlers={handlers} />}
        </>
      ) : null}
    </section>
  );
}

function GoalSkeleton(): ReactNode {
  return (
    <div className="grid gap-1.5" aria-busy>
      <Skeleton width="80%" height={14} />
      <Skeleton width="50%" height={12} />
    </div>
  );
}

/** 목표 한 개: 조건(13/500, 세 줄까지), 마지막 판정 한 줄, 끝난 까닭 */
function GoalSummary(props: { readonly goal: GoalVM }): ReactNode {
  const { goal } = props;
  const verdict =
    goal.verdict === null
      ? null
      : t(goal.verdict.met ? "desktop.work.goal.verdict.met" : "desktop.work.goal.verdict.unmet");
  return (
    <>
      <p className="m-0 line-clamp-3 text-ui font-medium text-text-primary" title={goal.condition}>
        {goal.condition}
      </p>
      {verdict === null || goal.verdict === null ? null : (
        <p
          aria-label={t("desktop.work.goal.verdicts")}
          className="m-0 line-clamp-2 text-ui-sm font-normal text-text-secondary"
        >
          {goal.verdict.reason === "" ? verdict : `${verdict} · ${goal.verdict.reason}`}
        </p>
      )}
      {goal.endRef === null ? null : (
        <p className="m-0 text-ui-sm font-normal text-text-secondary">
          {t(goal.endRef.id, goal.endRef.args)}
        </p>
      )}
    </>
  );
}

/** 목표 걸기 한 줄: 입력(sm 28, 남는 폭) + 단추(sm 28). 같은 높이로 한 줄에 선다(폼 표준 §1) */
function GoalForm(props: {
  readonly draft: string;
  readonly writable: boolean;
  readonly handlers: WorkHandlers;
}): ReactNode {
  const { draft, writable, handlers } = props;
  return (
    <form
      className="flex min-w-0 items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (writable) handlers.submitGoal();
      }}
    >
      <Input
        size="sm"
        value={draft}
        disabled={!writable}
        aria-label={t("desktop.work.goal.set.label")}
        placeholder={t("desktop.work.goal.set.placeholder")}
        containerClassName="min-w-0 flex-1"
        onChange={(event) => {
          handlers.draftChange(event.target.value);
        }}
      />
      <Button type="submit" size="sm" variant="outline" disabled={!writable}>
        {t("desktop.work.goal.set.submit")}
      </Button>
    </form>
  );
}
