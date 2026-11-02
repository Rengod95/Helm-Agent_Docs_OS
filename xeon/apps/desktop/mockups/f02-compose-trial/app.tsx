// N-40 구성기 흐름 테스트 실행 시안. 머리 아래 한 줄이 조종 막대이고(멈춤·이어서·한 단계씩·다시 돌려 검사), 흐름 판은 trial.phase 값으로 그린다.
// 오른쪽은 계기 열. 멈춤은 다음 단계 사이까지 기다린다: 누르면 "멈추는 중"(잠김), 도착하면 멈출 노드에 표지(C-9). 주도는 놓지 않는다.
import {
  Button,
  Dialog,
  DialogClose,
  Field,
  Input,
  SegmentedControl,
  SegmentedControlItem,
  Tooltip,
} from "@caustic/react";
import { useCallback, useEffect, useReducer, useState } from "react";
import {
  LoaderCircle,
  Lock,
  NoticeList,
  Pause,
  Play,
  ScenarioDock,
  Shell,
  T,
  WorkbenchHead,
  defaultStatusCells,
  inbox,
  josa,
  useScenarioParam,
  useShell,
  workbenchRightTabs,
} from "../_shell";
import { StatusDot } from "../_wb-c/parts";
import { FlowBoard, type FlowMarker, PHASE_LABEL } from "../f01-compose-entry/parts/flow-board";
import { lenses as baseLenses, type Lens } from "../wb-compose/fixtures";
import { RailRule } from "../wb-compose/parts/rail";
import {
  AT,
  FIRST_DIFF,
  SCENARIOS,
  SCRIPTS,
  modelAt,
  nextAuto,
  phaseOfCut,
  reduce,
  type Action,
  type Model,
  type StateId,
} from "./flow";
import { TrialAside } from "./parts/aside";

const q = new URLSearchParams(window.location.search);
const HOLD = q.get("hold") === "1";
const REPO = "~/code/fresnel";

function statusText(s: Model): string {
  if (s.replay !== null) return `${T.replay} 도는 중`;
  switch (s.run) {
    case "running":
      return "실행 중";
    case "pausing":
      return `${T.trialPausing} · 이번 ${T.step}가 끝나면 멈춰요`;
    case "paused":
      return `${T.stepBoundary}에서 ${T.trialPause} · ${T.lead} helm 유지`;
    case "stepping":
      return `${PHASE_LABEL[s.now]} ${T.step}만 돌고 다시 멈춰요`;
    case "done":
      return `${T.trial} ${T.stageDone} · 적용함`;
  }
}

const ELAPSED: Record<Model["run"], string> = {
  running: "1:12",
  pausing: "1:18",
  paused: "1:24",
  stepping: "1:24",
  done: "3:06",
};

