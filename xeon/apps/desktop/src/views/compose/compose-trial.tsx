// 흐름 보기의 시험 실행(§6.28.4, S6). "시험 대화에서 돌려 보기"는 Test run 대화를 만들고(고른 프로필을 싣고) 이 그룹을 그 대화에서 켠다.
// 그러면 같은 흐름 자리 위에 조종 한 줄이 나타난다: 멈춤·이어서·한 경계씩, 지금 단계, 새로 읽기, 끝내기. 명령 뒤에 단계를 한 번 읽고, 다시 읽는 타이머는 없다.
// 드라이브 락 막대, 가드 칩, 경계 기록, replay로, 시험 결과는 wire가 없어 그리지 않는다(§6.28.8).
import { t, type MessageId } from "@fresnel/client/i18n";
import type { RunControl, TabLink, TestFailure } from "@fresnel/client/workbench";
import { assertNever, detach, parse, rethrow } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import { Alert, Button, Field, Select, SelectOption } from "@caustic/react";
import { useCallback, useState, type ReactNode } from "react";
import { useCommands, type Commands, type TestCommands } from "../commands.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { createTestRunThread, runControl } from "../tests/tests-actions.ts";
import { noticeTextOf, testFailureOf } from "../tests/tests-text.ts";
import { useTabRead } from "../workbench/tab-read.ts";

const MUTED = "m-0 text-ui-sm text-text-tertiary";
/** 프로필 고르기의 "없음" 값. Radix Select는 빈 문자열 값을 받지 않아 따로 둔다 */
const NO_PROFILE = "\u0000none";
const PROFILE_LIST_KEY = "compose-trial-profiles";
const ID_SHOWN = 12;

export type TrialMode = "running" | "pausing" | "paused";

/** 지금 단계 읽기 값. 읽지 못한 것(failed)과 단계가 아직 없는 것(ready, phase null)은 다르다 */
export type PhaseRead =
  | { readonly kind: "reading" }
  | { readonly kind: "ready"; readonly phase: string | null }
  | { readonly kind: "failed" };

export interface TrialRun {
  readonly threadId: ThreadId;
  readonly mode: TrialMode;
  /** 명령이나 단계 읽기가 가는 중이면 참. 가는 동안 조종은 모두 잠긴다 */
  readonly busy: boolean;
  readonly phase: PhaseRead;
}

interface TrialNotice {
  readonly text: MessageId;
  /** 시험 대화는 만들었지만 그룹을 켜지 못했을 때 그 대화 id */
  readonly orphan: string | null;
}

export type TrialStart =
  | { readonly ok: true; readonly threadId: ThreadId }
  | { readonly ok: false; readonly failure: TestFailure; readonly threadId: ThreadId | null };

/**
 * 시험 대화 만들기와 그룹 켜기. 만들기가 실패하면 대화가 없고, 켜기가 실패하면 만든 대화 id를 함께 돌려준다.
 * 대화는 `thread.create`가 고른 프로필을 싣고, 그룹 켜기는 그 대화 범위(`launch`)에 쓴다.
 */
export async function startTrialRun(
  commands: Pick<Commands, "tests" | "workbench">,
  input: { readonly group: string; readonly profileId: string | undefined },
): Promise<TrialStart> {
  const made = await createTestRunThread(commands.tests, input.profileId);
  if (!made.ok) return { ok: false, failure: made.failure, threadId: null };
  const threadId = parse(ThreadIdSchema, made.value);
  if (!threadId.ok) return { ok: false, failure: "failed", threadId: null };
  const enabled = await commands.workbench.toggleForThread({
    key: `ext.${input.group}.enabled`,
    value: true,
    scope: "launch",
    threadId: threadId.value,
  });
  if (!enabled.ok) {
    return { ok: false, failure: testFailureOf(enabled.error), threadId: threadId.value };
  }
  return { ok: true, threadId: threadId.value };
}

/** 지금 단계 읽기. 읽지 못하면 `failed`다(단계가 없는 것과 다르다) */
export async function readPhaseOf(tests: TestCommands, threadId: string): Promise<PhaseRead> {
  const got = await tests.phase(threadId);
  return got.ok ? { kind: "ready", phase: got.value.phase } : { kind: "failed" };
}

/** 조종 결과로 정한 모습. 멈춤 결과가 아직 멈춘 채가 아니면 "멈추는 중"으로 둔다(경계에 닿았는지는 wire가 알려 주지 않는다) */
export function modeAfter(action: RunControl, paused: boolean): TrialMode {
  if (paused) return "paused";
  return action === "pause" ? "pausing" : "running";
}

/** 노드를 강조할 단계 이름. 읽지 못했거나 단계가 없으면 null이라 노드를 강조하지 않는다 */
export function trialPhaseOf(read: PhaseRead): string | null {
  return read.kind === "ready" ? read.phase : null;
}

