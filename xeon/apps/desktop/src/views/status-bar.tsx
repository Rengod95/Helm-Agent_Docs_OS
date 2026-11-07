import { Button, Progress } from "@caustic/react";
import { Layers, Link2, Sparkles, TriangleAlert } from "@caustic/react/icons";
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  startupFailureOfExitCode,
  storeFailureOfExitCode,
  type StatusItemRecord,
} from "@fresnel/contracts/records";
import type { ExtUiEntry, ThreadSummary, WireResult } from "@fresnel/contracts/wire";
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { nativeEntriesOf, originTitleOf } from "../plugin-ui/placements.ts";
import {
  useApprovalCount,
  useEngineState,
  useLinkBanner,
  useLinkPhase,
  useRunningCount,
  useStatusItems,
  useThreadRunning,
  useThreadSummaries,
  useTurnFailures,
  type EngineState,
  type Link,
} from "../state/engine/index.ts";
import { ShellStoreContext } from "../state/shell/index.ts";
import {
  useCommandRuns,
  useConnectError,
  useEngineTarget,
  useRestartNeeded,
  useSelectedThreadId,
  type EngineTargetView,
} from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";
import { engineGoneOf } from "./composer-model.ts";
import {
  modelLabelOf,
  tokenCountText,
  useDefaultModel,
  useSessionUsage,
  useThreadModel,
  type SessionUsage,
} from "./model-usage.ts";
import { EntrySurface, screenKeyOf } from "./plugin/plugin-view.tsx";
import { usePluginUi, usePluginUiState } from "./plugin/plugin-context.tsx";
import { RestartLine } from "./restart-line.tsx";
import { UsageBreakdownBody } from "./usage-breakdown.tsx";
import { SafeModeChip } from "./safe-mode-chip.tsx";
import { StatusCell, type StatusDot } from "./status-cell.tsx";
import { statusItemText } from "./status-item-text.ts";
import { useGoToThread, type GoToThread } from "./thread-link.ts";
import { useUpdate } from "./update-context.ts";
import type { UpdateController } from "./update-controller.ts";
import {
  needsRunningConfirm,
  progressPercentOf,
  retryStepOf,
  shouldAutoInstall,
  updateCellOf,
  updateDescriptionOf,
} from "./update-model.ts";
import { UpdateBody, UpdateRestartDialog } from "./update-parts.tsx";

const LINK_TEXT: Readonly<Record<Link["phase"], MessageId>> = {
  offline: "desktop.status.link.offline",
  connecting: "desktop.status.link.connecting",
  syncing: "desktop.status.link.syncing",
  live: "desktop.status.link.live",
  resync: "desktop.status.link.resync",
  reset: "desktop.status.link.reset",
  failed: "desktop.status.link.failed",
};

const ENGINE_TEXT: Readonly<Record<EngineState["kind"], MessageId>> = {
  starting: "desktop.status.engine.starting",
  running: "desktop.status.engine.running",
  restarting: "desktop.status.engine.restarting",
  stopping: "desktop.status.engine.stopping",
  failed: "desktop.status.engine.failed",
  stopped: "desktop.status.engine.stopped",
};

/** 실행 중인 엔진이 어디서 도는지. sidecar는 앱이 띄운 자식이고 service는 `fresnel service`다 */
const SOURCE_TEXT: Readonly<Record<"sidecar" | "service", MessageId>> = {
  sidecar: "desktop.status.engine.sourceEmbedded",
  service: "desktop.status.engine.sourceService",
};

const STORE_FAILURE_TEXT: Readonly<
  Record<NonNullable<ReturnType<typeof storeFailureOfExitCode>>, MessageId>
> = {
  future_version: "desktop.status.engine.storeFutureVersion",
  corrupt: "desktop.status.engine.storeCorrupt",
  migration_failed: "desktop.status.engine.storeMigrationFailed",
};

/** 저장소를 열지 못해 끝난 엔진은 분류별 안내를 보인다(종료 코드 70~72). 그 밖의 종료는 일반 문구다 */
export function engineTextOf(state: EngineState | null | undefined): MessageId {
  if (state === undefined || state === null) return "desktop.status.engine.checking";
  if (state.kind === "failed" || state.kind === "restarting") {
    const failure = storeFailureOfExitCode(state.lastExit.code);
    if (failure !== undefined) return STORE_FAILURE_TEXT[failure];
    // 사용자가 폴더 권한을 줄여 고칠 수 있는 시작 실패는 이유와 다음 할 일을 한 줄로 보인다(rtE R-9)
    if (startupFailureOfExitCode(state.lastExit.code) === "data_dir_permission") {
      return "desktop.status.engine.dataDirPermission";
    }
  }
  return ENGINE_TEXT[state.kind];
}

