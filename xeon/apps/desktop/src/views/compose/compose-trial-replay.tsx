// 흐름 보기의 "다시 돌려 검사"와 그룹의 시험 결과(§6.28.4, §6.28.8, U-4). replay는 개발 모드에서만 돈다.
// 배포 앱이면 단추는 눌리는 모양(soft)이고 누르면 이유 툴팁을 보인다. 옆 "개발 모드 켜기…"는 설정 화면의 개발 모드 항목으로 옮긴다.
// 끝나면 목록을 다시 읽고(읽기 키의 차수를 올린다) 보고서를 테스트 화면의 판정 틀로 그린다. 다시 읽는 타이머는 없다.
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  DEV_MODE_SETTING_KEY,
  lastResultsOf,
  replayLockOf,
  reportJsonOf,
  type LastResultVM,
  type ReplayLock,
  type TabLink,
  type TabRead,
  type TestFailure,
  type TestState,
} from "@fresnel/client/workbench";
import { assertNever, attemptAsync, detach, rethrow } from "@fresnel/contracts";
import type { ReplayReport } from "@fresnel/contracts/services";
import type { ExtTestRecord } from "@fresnel/contracts/wire";
import { Alert, Button, Progress, Timeline, TimelineItem, Tooltip } from "@caustic/react";
import { Lock } from "@caustic/react/icons";
import { useCallback, useId, useState, type ReactNode } from "react";
import type { SettingsJump } from "../../state/ui/index.ts";
import { useCommands, type Commands, type TestCommands } from "../commands.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { ReplayResult, type TagTone } from "../tests/test-detail.tsx";
import { startTest } from "../tests/tests-actions.ts";
import {
  durationTextOf,
  noticeTextOf,
  STATE_TEXT,
  timeTextOf,
  VERDICT_TEXT,
} from "../tests/tests-text.ts";
import { useTabRead } from "../workbench/tab-read.ts";

const MUTED = "m-0 text-ui-sm text-text-tertiary";
const DEV_MODE_READ_KEY = "compose-trial-devmode";
const RESULTS_READ_KEY = "compose-trial-results";

/** "개발 모드 켜기…"가 여는 설정 자리: 플러그인 탭의 개발 모드 항목. 설정 화면이 받아 그 줄로 옮긴다 */
export const DEV_MODE_JUMP: SettingsJump = { tab: "plugins", key: DEV_MODE_SETTING_KEY };

/** 설정 화면을 개발 모드 항목으로 연다. 설정을 바꾸지는 않는다 */
export function requestDevModeSetting(commands: Pick<Commands, "requestSettingsJump">): void {
  commands.requestSettingsJump(DEV_MODE_JUMP);
}

/** 다시 돌려 검사의 결과. 시작이 거절되면 실패 종류, 끝났으면 보고서다(목록에서 찾지 못하면 null) */
export type ReplayRunOutcome =
  | { readonly ok: true; readonly report: ReplayReport | null }
  | { readonly ok: false; readonly failure: TestFailure };

/**
 * replay를 시작하고 끝난 보고서를 `ext.test.list`에서 찾는다. `ext.test.run`은 시험 id만 돌려주므로 보고서는 목록에 있다.
 * 목록을 읽지 못하면 보고서가 없는 것으로 본다(목록 자리가 읽기 오류를 따로 보인다).
 */
export async function replayTrialRun(
  tests: TestCommands,
  group: string,
): Promise<ReplayRunOutcome> {
  const started = await startTest(tests, { kind: "replay", target: group });
  if (!started.ok) return { ok: false, failure: started.failure };
  const listed = await tests.list();
  if (!listed.ok) return { ok: true, report: null };
  const record: ExtTestRecord | undefined = listed.value.find(
    (item) => item.testId === started.value,
  );
  return { ok: true, report: record?.replay ?? null };
}

type ReplayState =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "done"; readonly report: ReplayReport | null };

/** 알림 한 줄. 실패(`failed`)는 위험 색, 복사 성공 같은 것은 성공 색으로 보인다 */
interface ReplayNotice {
  readonly text: MessageId;
  readonly failed: boolean;
}

export interface ReplayController {
  /** 다시 돌려 검사의 대상(흐름을 낸 그룹) */
  readonly target: string;
  /** 개발 모드인가. 아직 읽지 않았거나 읽지 못하면 아니다 */
  readonly devMode: boolean;
  /** 잠긴 까닭. 열려 있으면 null */
  readonly lock: ReplayLock | null;
  readonly state: ReplayState;
  /** 시험 목록 읽기 상태. 이 그룹의 결과는 `lastResultsOf`가 고른다 */
  readonly results: TabRead<readonly ExtTestRecord[]>;
  readonly notice: ReplayNotice | null;
  readonly run: () => void;
  readonly reread: () => void;
  readonly copy: (report: ReplayReport) => void;
  readonly openDevMode: () => void;
  readonly dismiss: () => void;
}