/** 머리 글자만 보인다. 전체 id는 title로 본다 */
export function shortIdOf(id: string): string {
  return id.slice(0, ID_SHOWN);
}

/** 기다리지 않는 조종 작업. 실패는 화면 상태로 가고, 그 밖의 던짐은 다시 던진다 */
function later(job: Promise<void>): void {
  detach(job, rethrow);
}

export interface TrialController {
  readonly online: boolean;
  readonly run: TrialRun | null;
  readonly starting: boolean;
  readonly notice: TrialNotice | null;
  readonly start: (profileId: string | undefined) => void;
  readonly control: (action: RunControl) => void;
  readonly reread: () => void;
  readonly leave: () => void;
  readonly dismiss: () => void;
}

/** 흐름 보기의 시험 실행 상태. 명령 결과만 상태에 넣고, 다시 읽는 타이머는 두지 않는다 */
export function useTrialRun(group: string, link: TabLink): TrialController {
  const commands = useCommands();
  const [run, setRun] = useState<TrialRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<TrialNotice | null>(null);
  const online = link === "live";

  const patch = (change: Partial<TrialRun>): void => {
    setRun((current) => (current === null ? null : { ...current, ...change }));
  };

  const start = async (profileId: string | undefined): Promise<void> => {
    setStarting(true);
    setNotice(null);
    const outcome = await startTrialRun(commands, { group, profileId });
    setStarting(false);
    if (!outcome.ok) {
      setNotice({
        text: noticeTextOf({ kind: "failed", failure: outcome.failure }),
        orphan: outcome.threadId,
      });
      return;
    }
    setRun({ threadId: outcome.threadId, mode: "running", busy: true, phase: { kind: "reading" } });
    const phase = await readPhaseOf(commands.tests, outcome.threadId);
    patch({ phase, busy: false });
  };

  const control = async (action: RunControl): Promise<void> => {
    if (run === null) return;
    const { threadId, mode } = run;
    patch(action === "pause" ? { busy: true, mode: "pausing" } : { busy: true });
    const done = await runControl(commands.tests, action, threadId);
    if (!done.ok) {
      patch({ busy: false, mode });
      setNotice({ text: noticeTextOf({ kind: "failed", failure: done.failure }), orphan: null });
      return;
    }
    const phase = await readPhaseOf(commands.tests, threadId);
    patch({ mode: modeAfter(action, done.value), phase, busy: false });
  };

  const reread = async (): Promise<void> => {
    if (run === null) return;
    patch({ busy: true });
    const phase = await readPhaseOf(commands.tests, run.threadId);
    patch({ phase, busy: false });
  };

  return {
    online,
    run,
    starting,
    notice,
    start: (profileId) => {
      later(start(profileId));
    },
    control: (action) => {
      later(control(action));
    },
    reread: () => {
      later(reread());
    },
    leave: () => {
      setRun(null);
      setNotice(null);
    },
    dismiss: () => {
      setNotice(null);
    },
  };
}

const MODE_TEXT: Readonly<Record<TrialMode, MessageId>> = {
  running: "desktop.compose.trial.running",
  pausing: "desktop.compose.trial.pausing",
  paused: "desktop.compose.trial.paused",
};

function PhaseText(props: { readonly read: PhaseRead }): ReactNode {
  const { read } = props;
  switch (read.kind) {
    case "reading":
      return (
        <span className="text-text-secondary">{t("desktop.compose.trial.phase.reading")}</span>
      );
    case "failed":
      return <span className="text-danger-text">{t("desktop.compose.trial.phase.failed")}</span>;
    case "ready":
      return read.phase === null ? (
        <span className="text-text-secondary">{t("desktop.compose.trial.phase.none")}</span>
      ) : (
        <span className="font-mono text-text-primary">{read.phase}</span>
      );
    default:
      return assertNever(read, "PhaseRead");
  }
}

