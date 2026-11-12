import { Button, IconButton, Progress } from "@caustic/react";
import {
  ChevronDown,
  ChevronUp,
  Circle,
  CircleX,
  Compass,
  ListChecks,
  SquareStack,
  Stop,
  Target,
} from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useContext, useId, useState, type ReactNode } from "react";
import {
  useAgentRows,
  useLeadSegments,
  useNow,
  useOpenThreadId,
} from "../../state/engine/index.ts";
import { ShellStoreContext } from "../../state/shell/index.ts";
import { Presence, SwapFade, useChangedSinceMount } from "../../lib/motion-presets.tsx";
import { Reveal } from "../convo/tool-line.tsx";
import { Aurora, type AuroraState } from "../effects/aurora.tsx";
import { useDoneFlash } from "../effects/beam.tsx";
import { DrawnCheck } from "../effects/drawn-check.tsx";
import { auroraOn } from "../effects/fx-config.ts";
import { LiveDot } from "../effects/live-dot.tsx";
import {
  nowShownOf,
  nowViewOf,
  progressPercentOf,
  type NowAgentView,
  type NowHeadline,
  type NowPulse,
  type NowTaskView,
  type NowView,
} from "./now-model.ts";

// 지금 띠(L4.desktop-ux DP-100 [결정: 2026-11-11 사용자]). 입력창 위 맥락 줄 바로 위에 떠서 "지금 무슨 일을 하는지"를 한 줄로 보인다:
// 지금 할 일(또는 목표), 할 일 진행, 도는 하위 에이전트 수, 주도 중인 플러그인, 기다리는 승인 수. 줄을 누르면 아래로 펼쳐 목표·할 일·에이전트·주도를 보인다.
// 값은 거울의 선택자라 턴이 도는 동안 사건마다 갱신된다. 그릴 것이 없으면 아무것도 그리지 않는다.
// 움직임(dzM2 시안 §7, DP-119): 입력창 위로 8px 올라와 가라앉고(band) 사라질 때 4px 내려가며 나간다. 몸은 높이를 잇고(Reveal),
// 본문 글과 진행 수는 교차 전환, 막대는 caustic Progress 폭 전환, 펼친 목록에서 끝난 할 일은 체크 선이 그려진다.
// 도는 중 표시는 회전 스피너가 아니라 크리스탈 점(LiveDot, DP-127)이다. 오로라 자리(fx-config)가 strip이면 띠 바탕에 오로라가 흐른다(DP-126).

const ICON = "size-3.5 shrink-0";

export function NowStrip(): ReactNode {
  const threadId = useOpenThreadId();
  if (threadId === null) return null;
  return <NowStripFor key={threadId} threadId={threadId} />;
}

function NowStripFor(props: { readonly threadId: ThreadId }): ReactNode {
  const now = useNow(props.threadId);
  const agents = useAgentRows(props.threadId);
  const leads = useLeadSegments(props.threadId);
  const [open, setOpen] = useState(false);
  const shown = nowShownOf(now, agents, leads);
  return (
    // 사라지는 동안에는 마지막으로 그린 띠가 남아 내려간다(Presence가 옛 내용을 든다)
    <Presence show={shown} variant="band" initial={false}>
      {shown ? (
        <NowStripView view={nowViewOf(now, agents, leads)} open={open} onOpenChange={setOpen} />
      ) : null}
    </Presence>
  );
}

function PulseIcon(props: {
  readonly pulse: NowPulse;
  readonly goal: boolean;
  readonly waiting: boolean;
}): ReactNode {
  // 멈춰 있을 때 본문이 목표면 과녁, 아니면 할 일 표시
  if (props.pulse === "idle" && props.goal) {
    return <Target aria-hidden className={`${ICON} text-text-tertiary`} />;
  }
  switch (props.pulse) {
    case "running":
      return <LiveDot state={props.waiting ? "wait" : "run"} />;
    case "stopping":
      return <Stop aria-hidden className={`${ICON} text-warning-text`} />;
    case "idle":
      return <ListChecks aria-hidden className={`${ICON} text-text-tertiary`} />;
    default:
      return assertNever(props.pulse, "NowPulse");
  }
}