/**
 * 확장의 상태 칸. 열린 대화가 있을 때만 그린다(ADR-0021 §3.2). 꺼졌거나 안전 모드인 확장의 칸은 그리지 않는다.
 * 칸 앞에 셸이 확장 이름을 그린다(보고 2). 칸 하나는 선언형 트리를 좁은 자리에 담고 글이 넘치면 줄인다.
 * `NativeTree`에는 읽기 전용 모드가 없어 트리의 버튼과 입력은 그대로 대화형이다. 같은 실행기와 확인 줄을 거친다
 */
function StatusCells(): ReactNode {
  const plugin = usePluginUiState();
  const threadId = useSelectedThreadId();
  if (threadId === null) return null;
  return nativeEntriesOf(plugin.groups.status, plugin.inactive).map((entry) => (
    <StatusCellBox key={screenKeyOf(entry)} entry={entry} />
  ));
}

/** 값을 읽지 못한 칸은 감춘다. 표면은 그대로 두어 읽기 폴링이 이어지고 값이 오면 다시 보인다 */
export function StatusCellBox(props: { readonly entry: ExtUiEntry }): ReactNode {
  const { entry } = props;
  const { logger } = usePluginUi();
  const [failed, setFailed] = useState(false);
  // 감춘 동안에도 진단에는 남긴다(한 번 감출 때 한 줄. 읽기가 되살아나면 다시 보이고, 또 실패하면 또 한 줄)
  const onFailed = useCallback(
    (next: boolean) => {
      setFailed(next);
      if (next) {
        logger?.warn("desktop.status_cell.hidden", {
          extension: entry.extension,
          screen: entry.id,
          reason: "read_failed",
        });
      }
    },
    [logger, entry.extension, entry.id],
  );
  return (
    <div
      className={`flex min-w-0 max-w-[24ch] items-center gap-1 truncate${failed ? " hidden" : ""}`}
      title={originTitleOf(entry)}
      data-status-cell={screenKeyOf(entry)}
      data-status-failed={failed ? "" : undefined}
    >
      <span
        className="shrink-0 text-ui-sm text-text-secondary"
        data-status-origin={entry.extension}
      >
        {entry.extension}
      </span>
      <EntrySurface entry={entry} dense onFailed={onFailed} />
    </div>
  );
}

const STATUS_TONE_CLASS: Readonly<Record<NonNullable<StatusItemRecord["tone"]>, string>> = {
  normal: "",
  busy: "",
  warn: "warn",
  error: "error",
};

/**
 * 열린 대화의 상태줄 칸(B-09). 열 때 `status.list` 스냅숏으로 시작하고 `dialog.status`가 바꾼다. 글은 칸 소유자가 정한 한 줄이고
 * 길면 줄인다. `busy`는 `aria-busy`로 알린다
 */
function StatusItems(): ReactNode {
  const threadId = useSelectedThreadId();
  const items = useStatusItems(threadId);
  return items.map((item) => {
    const text = statusItemText(item);
    return (
      <span
        key={item.id}
        className={`min-w-0 max-w-[32ch] truncate ${STATUS_TONE_CLASS[item.tone ?? "normal"]}`}
        title={text}
        data-status-item={item.id}
        aria-busy={item.tone === "busy" ? true : undefined}
      >
        {text}
      </span>
    );
  });
}

/**
 * 실행 중인 엔진이 어디서 도는지의 글. 원격 대상에 붙었으면 엔진 거울의 `source`(셸 중계도 `sidecar`로 온다)와 상관없이
 * 대상 이름을 보인다. 이 기기 대상이면 `source`대로 쓴다.
 */
function sourceTextOf(
  engine: Extract<EngineState, { kind: "running" }>,
  target: EngineTargetView | undefined,
): string {
  if (target?.kind === "remote")
    return t("desktop.status.engine.sourceRemote", { name: target.label });
  return t(SOURCE_TEXT[engine.source]);
}