/**
 * 다시 돌려 검사의 상태. 개발 모드 판정과 시험 목록은 `useTabRead`로 연결이 살아 있을 때 한 번 읽는다.
 * 시험을 돌린 뒤에는 목록의 읽기 키 차수를 올려 다시 읽는다. 다시 읽는 타이머는 두지 않는다.
 */
export function useReplayTrial(group: string, link: TabLink): ReplayController {
  const commands = useCommands();
  const online = link === "live";
  const [state, setState] = useState<ReplayState>({ kind: "idle" });
  const [notice, setNotice] = useState<ReplayNotice | null>(null);
  const [listing, setListing] = useState(0);
  const loadDevMode = useCallback(() => commands.tests.devMode(), [commands]);
  const devRead = useTabRead(DEV_MODE_READ_KEY, link, loadDevMode);
  const devMode = devRead.kind === "ready" && devRead.value;
  const loadResults = useCallback(() => commands.tests.list(), [commands]);
  const results = useTabRead(`${RESULTS_READ_KEY}.${String(listing)}`, link, loadResults);

  const reread = (): void => {
    setListing((current) => current + 1);
  };

  const runReplay = async (): Promise<void> => {
    setState({ kind: "running" });
    setNotice(null);
    const outcome = await replayTrialRun(commands.tests, group);
    if (!outcome.ok) {
      setState({ kind: "idle" });
      setNotice({ text: noticeTextOf({ kind: "failed", failure: outcome.failure }), failed: true });
      return;
    }
    reread();
    setState({ kind: "done", report: outcome.report });
  };

  const copyReport = async (report: ReplayReport): Promise<void> => {
    const written = await attemptAsync(() => commands.secrets.writeClipboard(reportJsonOf(report)));
    setNotice(
      written.ok
        ? { text: noticeTextOf({ kind: "copied" }), failed: false }
        : { text: noticeTextOf({ kind: "copyFailed" }), failed: true },
    );
  };

  return {
    target: group,
    devMode,
    lock: replayLockOf(devMode, online),
    state,
    results,
    notice,
    run: () => {
      detach(runReplay(), rethrow);
    },
    reread,
    copy: (report) => {
      detach(copyReport(report), rethrow);
    },
    openDevMode: () => {
      requestDevModeSetting(commands);
    },
    dismiss: () => {
      setNotice(null);
    },
  };
}

// ───────── 그림 ─────────

interface TagInfo {
  readonly tone: TagTone;
  readonly text: MessageId;
}

const STATE_TAG: Readonly<Record<TestState, TagInfo>> = {
  running: { tone: "neutral", text: STATE_TEXT.running },
  passed: { tone: "success", text: STATE_TEXT.passed },
  failed: { tone: "danger", text: STATE_TEXT.failed },
};

/** 지난 결과 한 줄의 표지. 보고서가 있으면 판정, 없으면 상태다 */
function resultTagOf(row: LastResultVM): TagInfo {
  if (row.verdict === null) return STATE_TAG[row.state];
  switch (row.verdict.kind) {
    case "same":
      return { tone: "success", text: VERDICT_TEXT.same };
    case "digest-differs":
      return { tone: "warning", text: VERDICT_TEXT["digest-differs"] };
    case "failure":
      return { tone: "danger", text: VERDICT_TEXT.failure };
    default:
      return assertNever(row.verdict, "ReplayVerdict");
  }
}

function durationLabelOf(ms: number | null): string {
  if (ms === null) return "—";
  const text = durationTextOf(ms);
  return t(text.key, { value: text.value });
}

function ReplayButton(props: { readonly replay: ReplayController }): ReactNode {
  const { replay } = props;
  const id = useId();
  const [tip, setTip] = useState(false);
  const label = t("desktop.compose.trial.replay.button");
  if (replay.lock === null) {
    return (
      <Button
        size="xs"
        variant="outline"
        disabled={replay.state.kind === "running"}
        onClick={() => {
          replay.run();
        }}
      >
        {label}
      </Button>
    );
  }
  // 잠긴 단추는 `disabled`가 아니다. 눌리는 모양으로 두고 누르면 이유 툴팁을 연다(비활성 단추는 툴팁을 못 띄운다)
  const reason = t(
    replay.lock === "offline"
      ? "desktop.compose.trial.offline"
      : "desktop.compose.trial.replay.locked",
  );
  return (
    <>
      <Tooltip
        content={<span className="block max-w-64 whitespace-normal">{reason}</span>}
        side="bottom"
        open={tip}
        onOpenChange={setTip}
      >
        <Button
          size="xs"
          variant="soft"
          iconStart={<Lock />}
          aria-disabled
          aria-describedby={id}
          className="text-text-tertiary"
          onClick={() => {
            // 누르면 연다. 초점이 먼저 열었을 수 있으므로 토글하지 않는다(닫기는 바깥 누르기와 Esc가 맡는다)
            setTip(true);
          }}
        >
          {label}
        </Button>
      </Tooltip>
      <span id={id} className="sr-only">
        {reason}
      </span>
    </>
  );
}