function TrialBar({
  s,
  dispatch,
  onNote,
}: {
  s: Model;
  dispatch: (a: Action) => void;
  onNote: (t: string) => void;
}) {
  const busy = s.run === "pausing" || s.run === "stepping" || s.replay !== null;
  const done = s.run === "done";
  const paused = s.run === "paused";
  const reason = `배포 앱이라 잠겨 있어요. ${josa(T.devMode, "을", "를")} 켜면 ${T.repoPath}의 테스트 도구로 돌려요.`;
  return (
    <div className="flex min-w-0 flex-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <span className="flex min-w-0 flex-1 basis-72 items-center gap-2 text-body text-text-primary">
        {busy ? (
          <LoaderCircle
            aria-hidden
            className="size-icon-xs flex-none animate-spin text-text-tertiary motion-reduce:animate-none"
          />
        ) : (
          <StatusDot tone="neutral" />
        )}
        <span role="status" className="min-w-0">
          {statusText(s)}
        </span>
        <span className="flex-none text-footnote text-text-tertiary tabular-nums">
          {`${T.trialThread} ${ELAPSED[s.run]}${s.dev ? ` · ${T.devMode}` : ""}`}
        </span>
      </span>
      <span className="flex flex-none items-center gap-2">
        {!done && !paused && (
          <Button
            size="xs"
            variant="outline"
            iconStart={<Pause />}
            disabled={s.run !== "running"}
            onClick={() => dispatch({ t: "pause" })}
          >
            {s.run === "pausing" ? T.trialPausing : T.trialPause}
          </Button>
        )}
        {paused && (
          <Button
            size="xs"
            variant="solid"
            iconStart={<Play />}
            onClick={() => dispatch({ t: "resume" })}
          >
            {T.trialResume}
          </Button>
        )}
        {!done && (
          <Button
            size="xs"
            variant="outline"
            disabled={!paused}
            onClick={() => dispatch({ t: "step" })}
          >
            {T.stepOnce}
          </Button>
        )}
        {s.dev ? (
          <Button
            size="xs"
            variant={s.report ? "outline" : "solid"}
            disabled={!done || s.replay !== null}
            onClick={() => dispatch({ t: "runReplay" })}
          >
            {s.report ? "다시 실행" : T.replay}
          </Button>
        ) : (
          <>
            <Tooltip
              content={<span className="block max-w-64 whitespace-normal">{reason}</span>}
              side="bottom"
              open={s.tip}
            >
              <Button
                size="xs"
                tone="neutral"
                variant="soft"
                iconStart={<Lock />}
                aria-disabled
                aria-describedby="replay-lock"
                onClick={() => dispatch({ t: "tip" })}
                className="text-text-tertiary"
              >
                {T.replay}
              </Button>
            </Tooltip>
            <span id="replay-lock" className="sr-only">
              {reason}
            </span>
          </>
        )}
        {!s.dev && done && (
          <Button size="xs" variant="outline" onClick={() => dispatch({ t: "openDev" })}>
            {`${T.devMode} 켜기…`}
          </Button>
        )}
        <Button
          size="xs"
          variant="outline"
          disabled={!done}
          onClick={() => onNote(`${T.trials}에서 결과를 열어요`)}
        >
          {`${T.trial} 결과`}
        </Button>
      </span>
    </div>
  );
}

function marker(s: Model): FlowMarker | null {
  if (s.report)
    return { at: "converge", text: `${T.firstDiff} · 절단 ${FIRST_DIFF}`, danger: true };
  if (s.replay !== null && s.replay >= FIRST_DIFF)
    return { at: "converge", text: `${T.firstDiff} · 절단 ${FIRST_DIFF}`, danger: true };
  if (s.run === "pausing") return { at: "converge", text: "여기 앞에서 멈춰요", pending: true };
  if (s.run === "stepping") return { at: "apply", text: "여기 앞에서 다시 멈춰요", pending: true };
  if (s.run === "paused") return { at: s.now, text: `여기 앞에서 ${T.trialPause}` };
  return null;
}

function DevDialog({ s, dispatch }: { s: Model; dispatch: (a: Action) => void }) {
  const checking = s.dialog === "checking";
  return (
    <Dialog
      size="sm"
      open={s.dialog !== "closed"}
      onOpenChange={(o: boolean) => {
        if (!o && !checking) dispatch({ t: "closeDev" });
      }}
      title={`${T.devMode} 켜기`}
      description={`저장소의 테스트 도구로 ${josa(T.replay, "을", "를")} 돌려요.`}
      footer={
        <>
          <DialogClose asChild>
            <Button size="sm" tone="neutral" variant="outline" disabled={checking}>
              취소
            </Button>
          </DialogClose>
          <Button
            size="sm"
            tone="neutral"
            variant="solid"
            disabled={checking}
            onClick={() => dispatch({ t: "check" })}
          >
            {checking ? "확인 중" : "켜기"}
          </Button>
        </>
      }
    >
      <Field label={T.repoPath}>
        <Input size="xs" defaultValue={REPO} className="font-mono" />
      </Field>
    </Dialog>
  );
}