/**
 * 엔진 한 줄: 상태와, 실행 중이면 어디서 도는지. 상태 표시줄과 첫 실행 바닥글이 같이 쓴다. `target`을 주면(상태 표시줄)
 * 원격 대상일 때 "원격 · 이름"을 보인다. 첫 실행 바닥글은 대상을 주지 않는다.
 */
export function engineLineOf(
  engine: EngineState | null | undefined,
  target?: EngineTargetView,
): string {
  const source = engine?.kind === "running" ? ` (${sourceTextOf(engine, target)})` : "";
  return `${t(engineTextOf(engine))}${source}`;
}

/** 연결 상태의 글. 상태 표시줄과 첫 실행 바닥글이 같이 쓴다 */
export function linkTextOf(phase: Link["phase"]): MessageId {
  return LINK_TEXT[phase];
}

/** 엔진 칸의 점. 돌고 있으면 초록, 시작·다시 시작·끄는 중이면 노랑, 실패면 빨강, 꺼짐과 확인 전은 회색이다 */
export function engineDotOf(engine: EngineState | null | undefined): StatusDot {
  if (engine === undefined || engine === null) return "neutral";
  switch (engine.kind) {
    case "running":
      return "success";
    case "starting":
    case "restarting":
    case "stopping":
      return "warning";
    case "failed":
      return "danger";
    case "stopped":
      return "neutral";
    default:
      return assertNever(engine, "EngineState");
  }
}

/** 엔진 Popover의 설명. 실행 중, 실패, 다시 시작 중에 한 문장을 둔다(시안 defaultStatusCells). 나머지는 칸 글로 충분하다 */
export function engineDescriptionOf(engine: EngineState | null | undefined): MessageId | undefined {
  if (engine?.kind === "failed") return "desktop.status.cell.engine.failed";
  if (engine?.kind === "restarting") return "desktop.status.cell.engine.restarting";
  if (engine?.kind === "running") return "desktop.status.cell.engine.running";
  return undefined;
}

const LINK_DOT: Readonly<Record<Link["phase"], StatusDot>> = {
  offline: "neutral",
  connecting: "warning",
  syncing: "warning",
  live: "success",
  resync: "warning",
  reset: "warning",
  failed: "danger",
};

/** 연결 Popover의 설명. 끊긴 동안은 읽기만 된다는 것을, 맞추는 중과 실패는 어떻게 되는지를 보인다 */
const LINK_DESCRIPTION: Readonly<Record<Link["phase"], MessageId | undefined>> = {
  offline: "desktop.status.cell.link.down",
  connecting: undefined,
  syncing: "desktop.status.cell.link.catchUp",
  live: "desktop.status.cell.link.live",
  resync: "desktop.status.cell.link.catchUp",
  reset: "desktop.status.cell.link.catchUp",
  failed: "desktop.status.cell.link.down",
};

/**
 * 연결 Popover의 설명. 원격 대상이 끊기면 안내는 서비스 기준이다("엔진이 없어"가 아니라 서비스가 켜졌는지 보라고 한다).
 * 이 기기 대상은 `LINK_DESCRIPTION`을 그대로 쓴다
 */
export function linkDescriptionOf(phase: Link["phase"], remote: boolean): MessageId | undefined {
  if (remote && (phase === "offline" || phase === "failed")) return "desktop.status.serviceLost";
  return LINK_DESCRIPTION[phase];
}

/** 진행 중 Popover의 묶음 종류. 대화, 테스트 대화(testRun 표식), 예약(origin이 schedule) */
type LiveKind = "thread" | "trial" | "schedule";

export interface LiveRow {
  readonly kind: LiveKind;
  readonly threadId: ThreadId;
  readonly title: string | null;
  /** 예약에서 시작한 대화의 마지막 turn이 실패로 끝났다. 점을 빨갛게 하고 묶음을 목록 맨 위로 올린다 */
  readonly failed: boolean;
  /** 실패 이유 한 줄(거울의 turn 실패 문장). 실패 행만 가진다 */
  readonly reason: string | null;
}

const LIVE_KINDS: readonly LiveKind[] = ["thread", "trial", "schedule"];

const LIVE_HEAD: Readonly<Record<LiveKind, MessageId>> = {
  thread: "desktop.status.cell.live.thread",
  trial: "desktop.status.cell.live.trial",
  schedule: "desktop.status.cell.live.schedule",
};

function liveKindOf(thread: ThreadSummary): LiveKind {
  if (thread.testRun !== undefined) return "trial";
  if (thread.origin?.kind === "schedule") return "schedule";
  return "thread";
}

