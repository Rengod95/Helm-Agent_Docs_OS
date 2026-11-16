import { Button } from "@caustic/react";
import { Circle, CircleCheck, CircleDot, CircleX, Diamond } from "@caustic/react/icons";
import { assertNever } from "@fresnel/contracts";
import { t } from "@fresnel/client/i18n";
import type { ItemId, JsonObject, ThreadId } from "@fresnel/contracts/conversation";
import type { ReactNode } from "react";
import { useAgentRows, useToolResult } from "../../state/engine/index.ts";
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
import { Collapse } from "../../lib/motion-presets.tsx";
import { checklistOf, type ChecklistRow, type TaskOp } from "./task-checklist-model.ts";
import { failureLabelOf } from "./tool-view-model.ts";
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

/** 할 일 갱신(DP-143): 머리 줄(그 시점 진행 n/m) + 그 시점 전체 목록, 이번 호출이 바꾼 줄은 진하게 */
function TaskChecklist(props: {
  readonly threadId: ThreadId;
  readonly itemId: ItemId;
  readonly call: CallBlock;
}): ReactNode {
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
  return <TaskChecklistView call={props.call} ops={summary.items} />;
}

function TaskRow(props: { readonly row: ChecklistRow }): ReactNode {
  const { row } = props;
  return (
    <li
      className="convo-task"
      data-changed={row.changed ? "true" : "false"}
      data-status={row.status ?? "pending"}
    >
      <TaskGlyph status={row.status} />
      <span className="min-w-0">{row.content}</span>
    </li>
  );
}

function TaskChecklistView(props: {
  readonly call: CallBlock;
  readonly ops: readonly TaskOp[];
}): ReactNode {
  const result = useToolResult(props.call.callId);
  const running = useCallRunning();
  const view = resultViewOf(result);
  const [foldOpen, toggleFold] = useDisclosure(false);
  const list = checklistOf(
    props.ops,
    view !== null && view.outcome.kind === "done" ? view.output : null,
  );
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
          list.progress === null || list.progress.total === 0
            ? null
            : t("desktop.convo.tasks.progress", {
                done: list.progress.done,
                total: list.progress.total,
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
        {list.rows.map((row) => (
          <TaskRow key={row.key} row={row} />
        ))}
      </ul>
      {list.folded.length === 0 ? null : (
        <>
          <Collapse open={foldOpen}>
            <ul className="convo-tasks">
              {list.folded.map((row) => (
                <TaskRow key={row.key} row={row} />
              ))}
            </ul>
          </Collapse>
          <Button
            variant="ghost"
            size="xs"
            className="convo-tasks-more"
            aria-expanded={foldOpen}
            onClick={toggleFold}
          >
            {foldOpen
              ? t("desktop.convo.tasks.foldClose")
              : t("desktop.convo.tasks.foldOpen", { count: list.folded.length })}
          </Button>
        </>
      )}
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