function hint(s: Model): string | undefined {
  if (s.run === "running" && s.now === "explore") return `"${T.trialPause}"`;
  if (s.run === "paused") return s.now === "converge" ? `"${T.stepOnce}"` : `"${T.trialResume}"`;
  if (s.run === "done" && !s.dev) return s.tip ? `"${T.devMode} 켜기…"` : `잠긴 "${T.replay}"`;
  if (s.dialog === "open") return `"켜기"`;
  if (s.dev && !s.report && s.replay === null) return `"${T.replay}"`;
  return undefined;
}

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const scenario = useScenarioParam();
  const live = scenario !== null && SCRIPTS[scenario] !== undefined;
  const [s, rawDispatch] = useReducer(reduce, undefined, () => {
    if (live) return modelAt(scenario, Number(q.get("step") ?? "0"));
    const at = AT[state];
    return modelAt(at.script, at.n);
  });
  const [note, setNote] = useState<string | null>(null);
  // 정적 상태(?state=)는 그 모습에 머문다. 시간으로 넘어가는 자리는 시나리오이거나 사용자가 누른 뒤에만 돈다.
  const [touched, setTouched] = useState(false);
  const dispatch = useCallback((a: Action) => {
    setTouched(true);
    rawDispatch(a);
  }, []);

  useEffect(() => {
    if (HOLD || (!live && !touched)) return;
    const next = nextAuto(s);
    if (next === null) return;
    const id = window.setTimeout(() => rawDispatch(next.action), next.after);
    return () => window.clearTimeout(id);
  }, [s, live, touched]);

  useEffect(() => {
    if (note === null) return;
    const id = window.setTimeout(() => setNote(null), 2400);
    return () => window.clearTimeout(id);
  }, [note]);

  const now = s.replay !== null ? phaseOfCut(s.replay) : s.now;
  const joined = s.lenses === "joined" || s.replay !== null;
  const lenses = baseLenses.map((l): Lens =>
    joined && l.status === "running" ? { ...l, status: "done", findings: 1 } : l,
  );
  const drawn = s.replay !== null ? { ...s, now } : s;

  return (
    <>
      <Shell
        activeNav="compose"
        onNavSelect={() => setNote("이 화면은 다른 크래프트 시안에 있어요")}
        workbench={{ onGoToThread: () => shell.setArea("chat") }}
        stageLabel={`${T.compose} ${T.trial}`}
        threads={{ currentId: "t8", onSelect: () => {}, onNew: () => {} }}
        rightTabs={workbenchRightTabs({
          inbox: <NoticeList notices={inbox.notices} />,
          inboxBadge: 5,
          onGoToThread: () => shell.setArea("chat"),
        })}
        status={defaultStatusCells({
          layout: shell.layout,
          thread: false,
          pendingApprovals: 0,
          openEnd: shell.openEnd,
          runtime: { drive: "helm", extFailures: 0, onOpen: () => {} },
        })}
      >
        <div className="relative mx-2 flex min-h-0 flex-1 flex-col">
          <WorkbenchHead
            className="w-full px-4"
            title={T.compose}
            meta="helm"
            actions={
              <SegmentedControl
                size="xs"
                value="flow"
                aria-label="구성기 보기"
                onValueChange={() => setNote("이 시안은 흐름 보기만 있어요")}
              >
                <SegmentedControlItem value="group">{T.group}</SegmentedControlItem>
                <SegmentedControlItem value="flow">{T.composeFlow}</SegmentedControlItem>
                <SegmentedControlItem value="profile">{T.profile}</SegmentedControlItem>
                <SegmentedControlItem value="code">{T.composeCode}</SegmentedControlItem>
              </SegmentedControl>
            }
          />
          <RailRule />
          <TrialBar s={s} dispatch={dispatch} onNote={setNote} />
          <RailRule />
          <div className="flex min-h-0 flex-1">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <FlowBoard
                label={`helm ${T.phaseMachine}`}
                mode="trial"
                now={now}
                holding={s.run === "paused"}
                finished={s.run === "done" && s.replay === null}
                lenses={lenses}
                guardHits={1}
                marker={marker(s)}
              />
            </div>
            <TrialAside s={drawn} onCopy={() => setNote("JSON을 복사했어요")} />
          </div>
          {note !== null && (
            <div
              role="status"
              className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center"
            >
              <span className="animate-enter rounded-lg bg-surface-raised px-3 py-1.5 text-ui-dense text-text-primary shadow-3">
                {note}
              </span>
            </div>
          )}
        </div>
      </Shell>
      <DevDialog s={s} dispatch={dispatch} />
      <ScenarioDock scenarios={SCENARIOS} hint={live ? hint(s) : undefined} />
    </>
  );
}