function headlineText(headline: NowHeadline): string {
  switch (headline.kind) {
    case "task":
    case "goal":
      return headline.text;
    case "count":
      return t("desktop.now.headline.tasks", { count: headline.count });
    case "agents":
      return t("desktop.now.headline.agents", { count: headline.count });
    case "lead":
      return t("desktop.now.lead.short", { name: headline.name });
    case "stopping":
      return t("desktop.now.headline.stopping");
    default:
      return assertNever(headline, "NowHeadline");
  }
}

/** 접힌 줄 곁 정보(12px tertiary, 가운데 점으로 나눔). 좁은 폭에서는 진행만 남는다(`data-now-meta="extra"`를 컨테이너 쿼리가 숨긴다) */
function MetaLine(props: { readonly view: NowView }): ReactNode {
  const { view } = props;
  const items: { readonly key: string; readonly extra: boolean; readonly node: ReactNode }[] = [];
  const percent = progressPercentOf(view.progress);
  // 목표가 접힌 줄 본문이면 판정 횟수는 이 줄에 붙고 펼친 몸에서는 목표를 되풀이하지 않는다
  const judgment = view.headline.kind === "goal" ? (view.goal?.judgment ?? null) : null;
  if (judgment !== null) {
    items.push({
      key: "judgment",
      extra: false,
      node: t("desktop.now.goal.judgment", judgment),
    });
  }
  if (view.progress !== null && percent !== null) {
    items.push({
      key: "progress",
      extra: false,
      node: (
        <span className="inline-flex items-center gap-1.5">
          <span className="relative">
            <SwapFade
              swapKey={`${String(view.progress.done)}/${String(view.progress.total)}`}
              inline
            >
              {view.progress.done}/{view.progress.total}
            </SwapFade>
          </span>
          <Progress value={percent} decorative size="xs" className="w-10" />
        </span>
      ),
    });
  }
  if (view.runningAgents > 0) {
    items.push({
      key: "agents",
      extra: true,
      node: t("desktop.now.meta.agents", { count: view.runningAgents }),
    });
  }
  if (view.lead !== null && view.headline.kind !== "lead") {
    items.push({
      key: "lead",
      extra: true,
      node: t("desktop.now.lead.short", { name: view.lead.name }),
    });
  }
  if (view.pendingApprovals > 0) {
    items.push({
      key: "approvals",
      extra: false,
      node: (
        <span className="text-warning-text">
          {t("desktop.now.meta.approvals", { count: view.pendingApprovals })}
        </span>
      ),
    });
  }
  if (items.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center text-ui-sm text-text-tertiary tabular-nums">
      {items.map((item) => (
        <span
          key={item.key}
          data-now-meta={item.extra ? "extra" : "main"}
          // 좁은 띠(520 이하)에서는 곁 정보(에이전트, 주도)를 숨기고 진행과 승인만 남긴다
          className={`inline-flex items-center ${item.extra ? "@max-[520px]:hidden" : ""}`}
        >
          <span aria-hidden className="px-2">
            ·
          </span>
          {item.node}
        </span>
      ))}
    </span>
  );
}

/** 띠 오로라의 상태(dzE 시안 §2.4): 승인 대기는 멈춘 맥동, 도는 중은 흐름, 멈추는 중은 잦아듦, 끝나면 한 번 쓸림 */
export function stripAuroraOf(view: Pick<NowView, "pulse" | "pendingApprovals">): AuroraState {
  if (view.pendingApprovals > 0) return "wait";
  if (view.pulse === "running") return "run";
  if (view.pulse === "stopping") return "stop";
  return "off";
}

function StripAurora(props: { readonly view: NowView }): ReactNode {
  const state = useDoneFlash(stripAuroraOf(props.view), "run", "off");
  return <Aurora site="strip" state={state} />;
}