/**
 * 진행 중 목록의 행. 실행 중인 대화와, 예약에서 시작했고 마지막 turn이 실패로 끝난 대화를 모은다.
 * 실패는 거울의 턴 실패 기록(`failures`, 대화 id → 문장)과 대화의 origin(schedule)으로 정한다. 실패 행이 앞에 오고, 나머지는 거울의 목록 순서를 따른다.
 * origin은 목록 읽기(`thread.list`)에서 오고, 이 연결에서 새로 시작한 예약 대화는 예약 입력 사실(`input.queued`)로 거울이 채운다.
 */
export function liveRowsOf(
  threads: readonly ThreadSummary[],
  failures: Readonly<Record<string, string>>,
): LiveRow[] {
  const failed: LiveRow[] = [];
  const running: LiveRow[] = [];
  for (const thread of threads) {
    const reason = failures[thread.threadId] ?? null;
    if (thread.origin?.kind === "schedule" && reason !== null) {
      failed.push(liveRowOf(thread, true, reason));
    } else if (thread.status === "running") {
      running.push(liveRowOf(thread, false, null));
    }
  }
  return [...failed, ...running];
}

function liveRowOf(thread: ThreadSummary, failed: boolean, reason: string | null): LiveRow {
  return {
    kind: liveKindOf(thread),
    threadId: thread.threadId,
    title: thread.title,
    failed,
    reason,
  };
}

/** 묶음 순서. 실패 행이 든 묶음을 맨 위로 올리고, 나머지는 `LIVE_KINDS` 순서를 지킨다 */
export function liveKindsOf(rows: readonly LiveRow[]): readonly LiveKind[] {
  const failing = LIVE_KINDS.filter((kind) => rows.some((row) => row.failed && row.kind === kind));
  return [...failing, ...LIVE_KINDS.filter((kind) => !failing.includes(kind))];
}

/** 진행 중 칸의 점. 실패 행이 하나라도 있으면 빨강이고, 없으면 점을 그리지 않는다 */
export function liveDotOf(rows: readonly LiveRow[]): StatusDot | undefined {
  return rows.some((row) => row.failed) ? "danger" : undefined;
}

