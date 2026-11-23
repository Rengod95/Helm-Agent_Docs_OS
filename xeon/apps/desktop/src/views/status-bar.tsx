import { Button, Progress } from "@caustic/react";
import { Inbox, Layers, Link2, Play, Shield, TriangleAlert } from "@caustic/react/icons";
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { Notice } from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  startupFailureOfExitCode,
  storeFailureOfExitCode,
  type StartupFailureKind,
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
import { runReasonTextOf } from "./pages/schedules/schedule-text.ts";
import {
  useApprovalCount,
  useQuestionCount,
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
import { tokenCountText, useSessionUsage, type SessionUsage } from "./model-usage.ts";
import { EntrySurface, screenKeyOf } from "./plugin/plugin-view.tsx";
import { usePluginUi, usePluginUiState } from "./plugin/plugin-context.tsx";
import { RestartLine } from "./restart-line.tsx";
import { SafeModeChip } from "./safe-mode-chip.tsx";
import { useScheduleRunFailures } from "./schedule-run-failures.ts";
import { ProgressOrb } from "./effects/progress-orb.tsx";
import { CONTEXT_TAB_ID, INBOX_TAB_ID, RUNNING_TAB_ID } from "./panels/tab-ids.ts";
import { StatusAction, StatusCell, type StatusTone } from "./status-cell.tsx";
import { statusItemText } from "./status-item-text.ts";
import { useGoToThread, type GoToThread } from "./thread-link.ts";
import { useUpdate } from "./update-context.ts";
import type { UpdateController } from "./update-controller.ts";
import {
  needsRunningConfirm,
  updateToneOf,
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

/** 사용자가 고칠 수 있는 시작 실패(종료 코드 73~76)의 이유와 다음 할 일을 한 줄로 보인다(rtE R-9) */
const STARTUP_FAILURE_TEXT: Readonly<Record<StartupFailureKind, MessageId>> = {
  data_dir_permission: "desktop.status.engine.dataDirPermission",
  store_busy: "desktop.status.engine.storeBusy",
  data_dir_unwritable: "desktop.status.engine.dataDirUnwritable",
  store_unavailable: "desktop.status.engine.storeUnavailable",
};

/** 저장소를 열지 못해 끝난 엔진은 분류별 안내를 보인다(종료 코드 70~76). 그 밖의 종료는 일반 문구다 */
export function engineTextOf(state: EngineState | null | undefined): MessageId {
  if (state === undefined || state === null) return "desktop.status.engine.checking";
  if (state.kind === "failed" || state.kind === "restarting") {
    const failure = storeFailureOfExitCode(state.lastExit.code);
    if (failure !== undefined) return STORE_FAILURE_TEXT[failure];
    const startup = startupFailureOfExitCode(state.lastExit.code);
    if (startup !== undefined) return STARTUP_FAILURE_TEXT[startup];
  }
  return ENGINE_TEXT[state.kind];
}

/**
 * 화면에 보일 엔진 상태. 셸은 프로세스가 뜨자마자 `running`을 보내므로, 연결이 live가 되기 전의 `running`은 아직 "실행 중"이 아니다.
 * 곧 실패하는 시작에 초록 점과 "실행 중"이 잠깐 보이지 않도록, 연결이 live가 아니면 "시작 중"으로 보인다
 */
export function shownEngineOf(
  engine: EngineState | null | undefined,
  linkLive: boolean,
): EngineState | null | undefined {
  if (engine?.kind !== "running" || linkLive) return engine;
  return { kind: "starting", source: engine.source, attempt: 0 };
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

/**
 * 엔진·연결의 건강 단계(DP-206). ok는 정상(칸을 그리지 않음), busy는 지나가는 상태(흑백 진행 구슬 + 글),
 * idle은 멈춘 상태(글만), failed는 실패(위험 글자색)다. 단색 점은 쓰지 않는다
 */
export type HealthLevel = "ok" | "busy" | "idle" | "failed";

/** 엔진의 건강 단계. 확인 전과 시작·다시 시작·끄는 중은 busy, 꺼짐은 idle, 실패는 failed다 */
export function engineHealthOf(engine: EngineState | null | undefined): HealthLevel {
  if (engine === undefined || engine === null) return "busy";
  switch (engine.kind) {
    case "running":
      return "ok";
    case "starting":
    case "restarting":
    case "stopping":
      return "busy";
    case "failed":
      return "failed";
    case "stopped":
      return "idle";
    default:
      return assertNever(engine, "EngineState");
  }
}

/**
 * 엔진 줄의 "데이터 복원 열기" 단추를 보일지. 저장소가 손상됐거나(종료 코드 71) 마이그레이션에 실패했을(72) 때 실패 또는 다시 시작 중인
 * 엔진에만 보인다. 누르면 설정의 고급 탭(데이터 복원 구역)이 열린다. 다른 종료 코드에는 단추를 두지 않는다
 */
export function engineRestoreShownOf(engine: EngineState | null | undefined): boolean {
  if (engine === undefined || engine === null) return false;
  if (engine.kind !== "failed" && engine.kind !== "restarting") return false;
  const failure = storeFailureOfExitCode(engine.lastExit.code);
  return failure === "corrupt" || failure === "migration_failed";
}

/** 엔진 Popover의 설명. 실행 중, 실패, 다시 시작 중에 한 문장을 둔다(시안 defaultStatusCells). 나머지는 칸 글로 충분하다 */
export function engineDescriptionOf(engine: EngineState | null | undefined): MessageId | undefined {
  if (engine?.kind === "failed") return "desktop.status.cell.engine.failed";
  if (engine?.kind === "restarting") return "desktop.status.cell.engine.restarting";
  if (engine?.kind === "running") return "desktop.status.cell.engine.running";
  return undefined;
}

const LINK_HEALTH: Readonly<Record<Link["phase"], HealthLevel>> = {
  offline: "idle",
  connecting: "busy",
  syncing: "busy",
  live: "ok",
  resync: "busy",
  reset: "busy",
  failed: "failed",
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
  /** 대화의 id. 대화 없이 실패한 예약 실행의 행은 대화가 없어 null이고, 누르면 가는 곳이 없다 */
  readonly threadId: ThreadId | null;
  readonly title: string | null;
  /** 예약에서 시작한 대화의 마지막 turn이 실패로 끝났다. 점을 빨갛게 하고 묶음을 목록 맨 위로 올린다 */
  readonly failed: boolean;
  /**
   * 실패 이유 한 줄. 대화 행은 거울의 turn 실패 문장이고, 대화 없는 예약 실패는 실행의 사유 문장이다. 실패 행만 가진다
   */
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
 * `scheduleFailures`는 대화 없이 실패한 예약 실행의 알림이다. 예약 묶음의 실패 행으로 대화 행의 실패 뒤, 실행 중인 행 앞에 둔다.
 */
export function liveRowsOf(
  threads: readonly ThreadSummary[],
  failures: Readonly<Record<string, string>>,
  scheduleFailures: readonly Notice[] = [],
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
  return [...failed, ...scheduleFailures.map(scheduleFailureRowOf), ...running];
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

/** 대화 없이 실패한 예약 실행 한 건의 행. 대화가 없어 이동하지 않고, 사유는 실행 기록의 사유 문장이다 */
export function scheduleFailureRowOf(notice: Notice): LiveRow {
  const reason = runReasonTextOf(notice.body);
  return {
    kind: "schedule",
    threadId: null,
    title: null,
    failed: true,
    reason: t(reason.id, reason.args),
  };
}

/** 묶음 순서. 실패 행이 든 묶음을 맨 위로 올리고, 나머지는 `LIVE_KINDS` 순서를 지킨다 */
export function liveKindsOf(rows: readonly LiveRow[]): readonly LiveKind[] {
  const failing = LIVE_KINDS.filter((kind) => rows.some((row) => row.failed && row.kind === kind));
  return [...failing, ...LIVE_KINDS.filter((kind) => !failing.includes(kind))];
}

/**
 * 엔진·연결 칸의 겉(DP-182, DP-206). 정상이고 이 기기면 칸이 없고(text null), 원격 대상이면 "원격 · 이름" 글만이다.
 * 이상이면 그 상태 글이고, 지나가는 상태(busy)는 앞에 흑백 진행 구슬을, 실패는 위험 글자색을 쓴다
 */
export interface HealthView {
  readonly text: string | null;
  readonly tone: StatusTone | undefined;
  /** 지나가는 상태(시작 중, 다시 시작 중, 끄는 중, 연결 중, 따라잡는 중, 다시 맞추는 중)라 진행 구슬을 앞에 둔다 */
  readonly busy: boolean;
}

function healthViewOf(level: HealthLevel, text: string | null): HealthView {
  return { text, tone: level === "failed" ? "danger" : undefined, busy: level === "busy" };
}

/**
 * 상태 줄의 엔진·연결 칸. 정상인 상태("엔진 실행 중", "연결됨")는 글로 말하지 않는다. 엔진이 돌지 않으면 엔진 글(시작 중, 다시 시작 중, 꺼짐,
 * 시작 실패와 그 이유), 엔진은 도는데 연결이 live가 아니면 연결 글(연결 중, 따라잡는 중, 다시 맞추는 중, 연결 없음, 복구 실패)이다.
 * 실패만 위험 글자색이고, 지나가는 상태는 흑백 진행 구슬이 앞에 선다. `engine`은 셸이 보낸 그대로(`shownEngineOf` 전)의 값이다
 */
export function healthOf(
  engine: EngineState | null | undefined,
  phase: Link["phase"],
  attempt: number,
  target: EngineTargetView | undefined,
): HealthView {
  if (engine?.kind !== "running")
    return healthViewOf(engineHealthOf(engine), t(engineTextOf(engine)));
  if (phase !== "live") {
    const tail = attempt > 0 ? ` ${t("desktop.status.link.attempt", { attempt })}` : "";
    return healthViewOf(LINK_HEALTH[phase], `${t(LINK_TEXT[phase])}${tail}`);
  }
  if (target?.kind === "remote")
    return healthViewOf("ok", t("desktop.status.engine.sourceRemote", { name: target.label }));
  return healthViewOf("ok", null);
}

/**
 * 엔진·연결 칸 하나(전에는 엔진 칸과 연결 칸 둘). 팝오버는 엔진 줄과 연결 줄, 그리고 지금 상태의 설명 한 문장이다.
 * 정상인 이 기기 엔진은 칸을 그리지 않는다(DP-206, 전에는 초록 점 하나). 상태 글은 줄의 숨은 낭독 영역이 그대로 말한다
 */
function HealthCell(props: {
  readonly engine: EngineState | null | undefined;
  readonly shown: EngineState | null | undefined;
  readonly phase: Link["phase"];
  readonly attempt: number;
}): ReactNode {
  const { engine, shown, phase, attempt } = props;
  const [open, setOpen] = useState(false);
  const target = useEngineTarget();
  const view = healthOf(engine, phase, attempt, target);
  if (view.text === null) return null;
  const linkLine = `${t(LINK_TEXT[phase])}${attempt > 0 ? ` ${t("desktop.status.link.attempt", { attempt })}` : ""}`;
  const description =
    engine?.kind === "running" && phase !== "live"
      ? linkDescriptionOf(phase, target.kind === "remote")
      : engineDescriptionOf(shown);
  return (
    <StatusCell
      cellId="health"
      text={view.text}
      label={t("desktop.status.health.label", {
        engine: engineLineOf(shown, target),
        link: linkLine,
      })}
      lead={view.busy ? <ProgressOrb size="sm" /> : undefined}
      tone={view.tone}
      collapseIcon={<Link2 className="size-3.5" />}
      title={t("desktop.status.health.title")}
      description={description === undefined ? undefined : t(description)}
      body={
        <dl className="m-0 mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-ui">
          <dt className="text-text-tertiary">{t("desktop.status.cell.engine.title")}</dt>
          <dd className="m-0 text-text-primary">{engineLineOf(shown, target)}</dd>
          <dt className="text-text-tertiary">{t("desktop.status.cell.link.title")}</dt>
          <dd className="m-0 text-text-primary">{linkLine}</dd>
        </dl>
      }
      open={open}
      onOpenChange={setOpen}
    />
  );
}

/** 샌드박스 켜짐 값을 읽는다(연결이 live일 때, 설정이 바뀔 때마다). 읽지 못하면 마지막 값을 둔다. 꺼졌으면 참 */
function useSandboxOff(): boolean {
  const commands = useCommands();
  const live = useLinkPhase() === "live";
  const [off, setOff] = useState(false);
  useEffect(() => {
    if (!live) return undefined;
    let stale = false;
    const read = (): void => {
      detach(
        commands.setup.loadSandboxEnabled().then((result) => {
          if (!stale && result.ok) setOff(!result.value);
          return undefined;
        }),
        rethrow,
      );
    };
    read();
    const unsubscribe = commands.setup.onAnyInvalidated(read);
    return () => {
      stale = true;
      unsubscribe();
    };
  }, [commands, live]);
  return live && off;
}

/** "샌드박스 꺼짐" 칸(DP-182). 샌드박스(기본 켬)를 끈 때만 경고색으로 보이고, 누르면 설명과 샌드박스 설정으로 가는 단추가 있다 */
export function SandboxOffCell(props: { readonly openSettings: () => void }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <StatusCell
      cellId="sandbox"
      text={t("desktop.status.sandboxOff")}
      icon={<Shield />}
      tone="warning"
      title={t("desktop.status.cell.sandbox.title")}
      description={t("desktop.status.cell.sandbox.description")}
      body={
        <Button
          size="xs"
          variant="outline"
          className="mt-1 justify-self-start"
          onClick={() => {
            setOpen(false);
            props.openSettings();
          }}
        >
          {t("desktop.status.cell.sandbox.open")}
        </Button>
      }
      open={open}
      onOpenChange={setOpen}
    />
  );
}

function SandboxCell(): ReactNode {
  const off = useSandboxOff();
  const commands = useCommands();
  if (!off) return null;
  return (
    <SandboxOffCell
      openSettings={() => {
        commands.requestSettingsJump({ tab: "sandbox", key: null });
      }}
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
            <h3 className="m-0 text-ui font-normal text-text-tertiary">{t(LIVE_HEAD[kind])}</h3>
            {items.map((row, index) => (
              // 대화 없는 실패 행은 대화 id가 없어 순서 번호로 연다(같은 묶음에 여럿이 올 수 있다)
              <LiveRowLine
                key={row.threadId ?? `failure-${index}`}
                row={row}
                goTo={goTo}
                close={close}
              />
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
  // 대화 id는 const로 좁혀 두어야 아래 누름 처리 안에서도 null이 아닌 값으로 읽힌다
  const { threadId } = row;
  if (threadId === null) return <ScheduleFailureLine reason={row.reason} />;
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
          <span className="truncate text-ui text-danger-text" title={failure}>
            {failure}
          </span>
        )}
      </span>
    </>
  );
  if (goTo === null)
    return (
      <div className="flex min-w-0 items-center gap-2 text-ui text-text-primary">{content}</div>
    );
  return (
    <Button
      size="sm"
      variant="ghost"
      className="-mx-1.5 h-auto min-w-0 justify-start px-1.5 py-1 text-start font-normal"
      onClick={() => {
        goTo(threadId);
        close();
      }}
    >
      {content}
    </Button>
  );
}

/**
 * 대화 없이 실패한 예약 실행의 한 줄. 이동할 대화가 없어 누를 수 없고, 아이콘과 위험 글로 실패를 보인다.
 * 글은 "예약 실행이 시작되지 못했어요: 사유"다
 */
function ScheduleFailureLine(props: { readonly reason: string | null }): ReactNode {
  const text = t("desktop.status.cell.live.scheduleRunFailed", {
    reason: props.reason ?? t("desktop.schedules.runs.reason.none"),
  });
  return (
    <div className="flex min-w-0 items-center gap-2 text-ui text-text-primary">
      <span
        aria-hidden
        className="inline-grid size-5 flex-none place-items-center rounded-md bg-danger-soft text-danger-text"
      >
        <TriangleAlert className="size-3.5" />
      </span>
      <span className="min-w-0 text-ui text-danger-text [overflow-wrap:anywhere]">{text}</span>
    </div>
  );
}

/**
 * "진행 중 n" 칸(DP-182, DP-207). 돌고 있는 것이 있을 때만 그리고, 누르면 오른쪽 막대의 실행 중 탭을 연다.
 * 전에는 대화 목록 팝오버였는데 실행 중 탭(DP-196)이 같은 대화를 하위 에이전트·기다림·방금 끝남과 함께 더 자세히 보이므로 길을 하나로 모았다
 */
function LiveCell(): ReactNode {
  const running = useRunningCount();
  const shell = useContext(ShellStoreContext);
  if (running === 0) return null;
  return (
    <StatusAction
      cellId="live"
      text={t("desktop.status.running", { count: running })}
      collapseIcon={<Play className="size-3.5" />}
      hint={t("desktop.status.cell.live.open")}
      onSelect={() => {
        shell?.actions.openEndTab(RUNNING_TAB_ID, "chat");
      }}
    />
  );
}

/**
 * "예약 실패 n" 칸과 Popover(N-58, DP-207). 예약에서 시작한 대화가 실패했거나 대화 없이 예약 실행이 실패했을 때만 위험 글자색으로 그린다.
 * 실행 중 탭은 방금 끝난 것만 남기고 대화 없는 실패는 싣지 않으므로 실패 목록은 이 팝오버가 맡는다. 행을 누르면 그 대화로 가고 Popover를 닫는다
 */
function FailedCell(): ReactNode {
  const scheduleFailures = useScheduleRunFailures();
  const rows = liveRowsOf(useThreadSummaries(), useTurnFailures(), scheduleFailures).filter(
    (row) => row.failed,
  );
  const goTo = useGoToThread();
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <StatusCell
      cellId="failed"
      text={t("desktop.status.liveFailed", { count: rows.length })}
      tone="danger"
      title={t("desktop.status.cell.failed.title")}
      wide
      open={open}
      onOpenChange={setOpen}
      body={
        <LiveList
          rows={rows}
          goTo={goTo}
          close={() => {
            setOpen(false);
          }}
        />
      }
    />
  );
}

/** 사용량 막대(시안 `TokenBar`, C-05 대용). 한도 비율을 알 때만 그린다. 장식이라 숨기고 칸 글이 뜻을 맡는다 */
function TokenBar(props: { readonly percent: number; readonly near: boolean }): ReactNode {
  // 채움은 평소 회색 그림 색이고(글보다 튀지 않게), 자동 요약이 가까우면 칸 글과 같은 경고색이다
  return (
    <Progress
      value={Math.round(props.percent)}
      decorative
      size="xs"
      tone={props.near ? "warning" : "neutral"}
      className="w-12"
    />
  );
}

/**
 * 컨텍스트 칸의 툴팁. 이 대화에서 쓴 토큰 수를 말하고, 한도를 알 때만 비율을 한 문장 더한다. 비율을 지어내지 않는다
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

/** 컨텍스트가 이 비율 이상 차면 칸을 경고 글자색으로 보인다(자동 요약이 가깝다, DP-182) */
export const CONTEXT_NEAR_PERCENT = 80;

/** 컨텍스트 칸의 글. 한도를 알면 "컨텍스트 42%", 모르면 "컨텍스트 4.1만"(토큰 수)이다 */
export function contextTextOf(usage: SessionUsage): string {
  return usage.percent === null
    ? t("desktop.status.contextTokens", { tokens: tokenCountText(usage.tokens) })
    : t("desktop.status.context", { percent: Math.round(usage.percent) });
}

/** 컨텍스트가 자동 요약에 가까운가. 한도를 모르면 판정하지 않는다 */
export function contextNearOf(usage: SessionUsage): boolean {
  return usage.percent !== null && usage.percent >= CONTEXT_NEAR_PERCENT;
}

/**
 * "컨텍스트" 칸(전 "사용량" 칸). 이 대화가 컨텍스트 창을 얼마나 채웠는지를 보이고, 한도를 알면 48px 막대를 붙인다.
 * 80% 이상이면 경고 글자색과 툴팁 한 문장을 더한다. 누르면 오른쪽 막대의 컨텍스트 탭을 연다(DP-207). 전에는 토큰·비용 내역 팝오버였는데
 * 컨텍스트 탭(DP-201~203)이 채움·자동 요약 문턱·구성·사용량 표를 모두 보이므로 같은 값을 두 곳에 두지 않는다
 */
export function ContextCell(props: { readonly usage: SessionUsage }): ReactNode {
  const { usage } = props;
  const shell = useContext(ShellStoreContext);
  const near = contextNearOf(usage);
  const description = tokensDescriptionOf(usage);
  return (
    <StatusAction
      cellId="context"
      collapseIcon={<Layers className="size-3.5" />}
      text={contextTextOf(usage)}
      tone={near ? "warning" : undefined}
      trailing={
        usage.percent === null ? undefined : <TokenBar percent={usage.percent} near={near} />
      }
      hint={near ? `${description} ${t("desktop.status.cell.context.near")}` : description}
      onSelect={() => {
        shell?.actions.openEndTab(CONTEXT_TAB_ID, "chat");
      }}
    />
  );
}

/** 컨텍스트와 목표 칸을 대화에 맞춰 읽는다. 훅은 대화 id가 있어야 하므로 대화가 있을 때만 이 조각을 그린다. 모델은 입력창 칩이 맡는다 */
function ThreadCells(props: { readonly threadId: ThreadId }): ReactNode {
  const running = useThreadRunning(props.threadId);
  const usage = useSessionUsage(props.threadId, running);
  return (
    <>
      <GoalCell threadId={props.threadId} />
      {usage === null ? null : <ContextCell usage={usage} />}
    </>
  );
}

/** 대화가 열려 있을 때만 대화 칸을 그린다(설정·크래프트 같은 화면에서는 전역 칸만 남는다) */
function UsageCells(): ReactNode {
  const threadId = useSelectedThreadId();
  if (threadId === null) return null;
  return <ThreadCells threadId={threadId} />;
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
    description: `${judged} (${state})`,
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

/**
 * "승인 대기 n" 칸. 답을 기다리는 승인이 있을 때만 그린다. 누르면 받은 요청 탭이 열린다(설명만 있는 팝오버를 거치지 않는다).
 * 점 없이 대화 목록의 확인 수와 같은 따뜻한 글자색·굵기로 구분한다(DP-206)
 */
function ApprovalsCell(props: {
  readonly count: number;
  /** 질문 카드면 참: "승인 대기" 대신 "답변 대기"로 센다(질문은 승인이 아니다) */
  readonly question?: boolean;
}): ReactNode {
  const shell = useContext(ShellStoreContext);
  return (
    <StatusAction
      cellId={props.question === true ? "questions" : "approvals"}
      text={t(
        props.question === true
          ? "desktop.status.questionsWaiting"
          : "desktop.status.approvalsWaiting",
        { count: props.count },
      )}
      tone="attention"
      collapseIcon={<Inbox className="size-3.5" />}
      hint={t("desktop.status.cell.approvals.open")}
      onSelect={() => {
        shell?.actions.openEndTab(INBOX_TAB_ID, "chat");
      }}
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
  const commands = useCommands();
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
        tone={updateToneOf(cell.dot)}
        title={t("desktop.update.cell.title")}
        description={description === undefined ? undefined : t(description)}
        wide
        open={open}
        onOpenChange={setOpen}
        body={
          <>
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
            {/* 업데이트의 자세한 상태와 확인 단추는 설정 일반 구역(앱 정보)에 있다(DP-104) */}
            <Button
              size="xs"
              variant="ghost"
              className="mt-1 -ms-2"
              data-update-settings=""
              onClick={() => {
                setOpen(false);
                commands.requestSettingsJump({ tab: "general", key: null });
              }}
            >
              {t("desktop.update.cell.openSettings")}
            </Button>
          </>
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

/**
 * 하단 상태 줄(DP-181, DP-182, DP-206). 바탕 없이 무대 위에 글과 표시만 뜬다. "정상임"은 글로 말하지 않는다: 엔진·연결이 정상이면 칸이 없다.
 * 왼쪽은 환경(엔진·연결 이상, 원격 엔진, 샌드박스 꺼짐, 안전 모드, 업데이트, 다시 시작 필요, 확장 칸), 오른쪽은 이 대화의 자원(목표, 컨텍스트)과
 * 돌고 있는 것(진행 중), 기다리는 것(승인 대기, 맨 끝)이다. 폴더·실행 위치·권한 모드·모델·추론은 입력창 칩이 맡아 여기 두지 않는다.
 * 실패 단추는 엔진·연결 칸 바로 뒤에 둔다
 */
export function StatusBar(): ReactNode {
  const commands = useCommands();
  const engineRaw = useEngineState();
  const linkPhase = useLinkPhase();
  // 화면의 엔진 줄은 연결이 live인 뒤에만 "실행 중"을 보인다. 엔진 꺼짐 판정은 실제 상태로 한다
  const engine = shownEngineOf(engineRaw, linkPhase === "live");
  const engineTarget = useEngineTarget();
  const banner = useLinkBanner();
  const questions = useQuestionCount();
  const approvals = useApprovalCount() - questions;
  const connectError = useConnectError();
  const restartNeeded = useRestartNeeded();
  // 엔진이 없으면 거울의 "진행 중" 수는 오래된 값이라 그 칸을 그리지 않는다(F-9)
  const engineGone = engineGoneOf(engineRaw, banner.phase);
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async (): Promise<void> => {
    setCopied(await commands.copyDiagnostics());
  };
  return (
    <footer className="statusbar">
      {/* 줄 전체를 낭독 영역으로 두면 갱신마다 읽힌다. 사용자가 알아야 할 바뀜(엔진 상태)만 이 한 줄이 맡는다 */}
      <span role="status" className="sr-only">
        {engineLineOf(engine, engineTarget)}
      </span>
      <HealthCell engine={engineRaw} shown={engine} phase={banner.phase} attempt={banner.attempt} />
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
      {/* 저장소가 손상됐거나 마이그레이션에 실패한 엔진 줄에서 데이터 복원 구역(설정의 고급 탭)을 연다. 엔진이 꺼져 있어도 열린다 */}
      {engineRestoreShownOf(engine) ? (
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            commands.requestSettingsJump({ tab: "advanced", key: null });
          }}
        >
          {t("desktop.status.engine.openRestore")}
        </Button>
      ) : null}
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
      <SandboxCell />
      <SafeModeChip />
      <UpdateCell />
      <RestartLine reasons={restartNeeded} />
      {connectError === null ? null : (
        <span className="error">{t("desktop.status.connectFailed", { error: connectError })}</span>
      )}
      <StatusItems />
      <StatusCells />
      <span className="grow" />
      <UsageCells />
      {engineGone ? null : (
        <>
          <LiveCell />
          <FailedCell />
        </>
      )}
      {questions > 0 ? <ApprovalsCell count={questions} question /> : null}
      {approvals > 0 ? <ApprovalsCell count={approvals} /> : null}
    </footer>
  );
}