/** 실행 줄: 대화 id, 상태 문장, 지금 단계, 조종 단추. 조종 중이거나 연결이 없으면 단추는 모두 잠긴다 */
function RunRow(props: { readonly trial: TrialController; readonly run: TrialRun }): ReactNode {
  const { trial, run } = props;
  const locked = !trial.online || run.busy;
  const pausing = run.mode === "pausing";
  return (
    <section
      aria-label={t("desktop.compose.trial.run.label")}
      className="grid gap-2 rounded-xl border border-border-subtle p-3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-ui-sm">
        <span className="flex items-baseline gap-1.5">
          <span className="text-text-tertiary">{t("desktop.compose.trial.run.thread")}</span>
          <span className="font-mono text-text-primary" title={run.threadId}>
            {shortIdOf(run.threadId)}
          </span>
        </span>
        <span role="status" className="text-text-primary">
          {t(MODE_TEXT[run.mode])}
        </span>
        <span className="flex items-baseline gap-1.5">
          <span className="text-text-tertiary">{t("desktop.compose.trial.phase.label")}</span>
          <PhaseText read={run.phase} />
        </span>
        <InfoTip text={t("desktop.compose.trial.control.info")} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {run.mode === "paused" ? null : (
          <Button
            size="xs"
            variant="outline"
            disabled={locked || pausing}
            onClick={() => trial.control("pause")}
          >
            {t(
              pausing
                ? "desktop.compose.trial.control.pausing"
                : "desktop.compose.trial.control.pause",
            )}
          </Button>
        )}
        {run.mode === "running" ? null : (
          <Button
            size="xs"
            variant="solid"
            disabled={locked}
            onClick={() => trial.control("resume")}
          >
            {t("desktop.compose.trial.control.resume")}
          </Button>
        )}
        <Button
          size="xs"
          variant="outline"
          disabled={locked || run.mode !== "paused"}
          onClick={() => trial.control("step")}
        >
          {t("desktop.compose.trial.control.step")}
        </Button>
        <Button size="xs" variant="outline" disabled={locked} onClick={() => trial.reread()}>
          {t("desktop.compose.trial.control.reread")}
        </Button>
        <Button size="xs" variant="outline" disabled={locked} onClick={() => trial.leave()}>
          {t("desktop.compose.trial.control.leave")}
        </Button>
      </div>
      {trial.online ? null : <p className={MUTED}>{t("desktop.compose.trial.offline.run")}</p>}
    </section>
  );
}

/** 시작 줄: 프로필 고르기, "시험 대화에서 돌려 보기", 설명. 설치되지 않은 그룹은 잠기고 이유를 보인다 */
function StartRow(props: {
  readonly trial: TrialController;
  readonly link: TabLink;
  readonly installed: boolean;
}): ReactNode {
  const { trial, link, installed } = props;
  const commands = useCommands();
  const load = useCallback(() => commands.workbench.profiles(), [commands]);
  const read = useTabRead(PROFILE_LIST_KEY, link, load);
  const [profileId, setProfileId] = useState<string | null>(null);
  const profiles = read.kind === "ready" ? read.value : [];
  const locked = !trial.online || !installed || trial.starting;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("desktop.compose.trial.profile")}>
          <Select
            value={profileId ?? NO_PROFILE}
            disabled={locked || read.kind !== "ready"}
            onValueChange={(value) => {
              setProfileId(value === NO_PROFILE ? null : value);
            }}
          >
            <SelectOption value={NO_PROFILE}>
              {t("desktop.compose.trial.profile.none")}
            </SelectOption>
            {profiles.map((item) => (
              <SelectOption key={item.id} value={item.id}>
                {item.title}
              </SelectOption>
            ))}
          </Select>
        </Field>
        <Button
          size="sm"
          variant="outline"
          disabled={locked}
          onClick={() => trial.start(profileId ?? undefined)}
        >
          {t("desktop.compose.trial.start")}
        </Button>
        <InfoTip
          text={
            installed
              ? t("desktop.compose.trial.info")
              : t("desktop.compose.trial.notInstalled.info")
          }
        />
      </div>
      {installed ? null : <p className={MUTED}>{t("desktop.compose.trial.notInstalled")}</p>}
      {read.kind === "error" ? (
        <p className={MUTED}>{t("desktop.compose.profile.loadFailed")}</p>
      ) : null}
      {trial.online ? null : <p className={MUTED}>{t("desktop.compose.trial.offline")}</p>}
    </div>
  );
}

export interface TrialBarProps {
  readonly link: TabLink;
  /** 흐름을 낸 그룹이 설치되어 있나. 아니면 시험을 돌릴 수 없다 */
  readonly installed: boolean;
  readonly trial: TrialController;
}

/** 흐름 머리 아래의 시험 줄: 시작 줄 또는 실행 줄, 그 아래에 실패 알림 하나 */
export function TrialBar(props: TrialBarProps): ReactNode {
  const { trial } = props;
  return (
    <div className="grid gap-2">
      {trial.run === null ? (
        <StartRow trial={trial} link={props.link} installed={props.installed} />
      ) : (
        <RunRow trial={trial} run={trial.run} />
      )}
      {trial.notice === null ? null : (
        <Alert
          tone="danger"
          dismissible
          dismissLabel={t("desktop.compose.dismiss")}
          onDismiss={trial.dismiss}
        >
          {t(trial.notice.text)}
          {trial.notice.orphan === null ? null : (
            <> {t("desktop.compose.trial.error.orphan", { id: shortIdOf(trial.notice.orphan) })}</>
          )}
        </Alert>
      )}
    </div>
  );
}