function LinkCell(props: { readonly phase: Link["phase"]; readonly attempt: number }): ReactNode {
  const { phase, attempt } = props;
  const [open, setOpen] = useState(false);
  const target = useEngineTarget();
  const description = linkDescriptionOf(phase, target.kind === "remote");
  return (
    <StatusCell
      cellId="link"
      collapseIcon={<Link2 className="size-3.5" />}
      text={`${t(LINK_TEXT[phase])}${attempt > 0 ? ` ${t("desktop.status.link.attempt", { attempt })}` : ""}`}
      dot={LINK_DOT[phase]}
      title={t("desktop.status.cell.link.title")}
      description={description === undefined ? undefined : t(description)}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

function EngineCell(props: { readonly engine: EngineState | null }): ReactNode {
  const [open, setOpen] = useState(false);
  const target = useEngineTarget();
  const description = engineDescriptionOf(props.engine);
  return (
    <StatusCell
      cellId="engine"
      text={engineLineOf(props.engine, target)}
      dot={engineDotOf(props.engine)}
      title={t("desktop.status.cell.engine.title")}
      description={description === undefined ? undefined : t(description)}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

/** 진행 중 목록의 묶음들. 묶음마다 머리 글과 행이 있다. 실패 행이 든 묶음은 맨 위에 온다 */
export function LiveList(props: {
  readonly rows: readonly LiveRow[];
  readonly goTo: GoToThread | null;
  readonly close: () => void;
}): ReactNode {
  const { rows, goTo, close } = props;
  return (
    <div className="grid gap-2">
      {liveKindsOf(rows).map((kind) => {
        const items = rows.filter((row) => row.kind === kind);
        if (items.length === 0) return null;
        return (
          <section key={kind} aria-label={t(LIVE_HEAD[kind])} className="grid gap-0.5">
            <h3 className="m-0 text-ui-xs font-normal text-text-tertiary">{t(LIVE_HEAD[kind])}</h3>
            {items.map((row) => (
              <LiveRowLine key={row.threadId} row={row} goTo={goTo} close={close} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function LiveRowLine(props: {
  readonly row: LiveRow;
  readonly goTo: GoToThread | null;
  readonly close: () => void;
}): ReactNode {
  const { row, goTo, close } = props;
  const name = row.title ?? t("desktop.threads.untitled");
  const failure =
    row.reason === null ? null : t("desktop.status.cell.live.failed", { reason: row.reason });
  // 실패 행은 색 면의 아이콘과 "실패 · 이유" 줄을 함께 둔다. 색만으로 뜻을 주지 않는다
  const content = (
    <>
      {row.failed ? (
        <span
          aria-hidden
          className="inline-grid size-5 flex-none place-items-center rounded-md bg-danger-soft text-danger-text"
        >
          <TriangleAlert className="size-3.5" />
        </span>
      ) : null}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate">{name}</span>
        {failure === null ? null : (
          <span className="truncate text-ui-xs text-danger-text" title={failure}>
            {failure}
          </span>
        )}
      </span>
    </>
  );
  if (goTo === null)
    return (
      <div className="flex min-w-0 items-center gap-2 text-ui-sm text-text-primary">{content}</div>
    );
  return (
    <Button
      size="sm"
      variant="ghost"
      className="-mx-1.5 h-auto min-w-0 justify-start px-1.5 py-1 text-start font-normal"
      onClick={() => {
        goTo(row.threadId);
        close();
      }}
    >
      {content}
    </Button>
  );
}

/** "진행 중 n" 칸과 Popover(N-58). 목록이 비면 빈 글을 보인다. 행을 누르면 그 대화로 가고 Popover를 닫는다 */
function LiveCell(): ReactNode {
  const running = useRunningCount();
  const rows = liveRowsOf(useThreadSummaries(), useTurnFailures());
  const goTo = useGoToThread();
  const [open, setOpen] = useState(false);
  return (
    <StatusCell
      cellId="live"
      text={t("desktop.status.running", { count: running })}
      dot={liveDotOf(rows)}
      title={t("desktop.status.cell.live.title")}
      wide
      open={open}
      onOpenChange={setOpen}
      body={
        rows.length === 0 ? (
          <p className="m-0 text-ui-sm text-text-tertiary">{t("desktop.status.cell.live.empty")}</p>
        ) : (
          <LiveList
            rows={rows}
            goTo={goTo}
            close={() => {
              setOpen(false);
            }}
          />
        )
      }
    />
  );
}

/**
 * "모델" 칸(시안 `model`). 이 대화가 다음 턴부터 쓰는 모델(대화가 정한 모델, 없으면 기본 모델)을 보인다.
 * 칸 글은 모델 이름만 두고(`provider/` 접두사는 뗀다). 고르는 곳은 입력창의 모델 select다
 */
export function ModelCell(props: { readonly model: string | null }): ReactNode {
  const [open, setOpen] = useState(false);
  // 기본 모델을 아직 정하지 않았으면 시안(p01)처럼 "모델 없음"으로 보인다
  return (
    <StatusCell
      cellId="model"
      collapseIcon={<Sparkles className="size-3.5" />}
      text={props.model === null ? t("desktop.status.cell.model.none") : modelLabelOf(props.model)}
      title={t("desktop.status.cell.model.title")}
      description={
        props.model === null
          ? t("desktop.status.cell.model.noneDescription")
          : t("desktop.status.cell.model.description")
      }
      open={open}
      onOpenChange={setOpen}
    />
  );
}

/** 사용량 막대(시안 `TokenBar`, C-05 대용). 한도 비율을 알 때만 그린다. 장식이라 숨기고 칸 글이 뜻을 맡는다 */
function TokenBar(props: { readonly percent: number }): ReactNode {
  return <Progress value={Math.round(props.percent)} decorative size="xs" className="w-12" />;
}

/**
 * 사용량 Popover의 설명. 이 대화에서 쓴 토큰 수를 말하고, 한도를 알 때만 비율을 한 문장 더한다. 비율을 지어내지 않는다
 */
export function tokensDescriptionOf(usage: SessionUsage): string {
  const tokens = tokenCountText(usage.tokens);
  return usage.percent === null
    ? t("desktop.status.cell.tokens.description", { tokens })
    : t("desktop.status.cell.tokens.limitDescription", {
        tokens,
        percent: Math.round(usage.percent),
      });
}

/** "사용량" 칸(시안 `tokens`). 글은 쓴 토큰 수이고, 한도를 알 때만 칸 뒤에 막대를 붙인다 */
export function TokensCell(props: {
  readonly usage: SessionUsage;
  /** 있으면 Popover에 토큰·비용 내역을 더한다 */
  readonly threadId?: ThreadId;
}): ReactNode {
  const { usage } = props;
  const [open, setOpen] = useState(false);
  return (
    <StatusCell
      cellId="tokens"
      collapseIcon={<Layers className="size-3.5" />}
      text={
        usage.limit === null
          ? tokenCountText(usage.tokens)
          : `${tokenCountText(usage.tokens)} / ${tokenCountText(usage.limit)}`
      }
      trailing={usage.percent === null ? undefined : <TokenBar percent={usage.percent} />}
      title={t("desktop.status.cell.tokens.title")}
      description={tokensDescriptionOf(usage)}
      body={
        props.threadId === undefined ? undefined : <UsageBreakdownBody threadId={props.threadId} />
      }
      open={open}
      onOpenChange={setOpen}
    />
  );
}

/** 모델과 사용량 칸을 대화에 맞춰 읽는다. 훅은 대화 id가 있어야 하므로 대화가 있을 때만 이 조각을 그린다 */
function ThreadUsageCells(props: { readonly threadId: ThreadId }): ReactNode {
  const running = useThreadRunning(props.threadId);
  const model = useThreadModel(props.threadId, useDefaultModel());
  const usage = useSessionUsage(props.threadId, running);
  return (
    <>
      {model.ref === null ? null : <ModelCell model={model.ref} />}
      {usage === null ? null : <TokensCell usage={usage} threadId={props.threadId} />}
      <GoalCell threadId={props.threadId} />
    </>
  );
}

/** 모델과 사용량 칸(시안 `model`, `tokens`). 대화를 고르지 않았으면 아무것도 그리지 않고, 값을 읽기 전에는 칸을 두지 않는다 */
function UsageCells(): ReactNode {
  const threadId = useSelectedThreadId();
  if (threadId === null) return <DefaultModelCell />;
  return <ThreadUsageCells threadId={threadId} />;
}

/** 대화를 고르지 않았을 때의 모델 칸. 연결이 살아 있을 때만 그려서, 값을 읽기 전에 "모델 없음"이 깜박이지 않게 한다 */
function DefaultModelCell(): ReactNode {
  const phase = useLinkPhase();
  const model = useDefaultModel();
  return phase === "live" ? <ModelCell model={model} /> : null;
}

type GoalWire = WireResult<"goal.status">["goal"];

/** 목표 칸의 글과 Popover 설명. 목표가 없거나 해제됐으면 null이다(칸을 두지 않는다). 글은 "목표 판정/최대"(DP-25) */
export function goalCellOf(goal: GoalWire): {
  readonly text: string;
  readonly description: string;
} | null {
  if (goal === null || goal.status === "cleared") return null;
  const judged = t("desktop.work.goal.judged", { judged: goal.judged, max: goal.maxJudgments });
  const state = t(
    goal.status === "active"
      ? "desktop.work.goal.status.active"
      : goal.status === "met"
        ? "desktop.work.goal.status.met"
        : "desktop.work.goal.status.exhausted",
  );
  return {
    text: t("desktop.status.goal", { judged: goal.judged, max: goal.maxJudgments }),
    description: `${judged} · ${state}`,
  };
}

/**
 * 읽은 목표 중 칸에 둘 것. 끝난 목표(달성·상한)는 결과와 함께 칸에 남다가 사용자가 다음 말을 보내 턴이 시작되면(`running`)
 * 내리고, 내린 목표(`dismissed` 키)는 같은 값으로 다시 읽어도 그리지 않는다
 */
export function goalShownOf(
  goal: GoalWire,
  threadId: ThreadId,
  running: boolean,
  dismissed: string | null,
): { readonly goal: GoalWire; readonly dismissed: string | null } {
  if (goal === null || goal.status === "active") return { goal, dismissed };
  const key = `${threadId}|${goal.condition}|${goal.status}|${String(goal.judged)}`;
  const next = running ? key : dismissed;
  return { goal: next === key ? null : goal, dismissed: next };
}

/** 열린 대화의 목표를 읽는다. 연결이 살아 있으면 대화를 열 때, 턴이 시작·끝날 때, 슬래시 명령이 끝날 때 읽는다(목표가 쉬는 동안에도 칸이 보인다). 읽지 못하면 칸을 두지 않는다 */
function useThreadGoal(threadId: ThreadId): GoalWire {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const running = useThreadRunning(threadId);
  const commandRuns = useCommandRuns();
  const [goal, setGoal] = useState<GoalWire>(null);
  // 끝난 목표는 사용자가 다음 말을 보내 새 턴이 시작되면 칸에서 내린다. 내린 목표는 같은 값으로 다시 읽어도 그리지 않는다
  // 키에 대화 id가 들어 있어 다른 대화로 옮겨도 따로 비우지 않는다
  const dismissed = useRef<string | null>(null);
  useEffect(() => {
    if (!live) return undefined;
    let stale = false;
    // 턴이 시작·끝날 때(running)와 슬래시 명령이 끝날 때(commandRuns)가 다시 읽는 신호다
    const read = async (_why: {
      readonly running: boolean;
      readonly runs: number;
    }): Promise<void> => {
      const result = await commands.work.goal(threadId);
      if (stale) return;
      const shown = goalShownOf(
        result.ok ? result.value.goal : null,
        threadId,
        running,
        dismissed.current,
      );
      dismissed.current = shown.dismissed;
      setGoal(shown.goal);
    };
    detach(read({ running, runs: commandRuns }), rethrow);
    return () => {
      stale = true;
    };
  }, [commands, threadId, live, running, commandRuns]);
  return goal;
}

/** "목표" 칸(시안 `goal`). 값은 `goal.status`의 판정 횟수/최대다. 누르면 Popover가 열리고 작업 탭으로 가는 단추가 있다 */
function GoalCell(props: { readonly threadId: ThreadId }): ReactNode {
  const goal = useThreadGoal(props.threadId);
  const shell = useContext(ShellStoreContext);
  const [open, setOpen] = useState(false);
  const cell = goalCellOf(goal);
  if (cell === null) return null;
  return (
    <StatusCell
      cellId="goal"
      text={cell.text}
      title={t("desktop.work.goal.heading")}
      description={cell.description}
      body={
        shell === null ? undefined : (
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              shell.actions.openEndTab("work", "chat");
              setOpen(false);
            }}
          >
            {t("desktop.status.cell.goal.openWork")}
          </Button>
        )
      }
      open={open}
      onOpenChange={setOpen}
    />
  );
}

/** "승인 n" 칸. 답을 기다리는 승인이 있을 때만 그린다(0이면 칸을 두지 않는다). 시안처럼 점은 없고 글만 있다 */
function ApprovalsCell(props: { readonly count: number }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <StatusCell
      cellId="approvals"
      text={t("desktop.status.approvals", { count: props.count })}
      title={t("desktop.status.cell.approvals.title")}
      description={t("desktop.status.cell.approvals.description", { count: props.count })}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

/**
 * 업데이트 칸(B-10, d02 `upd`). 내려받기와 설치 단계에서만 보인다. 확인 단계와 최신 상태는 설정 줄이 맡는다.
 * 문맥이 없으면(웹) 아무것도 그리지 않는다.
 */
function UpdateCell(): ReactNode {
  const controller = useUpdate();
  if (controller === null) return null;
  return <UpdateCellOf controller={controller} />;
}

/**
 * 업데이트 칸의 동작. 설치는 진행 중인 턴을 멈추므로 턴이 있으면 다시 시작 확인을 먼저 묻는다(기본 초점은 "나중에").
 * "턴이 끝나면"을 고르면 턴이 0이 되고 파일이 준비된 때 한 번 설치한다. 설치가 실패하면 다시 자동으로 설치하지 않는다.
 */
function UpdateCellOf(props: { readonly controller: UpdateController }): ReactNode {
  const { controller } = props;
  // 서버 렌더(시험)도 같은 상태를 읽으므로 서버 스냅숏으로 `getState`를 함께 준다
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const running = useRunningCount();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  // "턴이 끝나면"을 골랐는지. 그릴 값이 아니고 턴이 0이 될 때 한 번 쓰는 표식이라 상태 대신 참조에 둔다
  const afterTurn = useRef(false);
  useEffect(() => {
    if (!shouldAutoInstall(afterTurn.current, running, state)) return;
    afterTurn.current = false;
    detach(controller.installAndRestart(), rethrow);
  }, [controller, running, state]);
  const cell = updateCellOf(state);
  if (!cell.showCell) return null;
  const percent = progressPercentOf(state);
  const description = updateDescriptionOf(state);
  const install = (): void => {
    if (needsRunningConfirm(state, running)) setAsking(true);
    else detach(controller.installAndRestart(), rethrow);
  };
  return (
    <>
      <StatusCell
        cellId="update"
        text={t(cell.text, percent === null ? undefined : { percent })}
        dot={cell.dot}
        title={t("desktop.update.cell.title")}
        description={description === undefined ? undefined : t(description)}
        wide
        open={open}
        onOpenChange={setOpen}
        body={
          <UpdateBody
            state={state}
            currentVersion={controller.currentVersion()}
            handlers={{
              download: () => {
                detach(controller.download(), rethrow);
              },
              install,
              retry: () => {
                // 설치 단계에서 멈춘 것을 다시 하는 것은 설치와 같으므로 턴을 묻는다
                if (retryStepOf(state) === "install") install();
                else detach(controller.retry(), rethrow);
              },
            }}
          />
        }
      />
      <UpdateRestartDialog
        open={asking}
        turns={running}
        onLater={() => {
          setAsking(false);
        }}
        onAfterTurn={() => {
          setAsking(false);
          afterTurn.current = true;
        }}
        onNow={() => {
          setAsking(false);
          detach(controller.installAndRestart(), rethrow);
        }}
      />
    </>
  );
}

export function StatusBar(): ReactNode {
  const commands = useCommands();
  const engine = useEngineState();
  const engineTarget = useEngineTarget();
  const banner = useLinkBanner();
  const approvals = useApprovalCount();
  const connectError = useConnectError();
  const restartNeeded = useRestartNeeded();
  // 엔진이 없으면 거울의 "진행 중" 수는 오래된 값이라 그 칸을 그리지 않는다(F-9)
  const engineGone = engineGoneOf(engine, banner.phase);
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async (): Promise<void> => {
    setCopied(await commands.copyDiagnostics());
  };
  // 왼쪽은 엔진과 연결 칸이고, 그 뒤에 안전 모드·업데이트·다시 시작 줄·연결 실패 글·대화와 확장의 칸이 붙는다(시안 `startExtra`).
  // 실패 단추는 자기 칸 옆에 둔다(시안 `inline`). 오른쪽은 진행 중, 모델, 사용량, 승인 칸이다. 모델과 사용량 칸은 열린 대화가 있고
  // 값을 읽었을 때만 그린다. 목표 칸은 `goal.status`를 읽어 그린다. 시안의 Helm 칸은 클라이언트에 맞는 값이 없고(탐구 단계를 거울이 들고 있지 않다), 알림 칸은 개수를 거울이 들고 있지 않아 아직 없다.
  return (
    <footer className="statusbar">
      {/* 줄 전체를 낭독 영역으로 두면 갱신마다 읽힌다. 사용자가 알아야 할 바뀜(엔진 상태)만 이 한 줄이 맡는다 */}
      <span role="status" className="sr-only">
        {engineLineOf(engine, engineTarget)}
      </span>
      <EngineCell engine={engine} />
      {engine?.kind === "failed" ? (
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            detach(commands.restartEngine(), rethrow);
          }}
        >
          {t("desktop.status.restartEngineButton")}
        </Button>
      ) : null}
      <LinkCell phase={banner.phase} attempt={banner.attempt} />
      {banner.phase === "failed" || connectError !== null ? (
        <>
          {/* 원격 대상이 끊기면 안내는 서비스 기준이다. 이 기기 대상은 연결 실패 글과 단추가 맡는다 */}
          {engineTarget.kind === "remote" ? (
            <span className="dim">{t("desktop.status.serviceLost")}</span>
          ) : null}
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              commands.reconnect();
            }}
          >
            {t("desktop.status.reconnectButton")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              detach(copy(), rethrow);
            }}
          >
            {t("desktop.status.copyDiagnosticsButton")}
          </Button>
          {copied === null ? null : (
            <span className="dim">
              {copied
                ? t("desktop.status.diagnosticsCopied")
                : t("desktop.status.diagnosticsCopyFailed")}
            </span>
          )}
        </>
      ) : null}
      <SafeModeChip />
      <UpdateCell />
      <RestartLine reasons={restartNeeded} />
      {connectError === null ? null : (
        <span className="error">{t("desktop.status.connectFailed", { error: connectError })}</span>
      )}
      <StatusItems />
      <StatusCells />
      <span className="grow" />
      {engineGone ? null : <LiveCell />}
      <UsageCells />
      {approvals > 0 ? <ApprovalsCell count={approvals} /> : null}
    </footer>
  );
}
