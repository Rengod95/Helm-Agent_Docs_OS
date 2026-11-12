import { Badge, Button } from "@caustic/react";
import { Circle, CircleCheck, CircleDot, CircleX, Diamond } from "@caustic/react/icons";
import { assertNever } from "@fresnel/contracts";
import { t, type MessageId } from "@fresnel/client/i18n";
import type { ItemId, JsonObject, ThreadId } from "@fresnel/contracts/conversation";
import type { ReactNode } from "react";
import { useShellActions } from "../../state/shell/index.ts";
import { useAgentRows, useNow, useToolResult } from "../../state/engine/index.ts";
import type { AgentRow } from "../../state/engine/index.ts";
import { summarizeToolArgs } from "../../state/engine/tool-summary.ts";
import { toolRowModeOf } from "../item-detail-model.ts";
import { useGoToThread } from "../thread-link.ts";
import { agentHeadOf, agentResultOf, reportFoldOf } from "../tool-extras-model.ts";
import { useTranscriptDetail } from "../transcript-detail.ts";
import { MarkdownBody } from "./markdown-body.tsx";
import {
  CallRow,
  OutputBox,
  lineStatusOf,
  resultViewOf,
  rowStatusOf,
  useCallRunning,
  useElapsedSeconds,
} from "./tool-call-row.tsx";
import { CallChip } from "../call-chip.tsx";
import { ToolLine, useDisclosure, type LineStatus } from "./tool-line.tsx";
import { failureLabelOf, planArgsOf, planResultOf, type PlanState } from "./tool-view-model.ts";
import type { CallBlock } from "../transcript-rows.ts";

// 결과물 도구의 카드(dzT2a 시안 3.4, 3.5, 3.7). 묶음에 넣지 않고 늘 보인다.

function StatusText(props: { readonly status: LineStatus }): ReactNode {
  const { status } = props;
  switch (status.kind) {
    case "running":
      // 도는 중은 도구 줄과 같은 칩(테두리 beam, DP-127)
      return <CallChip status="running" label={status.label} waiting={status.awaiting} />;
    case "failed":
      return (
        <span
          className={
            status.failure === "failed"
              ? "text-footnote text-danger-text"
              : "text-footnote text-text-tertiary"
          }
        >
          {failureLabelOf(status.failure)}
        </span>
      );
    case "done":
      return (
        <span className="text-footnote text-success-text">{t("desktop.convo.agent.done")}</span>
      );
    case "none":
      return null;
    default:
      return assertNever(status, "AgentStatus");
  }
}

/** 이 호출이 띄운 하위 에이전트 기록. requestId는 `tool:<호출 id>:spawn:N`이다(core-agents tool.ts) */
function agentRowOf(rows: readonly AgentRow[], callId: string): AgentRow | undefined {
  return rows.find((row) => row.agent.requestId.startsWith(`tool:${callId}:`));
}