function ReplayDone(props: {
  readonly report: ReplayReport | null;
  readonly onCopy: (report: ReplayReport) => void;
}): ReactNode {
  const { report, onCopy } = props;
  if (report === null) return <p className={MUTED}>{t("desktop.compose.trial.replay.noReport")}</p>;
  return <ReplayResult report={report} onCopy={onCopy} limitInfo />;
}

/**
 * 지난 결과 한 줄: 시안의 기록 줄(Timeline)과 같은 모양. 판정은 제목 글과 줄 색, 시각은 time, 걸린 시간과 "가장 최근"은 detail에 둔다
 */
function ResultRow(props: { readonly row: LastResultVM; readonly latest: boolean }): ReactNode {
  const { row, latest } = props;
  const tag = resultTagOf(row);
  const duration = durationLabelOf(row.durationMs);
  return (
    <TimelineItem
      author="system"
      tone={tag.tone}
      title={t(tag.text)}
      time={timeTextOf(row.startedMs)}
      detail={latest ? `${duration} · ${t("desktop.compose.trial.results.latest")}` : duration}
    />
  );
}

function ResultsBody(props: {
  readonly replay: ReplayController;
  readonly label: string;
}): ReactNode {
  const { replay, label } = props;
  const read = replay.results;
  switch (read.kind) {
    case "loading":
      return (
        <p role="status" aria-busy="true" className={MUTED}>
          {t("desktop.tests.loading")}
        </p>
      );
    case "offline":
      return <p className={MUTED}>{t("desktop.tests.offline")}</p>;
    case "error":
      return (
        <Alert
          tone="danger"
          variant="soft"
          size="sm"
          action={
            <Button size="xs" variant="outline" onClick={replay.reread}>
              {t("desktop.tests.retry")}
            </Button>
          }
        >
          {t("desktop.compose.trial.results.loadFailed")}
        </Alert>
      );
    case "ready": {
      const { rows, latest } = lastResultsOf(read.value, replay.target);
      return (
        <div className="grid gap-3">
          {read.stale ? <p className={MUTED}>{t("desktop.tests.stale")}</p> : null}
          {rows.length === 0 ? (
            <p className={MUTED}>{t("desktop.compose.trial.results.empty")}</p>
          ) : (
            <Timeline aria-label={label} size="sm">
              {rows.map((row) => (
                <ResultRow key={row.testId} row={row} latest={latest?.testId === row.testId} />
              ))}
            </Timeline>
          )}
        </div>
      );
    }
    default:
      return assertNever(read, "TabRead");
  }
}

/** 시험 결과 목록. 개발 모드면 "시험 결과", 배포 앱이면 읽기 전용 "지난 결과"와 그 까닭(설명 아이콘 뒤)이다 */
function ResultsSection(props: { readonly replay: ReplayController }): ReactNode {
  const { replay } = props;
  const heading = t(
    replay.devMode ? "desktop.compose.trial.results.heading" : "desktop.compose.trial.results.past",
  );
  return (
    <section aria-label={heading} className="grid gap-3">
      <div className="flex flex-wrap items-center gap-1">
        <h3 className="m-0 text-title-3 text-text-primary">{heading}</h3>
        {replay.devMode ? null : <InfoTip text={t("desktop.compose.trial.results.readOnly")} />}
      </div>
      <ResultsBody replay={replay} label={heading} />
    </section>
  );
}

/** 다시 돌려 검사 줄: 단추(잠기면 이유 툴팁과 "개발 모드 켜기…"), 진행, 보고서, 알림, 시험 결과 목록 */
export function ReplayBar(props: { readonly replay: ReplayController }): ReactNode {
  const { replay } = props;
  const running = replay.state.kind === "running";
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ReplayButton replay={replay} />
        {replay.lock === "devMode" ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              replay.openDevMode();
            }}
          >
            {t("desktop.compose.trial.devMode.open")}
          </Button>
        ) : null}
        <InfoTip text={t("desktop.compose.trial.replay.info")} />
      </div>
      {running ? (
        <div className="flex items-center gap-2 text-ui-sm text-text-secondary">
          <Progress
            indeterminate
            size="sm"
            aria-label={t("desktop.compose.trial.replay.running")}
          />
          <span>{t("desktop.compose.trial.replay.running")}</span>
        </div>
      ) : null}
      {replay.state.kind === "done" ? (
        <ReplayDone report={replay.state.report} onCopy={replay.copy} />
      ) : null}
      {replay.notice === null ? null : (
        <Alert
          tone={replay.notice.failed ? "danger" : "success"}
          variant="soft"
          size="sm"
          dismissible
          dismissLabel={t("desktop.compose.dismiss")}
          onDismiss={replay.dismiss}
        >
          {t(replay.notice.text)}
        </Alert>
      )}
      <ResultsSection replay={replay} />
    </div>
  );
}
