import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { Badge, Button, IconButton, toast } from "@caustic/react";
import { CircleCheck, CircleX, Stop } from "@caustic/react/icons";
import { useMemo, useState, type ReactNode } from "react";
import { useLinkPhase, useOpenThreadId, useRunSources } from "../../../state/engine/index.ts";
import { useShellActions } from "../../../state/shell/index.ts";
import { useClockNow } from "../../approval-card/clock.ts";
import { useCommands } from "../../commands.ts";
import { AttentionMark } from "../../effects/attention-mark.tsx";
import { ProgressOrb } from "../../effects/progress-orb.tsx";
import { tokenCountText } from "../../model-usage.ts";
import { relativeAgeOf } from "../../pages/shared/relative-age.ts";
import { WellEmpty, WellGroup } from "../../pages/shared/well-parts.tsx";
import { useGoToThread } from "../../thread-link.ts";
import { elapsedOf, runBoardOf, type RunBoard, type RunRow } from "./running-model.ts";

// 오른쪽 막대 "실행 중" 탭(DP-196, 탭 id `running`, ⌘⇧R). 돌고 있는 것 전부를 여기서 보고 멈춘다:
// 기다림(승인 대기) · 도는 중(대화의 턴, 하위 에이전트, 예약 실행) · 방금 끝남(2분). 줄을 누르면 그 기록(대화)으로 간다.
// 백그라운드 셸 명령은 엔진이 알려 주지 않아 없다([제안] process.* wire, 시안 dzR4 §8).

export interface RunHandlers {
  readonly open: ((threadId: string) => void) | null;
  readonly answer: () => void;
  readonly stop: (threadId: string) => void;
  readonly stopping: ReadonlySet<string>;
  /** 연결이 살아 있어 멈출 수 있나 */
  readonly live: boolean;
}

export function RunningTab(): ReactNode {
  const sources = useRunSources();
  const openId = useOpenThreadId();
  const now = useClockNow();
  const board = useMemo(() => runBoardOf(sources, openId, now), [sources, openId, now]);
  const commands = useCommands();
  const goTo = useGoToThread();
  const shell = useShellActions();
  const live = useLinkPhase() === "live";
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const handlers: RunHandlers = {
    open: goTo,
    answer: () => {
      shell.openEndTab("inbox");
    },
    stop: (threadId) => {
      const run = sources.find((source) => source.summary.threadId === threadId);
      if (run === undefined) return;
      setStopping((prev) => new Set([...prev, threadId]));
      const stopRun = async (): Promise<void> => {
        const done = await commands.interrupt(run.summary.threadId);
        if (!done.ok) toast({ tone: "danger", title: t("desktop.running.stopFailed") });
        setStopping((prev) => {
          const next = new Set(prev);
          next.delete(threadId);
          return next;
        });
      };
      detach(stopRun(), rethrow);
    },
    stopping,
    live,
  };
  return <RunBoardView board={board} now={now} handlers={handlers} />;
}

export function RunBoardView(props: {
  readonly board: RunBoard;
  readonly now: number;
  readonly handlers: RunHandlers;
}): ReactNode {
  const { board, now, handlers } = props;
  if (board.waiting.length + board.running.length + board.finished.length === 0) {
    return (
      <WellEmpty
        title={t("desktop.running.empty.title")}
        description={t("desktop.running.empty.description")}
      />
    );
  }
  return (
    <div className="grid gap-3">
      {board.waiting.length === 0 ? null : (
        <WellGroup title={t("desktop.running.group.waiting")} count={board.waitingCount}>
          <RunRows rows={board.waiting} now={now} handlers={handlers} />
        </WellGroup>
      )}
      {board.running.length === 0 ? null : (
        <WellGroup title={t("desktop.running.group.running")} count={board.runningCount}>
          <RunRows rows={board.running} now={now} handlers={handlers} />
        </WellGroup>
      )}
      {board.finished.length === 0 ? null : (
        <WellGroup
          title={t("desktop.running.group.finished")}
          end={
            <span className="text-ui-sm font-normal text-text-tertiary">
              {t("desktop.running.finishedHint")}
            </span>
          }
        >
          <RunRows rows={board.finished} now={now} handlers={handlers} />
        </WellGroup>
      )}
    </div>
  );
}

function RunRows(props: {
  readonly rows: readonly RunRow[];
  readonly now: number;
  readonly handlers: RunHandlers;
}): ReactNode {
  return (
    <ul className="m-0 grid list-none p-0">
      {props.rows.map((row) => (
        <RunRowView key={row.threadId} row={row} now={props.now} handlers={props.handlers} />
      ))}
    </ul>
  );
}

function RunIcon(props: { readonly row: RunRow }): ReactNode {
  const { row } = props;
  if (row.state === "waiting") return <AttentionMark />;
  if (row.state === "running") return <ProgressOrb />;
  return row.outcome === "completed" ? (
    <CircleCheck aria-hidden className="size-icon-sm text-success-text" />
  ) : (
    <CircleX
      aria-hidden
      className={`size-icon-sm ${row.outcome === "failed" ? "text-danger-text" : "text-text-tertiary"}`}
    />
  );
}

