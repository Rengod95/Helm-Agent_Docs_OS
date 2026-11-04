import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { storeFailureOfExitCode, type StatusItemRecord } from "@fresnel/contracts/records";
import type { ThreadSummary } from "@fresnel/contracts/wire";
import { useState, type ReactNode } from "react";
import { nativeEntriesOf, originTitleOf } from "../plugin-ui/placements.ts";
import {
  useApprovalCount,
  useEngineState,
  useLinkBanner,
  useRunningCount,
  useStatusItems,
  useThreadSummaries,
  type EngineState,
  type Link,
} from "../state/engine/index.ts";
import { useConnectError, useRestartNeeded, useSelectedThreadId } from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";
import { EntrySurface, screenKeyOf } from "./plugin/plugin-view.tsx";
import { usePluginUiState } from "./plugin/plugin-context.tsx";
import { RestartLine } from "./restart-line.tsx";
import { SafeModeChip } from "./safe-mode-chip.tsx";
import { StatusCell, type StatusDot } from "./status-cell.tsx";
import { useGoToThread, type GoToThread } from "./thread-link.ts";

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
    <div
      key={screenKeyOf(entry)}
      className="flex min-w-0 max-w-[24ch] items-center gap-1 truncate"
      title={originTitleOf(entry)}
      data-status-cell={screenKeyOf(entry)}
    >
      <span className="shrink-0 text-xs text-muted-foreground" data-status-origin={entry.extension}>
        {entry.extension}
      </span>
      <EntrySurface entry={entry} dense />
    </div>
  ));
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
  return items.map((item) => (
    <span
      key={item.id}
      className={`min-w-0 max-w-[32ch] truncate ${STATUS_TONE_CLASS[item.tone ?? "normal"]}`}
      title={item.text}
      data-status-item={item.id}
      aria-busy={item.tone === "busy" ? true : undefined}
    >
      {item.text}
    </span>
  ));
}

/** 엔진 한 줄: 상태와, 실행 중이면 어디서 도는지. 상태 표시줄과 첫 실행 바닥글이 같이 쓴다 */
export function engineLineOf(engine: EngineState | null | undefined): string {
  return `${t(engineTextOf(engine))}${engine?.kind === "running" ? ` (${t(SOURCE_TEXT[engine.source])})` : ""}`;
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

/** 엔진 Popover의 설명. 실패와 다시 시작 중에만 한 문장을 더한다. 나머지는 칸 글로 충분하다 */
export function engineDescriptionOf(engine: EngineState | null | undefined): MessageId | undefined {
  if (engine?.kind === "failed") return "desktop.status.cell.engine.failed";
  if (engine?.kind === "restarting") return "desktop.status.cell.engine.restarting";
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
  live: undefined,
  resync: "desktop.status.cell.link.catchUp",
  reset: "desktop.status.cell.link.catchUp",
  failed: "desktop.status.cell.link.down",
};

/** 진행 중 Popover의 묶음 종류. 대화, 테스트 대화(testRun 표식), 예약(origin이 schedule) */
type LiveKind = "thread" | "trial" | "schedule";

export interface LiveRow {
  readonly kind: LiveKind;
  readonly threadId: ThreadId;
  readonly title: string | null;
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

/** 실행 중인 대화를 종류별 행으로 바꾼다. 목록 순서(거울의 순서)를 따른다 */
export function liveRowsOf(threads: readonly ThreadSummary[]): LiveRow[] {
  return threads
    .filter((thread) => thread.status === "running")
    .map((thread) => ({
      kind: liveKindOf(thread),
      threadId: thread.threadId,
      title: thread.title,
    }));
}

function LinkCell(props: { readonly phase: Link["phase"]; readonly attempt: number }): ReactNode {
  const { phase, attempt } = props;
  const [open, setOpen] = useState(false);
  const description = LINK_DESCRIPTION[phase];
  return (
    <StatusCell
      cellId="link"
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
  const description = engineDescriptionOf(props.engine);
  return (
    <StatusCell
      cellId="engine"
      text={engineLineOf(props.engine)}
      dot={engineDotOf(props.engine)}
      title={t("desktop.status.cell.engine.title")}
      description={description === undefined ? undefined : t(description)}
      open={open}
      onOpenChange={setOpen}
    />
  );
}

/** 진행 중 목록의 묶음들. 묶음마다 머리 글과 행이 있다 */
function LiveList(props: {
  readonly rows: readonly LiveRow[];
  readonly goTo: GoToThread | null;
  readonly close: () => void;
}): ReactNode {
  const { rows, goTo, close } = props;
  return (
    <div className="grid gap-2">
      {LIVE_KINDS.map((kind) => {
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
  if (goTo === null)
    return <span className="min-w-0 truncate text-ui-sm text-text-primary">{name}</span>;
  return (
    <button
      type="button"
      className="-mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-start text-ui-sm text-text-primary outline-none focus-visible:focus-ring"
      onClick={() => {
        goTo(row.threadId);
        close();
      }}
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </button>
  );
}

/** "진행 중 n" 칸과 Popover(N-58). 목록이 비면 빈 글을 보인다. 행을 누르면 그 대화로 가고 Popover를 닫는다 */
function LiveCell(): ReactNode {
  const running = useRunningCount();
  const rows = liveRowsOf(useThreadSummaries());
  const goTo = useGoToThread();
  const [open, setOpen] = useState(false);
  return (
    <StatusCell
      cellId="live"
      text={t("desktop.status.running", { count: running })}
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

export function StatusBar(): ReactNode {
  const commands = useCommands();
  const engine = useEngineState();
  const banner = useLinkBanner();
  const approvals = useApprovalCount();
  const connectError = useConnectError();
  const restartNeeded = useRestartNeeded();
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async (): Promise<void> => {
    setCopied(await commands.copyDiagnostics());
  };
  return (
    <footer className="statusbar" role="status">
      <EngineCell engine={engine} />
      <LinkCell phase={banner.phase} attempt={banner.attempt} />
      <SafeModeChip />
      <LiveCell />
      {approvals > 0 ? (
        <span className="warn">{t("desktop.status.approvals", { count: approvals })}</span>
      ) : null}
      <RestartLine reasons={restartNeeded} />
      {connectError === null ? null : (
        <span className="error">{t("desktop.status.connectFailed", { error: connectError })}</span>
      )}
      <StatusItems />
      <StatusCells />
      <span className="grow" />
      <button
        type="button"
        onClick={() => {
          commands.showScreen("settings");
        }}
      >
        {t("desktop.status.settingsButton")}
      </button>
      {engine?.kind === "failed" ? (
        <button
          type="button"
          onClick={() => {
            detach(commands.restartEngine(), rethrow);
          }}
        >
          {t("desktop.status.restartEngineButton")}
        </button>
      ) : null}
      {banner.phase === "failed" || connectError !== null ? (
        <>
          <button
            type="button"
            onClick={() => {
              commands.reconnect();
            }}
          >
            {t("desktop.status.reconnectButton")}
          </button>
          <button
            type="button"
            onClick={() => {
              detach(copy(), rethrow);
            }}
          >
            {t("desktop.status.copyDiagnosticsButton")}
          </button>
          {copied === null ? null : (
            <span className="dim">
              {copied
                ? t("desktop.status.diagnosticsCopied")
                : t("desktop.status.diagnosticsCopyFailed")}
            </span>
          )}
        </>
      ) : null}
    </footer>
  );
}