/** 상태 없이 props만 그린다(서버 렌더 시험이 이 부품을 직접 그린다) */
export function NowStripView(props: {
  readonly view: NowView;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactNode {
  const { view, open } = props;
  const bodyId = useId();
  const headline = headlineText(view.headline);
  const toggleLabel = open ? t("desktop.now.collapse") : t("desktop.now.expand");
  return (
    <section
      data-now-strip=""
      aria-label={t("desktop.now.label")}
      className="@container relative isolate mx-3 mb-1.5 overflow-hidden rounded-xl border border-border-subtle bg-surface-raised"
    >
      {auroraOn("strip") ? <StripAurora view={view} /> : null}
      {/* 줄 전체가 펼침 단추다. 끝의 chevron은 같은 동작을 보이는 표시라 따로 탭 순서에 두지 않는다 */}
      <div className="relative flex h-9 min-w-0 items-center gap-2 ps-3 pe-1 hover:bg-neutral-hover">
        <PulseIcon
          pulse={view.pulse}
          goal={view.headline.kind === "goal"}
          waiting={view.pendingApprovals > 0}
        />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 cursor-default items-center border-0 bg-transparent p-0 text-start outline-none focus-visible:focus-ring"
          onClick={() => {
            props.onOpenChange(!open);
          }}
        >
          <span
            data-now-headline=""
            title={headline}
            className={`relative min-w-0 truncate text-ui ${view.headline.kind === "stopping" ? "text-warning-text" : "text-text-primary"}`}
          >
            <SwapFade swapKey={headline} inline>
              {headline}
            </SwapFade>
          </span>
          <MetaLine view={view} />
        </button>
        <IconButton
          size="xs"
          variant="ghost"
          label={toggleLabel}
          tabIndex={-1}
          aria-hidden
          onClick={() => {
            props.onOpenChange(!open);
          }}
        >
          {open ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
        </IconButton>
      </div>
      <Reveal open={open} className="relative">
        <NowBody id={bodyId} view={view} />
      </Reveal>
    </section>
  );
}

function SectionHead(props: { readonly children: ReactNode; readonly end?: ReactNode }): ReactNode {
  return (
    <div className="flex h-6 items-center justify-between gap-2 text-ui-sm text-text-tertiary">
      <h3 className="m-0 text-ui-sm font-normal">{props.children}</h3>
      {props.end === undefined ? null : <span className="tabular-nums">{props.end}</span>}
    </div>
  );
}

function TaskIcon(props: { readonly task: NowTaskView }): ReactNode {
  const { task } = props;
  // 펼친 목록에 있는 동안 끝난 할 일만 체크 선이 그려진다. 처음부터 끝난 할 일은 그대로다
  const changed = useChangedSinceMount(task.status);
  if (task.state === "now") return <LiveDot state="run" />;
  if (task.status === "completed")
    return <DrawnCheck draw={changed} className={`${ICON} text-success-text`} />;
  if (task.status === "failed")
    return <CircleX aria-hidden className={`${ICON} text-danger-text`} />;
  return <Circle aria-hidden className={`${ICON} text-text-tertiary`} />;
}

function taskStateText(task: NowTaskView): string {
  if (task.state === "now") return t("desktop.now.task.now");
  if (task.status === "completed") return t("desktop.now.task.done");
  if (task.status === "failed") return t("desktop.now.task.failed");
  if (task.status === "cancelled") return t("desktop.now.task.cancelled");
  return t("desktop.now.task.todo");
}

function TaskRow(props: { readonly task: NowTaskView }): ReactNode {
  const { task } = props;
  const text = task.state === "now" ? (task.activeForm ?? task.content) : task.content;
  const tone =
    task.state === "now"
      ? "text-text-primary font-medium"
      : task.state === "done"
        ? "text-text-tertiary"
        : "text-text-secondary";
  return (
    <li data-now-task={task.state} className="flex min-h-7 items-center gap-2">
      <TaskIcon task={task} />
      <span className="sr-only">{taskStateText(task)}</span>
      <span
        className={`min-w-0 flex-1 truncate text-ui ${tone} ${task.status === "cancelled" ? "line-through" : ""}`}
        title={text}
      >
        {text}
      </span>
      {task.blocked && task.state === "todo" ? (
        <span className="shrink-0 text-ui-sm text-text-tertiary">
          {t("desktop.now.task.blocked")}
        </span>
      ) : null}
    </li>
  );
}

function agentTailOf(agent: NowAgentView): string {
  if (!agent.running) {
    return agent.status === "completed"
      ? t("desktop.now.agent.done")
      : t("desktop.now.agent.stopped");
  }
  return agent.tool === null
    ? t("desktop.now.agent.steps", { steps: agent.steps })
    : t("desktop.now.agent.tool", { tool: agent.tool, steps: agent.steps });
}

function NowBody(props: { readonly id: string; readonly view: NowView }): ReactNode {
  const { view } = props;
  const shell = useContext(ShellStoreContext);
  return (
    <div
      id={props.id}
      className="grid max-h-60 gap-3 overflow-y-auto border-t border-border-subtle px-3 pt-2 pb-3"
    >
      {view.goal === null || view.headline.kind === "goal" ? null : (
        <section className="grid gap-0.5">
          <SectionHead
            end={
              view.goal.judgment === null
                ? undefined
                : t("desktop.now.goal.judgment", view.goal.judgment)
            }
          >
            {t("desktop.now.goal.heading")}
          </SectionHead>
          <p className="m-0 flex items-start gap-2 text-ui text-text-primary">
            <Target aria-hidden className={`${ICON} mt-0.5 text-text-tertiary`} />
            <span className="line-clamp-2 min-w-0">{view.goal.text}</span>
          </p>
        </section>
      )}
      {view.tasks.length === 0 ? null : (
        <section className="grid">
          <SectionHead
            end={
              view.progress === null ? undefined : `${view.progress.done}/${view.progress.total}`
            }
          >
            {t("desktop.now.tasks.heading")}
          </SectionHead>
          <ul className="m-0 grid list-none p-0">
            {view.tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        </section>
      )}
      {view.agents.length === 0 ? null : (
        <section className="grid">
          <SectionHead end={t("desktop.now.meta.agents", { count: view.runningAgents })}>
            {t("desktop.now.agents.heading")}
          </SectionHead>
          <ul className="m-0 grid list-none p-0">
            {view.agents.map((agent) => (
              <li key={agent.id} className="flex min-h-7 items-center gap-2">
                {agent.running ? (
                  <LiveDot state="run" />
                ) : (
                  <SquareStack aria-hidden className={`${ICON} text-text-tertiary`} />
                )}
                <span className="min-w-0 flex-1 truncate text-ui text-text-primary">
                  {agent.name}
                </span>
                <span className="shrink-0 font-mono text-ui-sm text-text-tertiary tabular-nums">
                  {agentTailOf(agent)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.lead === null ? null : (
        <section className="grid">
          <SectionHead
            end={
              view.lead.maxTurns === null
                ? t("desktop.now.lead.turns", { turns: view.lead.turns })
                : t("desktop.now.lead.turnsOf", {
                    turns: view.lead.turns,
                    max: view.lead.maxTurns,
                  })
            }
          >
            {t("desktop.now.lead.heading")}
          </SectionHead>
          <p className="m-0 flex min-h-7 items-center gap-2 text-ui text-text-primary">
            <Compass aria-hidden className={`${ICON} text-text-tertiary`} />
            {t("desktop.now.lead.long", { name: view.lead.name })}
          </p>
        </section>
      )}
      {shell === null ? null : (
        <div>
          <Button
            size="xs"
            variant="ghost"
            className="-ms-2"
            onClick={() => {
              shell.actions.openEndTab("work", "chat");
            }}
          >
            {t("desktop.now.openWork")}
          </Button>
        </div>
      )}
    </div>
  );
}