function stateText(row: RunRow): string {
  if (row.state === "waiting") return t("desktop.running.state.waiting");
  if (row.state === "running") return t("desktop.running.state.running");
  if (row.outcome === "failed") return t("desktop.running.outcome.failed");
  if (row.outcome === "interrupted") return t("desktop.running.outcome.interrupted");
  return t("desktop.running.outcome.completed");
}

/** 둘째 줄: 무엇을 하는지(마지막 동작) · 얼마나 됐는지 */
function metaOf(row: RunRow, now: number): string {
  const parts: string[] = [];
  if (row.parentTitle !== null) parts.push(t("desktop.running.parent", { title: row.parentTitle }));
  if (row.state === "waiting") {
    parts.push(t("desktop.running.waitingFor", { count: row.approvals }));
  } else if (row.state === "running") {
    if (row.tool !== null) parts.push(t("desktop.running.tool", { tool: row.tool }));
    if (row.steps > 0) parts.push(t("desktop.now.agent.steps", { steps: row.steps }));
  } else {
    parts.push(stateText(row));
    if (row.tokens !== null) {
      parts.push(t("desktop.running.tokens", { tokens: tokenCountText(row.tokens) }));
    }
  }
  if (row.state === "finished") {
    const age = relativeAgeOf(row.sinceMs, now);
    parts.push(t(age.id, age.args));
  } else {
    const elapsed = elapsedOf(row.sinceMs, now);
    parts.push(
      elapsed.unit === "justNow"
        ? t("desktop.running.elapsed.justNow")
        : elapsed.unit === "minutes"
          ? t("desktop.running.elapsed.minutes", { count: elapsed.count })
          : t("desktop.running.elapsed.hours", { count: elapsed.count }),
    );
  }
  return parts.join(" · ");
}

/** 대화 한 줄(44): 상태 표시 16 · 이름 13/500 + 출처 칩 / 둘째 줄 12 tertiary · 동작 둘까지(xs 24). 자식은 세로선 아래 들여 쓴다 */
function RunRowView(props: {
  readonly row: RunRow;
  readonly now: number;
  readonly handlers: RunHandlers;
}): ReactNode {
  const { row, now, handlers } = props;
  const name = row.agentName ?? row.title ?? t("desktop.approvals.card.thread.untitled");
  const stopping = handlers.stopping.has(row.threadId);
  const open = handlers.open;
  return (
    <li data-run={row.state} className="grid min-w-0">
      <div className="flex min-h-11 min-w-0 items-center gap-2 py-1">
        <span className="grid size-icon-md flex-none place-items-center">
          <RunIcon row={row} />
        </span>
        <span className="sr-only">{stateText(row)}</span>
        <div className="grid min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-ui font-medium text-text-primary" title={name}>
              {name}
            </span>
            {row.background ? (
              <Badge size="xs">{t("desktop.running.chip.background")}</Badge>
            ) : null}
            {row.origin === "schedule" ? (
              <Badge size="xs">{t("desktop.running.chip.schedule")}</Badge>
            ) : null}
            {row.origin === "remote" ? (
              <Badge size="xs">{t("desktop.running.chip.remote")}</Badge>
            ) : null}
          </div>
          <span className="truncate text-ui-sm font-normal text-text-tertiary">
            {metaOf(row, now)}
          </span>
        </div>
        <div className="flex flex-none items-center gap-1">
          {row.state === "waiting" ? (
            <Button size="xs" variant="outline" onClick={handlers.answer}>
              {t("desktop.running.answer")}
            </Button>
          ) : null}
          {row.state !== "waiting" && open !== null ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                open(row.threadId);
              }}
            >
              {row.state === "finished" ? t("desktop.running.record") : t("desktop.running.open")}
            </Button>
          ) : null}
          {row.state === "running" ? (
            <IconButton
              size="xs"
              variant="ghost"
              label={stopping ? t("desktop.running.stopping") : t("desktop.running.stop")}
              disabled={stopping || !handlers.live}
              onClick={() => {
                handlers.stop(row.threadId);
              }}
            >
              <Stop />
            </IconButton>
          ) : null}
        </div>
      </div>
      {row.children.length === 0 ? null : (
        <ul className="m-0 ms-2 grid list-none border-s border-border-subtle p-0 ps-3">
          {row.children.map((child) => (
            <RunRowView key={child.threadId} row={child} now={now} handlers={handlers} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** well 머리 요약(DP-193): "2개 도는 중 · 1개 기다림" */
export function RunningSummary(): ReactNode {
  const sources = useRunSources();
  const openId = useOpenThreadId();
  const now = useClockNow();
  const board = useMemo(() => runBoardOf(sources, openId, now), [sources, openId, now]);
  const parts: string[] = [];
  if (board.runningCount > 0)
    parts.push(t("desktop.running.summary.running", { count: board.runningCount }));
  if (board.waitingCount > 0)
    parts.push(t("desktop.running.summary.waiting", { count: board.waitingCount }));
  return parts.length === 0 ? null : parts.join(" · ");
}