function AgentCard(props: {
  readonly threadId: ThreadId;
  readonly callId: string;
  readonly args: JsonObject;
}): ReactNode {
  const result = useToolResult(props.callId);
  const running = useCallRunning();
  const rows = useAgentRows(props.threadId);
  const goTo = useGoToThread();
  const detailSetting = useTranscriptDetail();
  const view = resultViewOf(result);
  const seconds = useElapsedSeconds(view === null && running);
  const status = lineStatusOf({
    outcome: view?.outcome ?? null,
    running,
    awaiting: false,
    seconds,
  });
  const [open, toggle] = useDisclosure(false);
  if (toolRowModeOf(detailSetting, rowStatusOf(status)) === "hidden") return null;
  const record = agentRowOf(rows, props.callId);
  const summary = summarizeToolArgs("agent", props.args);
  const name = summary.kind === "agent" ? summary.agent : agentHeadOf(props.args);
  const task = summary.kind === "agent" ? summary.task : "";
  const parsed =
    result?.kind === "toolResult"
      ? agentResultOf(view?.output ?? "", result.message.details, result.message.isError)
      : null;
  const childId = parsed?.childThreadId ?? record?.agent.childThreadId ?? null;
  const fold = parsed === null || parsed.outcome === "aborted" ? null : reportFoldOf(parsed.body);
  const progress = record?.progress ?? null;
  const limit = record?.agent.limitHit ?? null;
  return (
    <section
      className="convo-card"
      data-slot="convo-agent"
      aria-label={t("desktop.convo.agent.title")}
    >
      <div className="convo-card-head">
        <Diamond aria-hidden className="convo-line-icon text-agent-text" />
        <span className="text-ui-strong text-text-primary">{t("desktop.convo.agent.title")}</span>
        {name === "" ? null : (
          <span className="convo-mono min-w-0 truncate text-text-tertiary">{name}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <StatusText status={status} />
        </span>
      </div>
      {task === "" ? null : <p className="convo-card-text">{task}</p>}
      {status.kind === "running" ? (
        <p className="m-0 flex items-center gap-1.5 text-footnote text-text-tertiary">
          {progress === null
            ? t("desktop.convo.agent.starting")
            : progress.currentTool === null
              ? t("desktop.convo.agent.steps", { steps: progress.steps })
              : t("desktop.convo.agent.now", { tool: progress.currentTool, steps: progress.steps })}
        </p>
      ) : null}
      {limit === null ? null : (
        <p className="convo-note" data-tone="warning">
          {t(
            limit === "steps"
              ? "desktop.convo.agent.limitSteps"
              : "desktop.convo.agent.limitTokens",
          )}
        </p>
      )}
      {fold === null || fold.head.trim() === "" ? null : (
        <div className="text-text-secondary">
          <MarkdownBody
            text={open || fold.rest === null ? (parsed?.body ?? "") : fold.head}
            size="compact"
          />
        </div>
      )}
      {parsed !== null && parsed.outcome === "error" && fold === null ? (
        <OutputBox text={view?.output ?? ""} tone="danger" />
      ) : null}
      {(fold?.rest ?? null) === null && (childId === null || goTo === null) ? null : (
        <div className="convo-card-foot">
          {fold?.rest === null || fold === null ? null : (
            <Button size="xs" variant="ghost" aria-expanded={open} onClick={toggle}>
              {open ? t("desktop.convo.collapse") : t("desktop.item.agent.more")}
            </Button>
          )}
          {childId === null || goTo === null ? null : (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                goTo(childId);
              }}
            >
              {t("desktop.item.agent.openChild")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

const PLAN_STATE: Readonly<
  Record<PlanState, { readonly label: MessageId; readonly className: string }>
> = {
  pending: { label: "desktop.convo.plan.pending", className: "text-text-tertiary" },
  approved: { label: "desktop.convo.plan.approved", className: "text-success-text" },
  rejected: { label: "desktop.convo.plan.rejected", className: "text-danger-text" },
  revise: { label: "desktop.convo.plan.revise", className: "text-warning-text" },
};

function PlanCard(props: { readonly callId: string; readonly args: JsonObject }): ReactNode {
  const result = useToolResult(props.callId);
  const running = useCallRunning();
  const shell = useShellActions();
  const [open, toggle] = useDisclosure(false);
  const view = resultViewOf(result);
  const plan = planArgsOf(props.args);
  const state = view?.outcome.kind === "done" ? planResultOf(view.output) : null;
  const status = lineStatusOf({
    outcome: view?.outcome ?? null,
    running,
    awaiting: false,
    seconds: 0,
  });
  return (
    <section
      className="convo-card"
      data-slot="convo-plan"
      aria-label={t("desktop.convo.plan.title")}
    >
      <div className="convo-card-head">
        <Badge size="xs">{t("desktop.convo.plan.title")}</Badge>
        <span className="convo-card-title">
          {plan.title === "" ? t("desktop.convo.plan.untitled") : plan.title}
        </span>
        {state === null ? null : (
          <span className="convo-mono text-text-tertiary">v{state.version}</span>
        )}
        <span className="ml-auto">
          {state === null ? (
            <StatusText status={status.kind === "done" ? { kind: "none" } : status} />
          ) : (
            <span className={`text-footnote ${PLAN_STATE[state.state].className}`}>
              {t(PLAN_STATE[state.state].label)}
            </span>
          )}
        </span>
      </div>
      {plan.body === "" ? null : (
        <div className="convo-clip text-text-secondary" data-open={open ? "true" : "false"}>
          <MarkdownBody text={plan.body} size="compact" />
        </div>
      )}
      {view?.outcome.kind === "failed" ? <OutputBox text={view.output} /> : null}
      <div className="convo-card-foot">
        {plan.body === "" ? null : (
          <Button size="xs" variant="ghost" aria-expanded={open} onClick={toggle}>
            {open ? t("desktop.convo.collapse") : t("desktop.convo.plan.full")}
          </Button>
        )}
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            shell.openEndTab("work");
          }}
        >
          {t("desktop.convo.plan.openWork")}
        </Button>
      </div>
    </section>
  );
}

function TaskGlyph(props: { readonly status: string | null }): ReactNode {
  // 상태는 할 일 기록의 글이다(모르는 값은 아직 안 한 것으로 본다)
  if (props.status === "completed") {
    return <CircleCheck aria-hidden className="convo-task-glyph text-success-text" />;
  }
  if (props.status === "in_progress") {
    return <CircleDot aria-hidden className="convo-task-glyph text-accent-text" />;
  }
  if (props.status === "failed" || props.status === "cancelled") {
    return <CircleX aria-hidden className="convo-task-glyph text-text-tertiary" />;
  }
  return <Circle aria-hidden className="convo-task-glyph text-text-tertiary" />;
}

/** 할 일 갱신: 머리 줄 + 이번 호출이 바꾼 항목 */
function TaskChecklist(props: {
  readonly threadId: ThreadId;
  readonly itemId: ItemId;
  readonly call: CallBlock;
}): ReactNode {
  const now = useNow(props.threadId);
  const summary = summarizeToolArgs(props.call.name, props.call.args);
  if (summary.kind !== "tasks") {
    return (
      <CallRow
        threadId={props.threadId}
        itemId={props.itemId}
        callId={props.call.callId}
        name={props.call.name}
        args={props.call.args}
      />
    );
  }
  const byId = new Map(now.tasks.map((task) => [task.id, task]));
  const rows = summary.items.flatMap((op, index) => {
    if (op.op === "link" || op.op === "unlink") return [];
    const known = op.ref === null ? undefined : byId.get(op.ref);
    const content = op.content ?? known?.content ?? op.ref ?? "";
    return [
      {
        key: `${index}:${op.ref ?? content}`,
        content,
        status: op.status ?? known?.status ?? null,
        created: op.op === "create",
      },
    ];
  });
  return (
    <TaskChecklistView
      threadId={props.threadId}
      itemId={props.itemId}
      call={props.call}
      progress={now.progress}
      rows={rows}
    />
  );
}

function TaskChecklistView(props: {
  readonly threadId: ThreadId;
  readonly itemId: ItemId;
  readonly call: CallBlock;
  readonly progress: { readonly done: number; readonly total: number };
  readonly rows: readonly {
    readonly key: string;
    readonly content: string;
    readonly status: string | null;
    readonly created: boolean;
  }[];
}): ReactNode {
  const result = useToolResult(props.call.callId);
  const running = useCallRunning();
  const view = resultViewOf(result);
  const status = lineStatusOf({
    outcome: view?.outcome ?? null,
    running,
    awaiting: false,
    seconds: 0,
  });
  return (
    <div className="grid min-w-0" data-slot="convo-tasks">
      <ToolLine
        icon="tasks"
        verb={t("desktop.convo.tool.tasks")}
        target={{ kind: "none" }}
        meta={
          props.progress.total === 0
            ? null
            : t("desktop.convo.tasks.progress", {
                done: props.progress.done,
                total: props.progress.total,
              })
        }
        status={status.kind === "done" ? { kind: "none" } : status}
        {...(view?.outcome.kind === "failed"
          ? {
              below: (
                <div className="convo-detail">
                  <OutputBox text={view.output} />
                </div>
              ),
            }
          : {})}
      />
      <ul className="convo-tasks">
        {props.rows.map((row) => (
          <li
            key={row.key}
            className="convo-task"
            data-changed="true"
            data-status={row.status ?? "pending"}
          >
            <TaskGlyph status={row.status} />
            <span className="min-w-0">{row.content}</span>
            {row.created ? <Badge size="xs">{t("desktop.convo.tasks.new")}</Badge> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 카드 줄 하나: 도구 이름으로 고른다 */
export function CardRow(props: {
  readonly threadId: ThreadId;
  readonly itemId: ItemId;
  readonly call: CallBlock;
}): ReactNode {
  // 도구 이름은 열린 글이다. 카드 도구가 아니면 보통 도구 줄이다
  const name = props.call.name;
  if (name === "agent") {
    return (
      <AgentCard threadId={props.threadId} callId={props.call.callId} args={props.call.args} />
    );
  }
  if (name === "submit_plan") return <PlanCard callId={props.call.callId} args={props.call.args} />;
  if (name === "task_write") {
    return <TaskChecklist threadId={props.threadId} itemId={props.itemId} call={props.call} />;
  }
  return (
    <CallRow
      threadId={props.threadId}
      itemId={props.itemId}
      callId={props.call.callId}
      name={props.call.name}
      args={props.call.args}
    />
  );
}
