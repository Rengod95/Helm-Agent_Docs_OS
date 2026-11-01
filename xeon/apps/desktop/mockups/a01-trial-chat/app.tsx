// 시험 대화 화면(P-02 위, §6.30): 머리 "시험" 표지 + 적용 프로필 + 대상 확장, 런타임 줄, 입력창 위 시험 제어 띠
// (실행 중 → 멈추는 중 → 단계 사이에서 멈춤·진행권 유지 → 한 단계씩 / 이어서 → 끝 → 끝난 시험 지우기),
// 왼쪽 목록의 "시험" 묶음(실행 중·멈춤 표지), 오른쪽 런타임 탭(진행권, 시험 표지, 경계 기록).
import { Badge, EmptyState, Message, Toaster, toast } from "@caustic/react";
import { useState } from "react";
import {
  ArrowRightToLine,
  chatRightTabs,
  CircleAlert,
  defaultStatusCells,
  FlaskConical,
  inbox,
  josa,
  LoaderCircle,
  NoticeList,
  Pause,
  Play,
  profiles,
  ScenarioDock,
  Shell,
  T,
  threads,
  useShell,
  type Thread,
  type TrialState,
} from "../_shell";
import {
  ChatComposer,
  ChatHead,
  ChatStage,
  RuntimePanel,
  RuntimeRow,
  Streamed,
  useMachine,
  usePrefill,
  type RuntimeData,
} from "../_chat-rt";
import { ToolRow } from "../p02-opus/parts/tool-row";
import { effect, init, PROMPT, reduce, SCRIPTS, TOTAL, type A, type Item, type S } from "./flow";
import { TrialBand, type BandAction } from "./parts/trial-band";

export const STATES = [
  { id: "paused", label: "멈춤(단계 사이)" },
  { id: "draft", label: "새 시험 대화" },
  { id: "running", label: "실행 중" },
  { id: "pausing", label: "멈추는 중" },
  { id: "stepping", label: "한 단계씩" },
  { id: "queued", label: "멈춤 중 입력 큐" },
  { id: "finished", label: "끝" },
  { id: "cleared", label: "끝난 시험 지움" },
  { id: "disabled", label: "대상 자동 꺼짐" },
  { id: "narrow", label: "좁은 폭(390)" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const AT: Record<StateId, { script: string; n: number }> = {
  paused: { script: "trial-flow", n: 5 },
  draft: { script: "trial-flow", n: 0 },
  running: { script: "trial-flow", n: 3 },
  pausing: { script: "trial-flow", n: 4 },
  stepping: { script: "trial-flow", n: 6 },
  queued: { script: "trial-queue", n: 6 },
  finished: { script: "trial-flow", n: 12 },
  cleared: { script: "trial-flow", n: 13 },
  disabled: { script: "trial-autodisable", n: 5 },
  narrow: { script: "trial-flow", n: 5 },
};

const SCENARIOS = [
  { id: "trial-flow", label: "시험: 시작→멈춤→한 단계→이어서→끝→정리" },
  { id: "trial-queue", label: "시험: 멈춘 동안 입력은 큐로" },
  { id: "trial-autodisable", label: "실패: 대상 자동 꺼짐" },
];

const PROFILE = profiles.find((p) => p.id === "explore")?.title ?? "explore";
const TRIAL_ID = "t8";
const TITLE = threads.find((t) => t.id === TRIAL_ID)?.title ?? "";

function trialState(s: S): TrialState {
  if (s.phase === "pausing") return "pausing";
  if (s.phase === "paused" || s.phase === "disabled") return "paused";
  if (s.phase === "finished" || s.phase === "cleared") return "done";
  return "running";
}

function TranscriptItem({ item }: { item: Item }) {
  const m = useShell();
  switch (item.k) {
    case "user":
      return (
        <div className="grid justify-items-end gap-1">
          <Message author="user">{item.text}</Message>
          {item.meta !== undefined && (
            <span className="text-ui-xs text-text-tertiary">{item.meta}</span>
          )}
        </div>
      );
    case "agent":
      return <Streamed text={item.text} live={item.live} />;
    case "tool":
      return (
        <ToolRow
          name={item.name}
          detail={item.detail}
          status={item.status}
          duration={item.duration}
        />
      );
    case "row": {
      const icon =
        item.icon === "pause" ? (
          <Pause emphasis="muted" />
        ) : item.icon === "play" ? (
          <Play emphasis="muted" />
        ) : item.icon === "step" ? (
          <ArrowRightToLine emphasis="muted" />
        ) : item.icon === "flask" ? (
          <FlaskConical />
        ) : item.icon === "danger" ? (
          <CircleAlert />
        ) : undefined;
      return (
        <RuntimeRow
          icon={icon}
          {...(item.tone !== undefined ? { tone: item.tone } : {})}
          source={item.source}
          onOpen={() => m.openEnd("runtime")}
        >
          {item.text}
        </RuntimeRow>
      );
    }
  }
}

function runtimeData(s: S): RuntimeData {
  const holding = s.phase !== "finished" && s.phase !== "draft" && s.phase !== "cleared";
  const disabled = s.phase === "disabled";
  const word =
    s.phase === "paused"
      ? `멈춤 · ${T.lead} 유지`
      : s.phase === "pausing"
        ? "멈추는 중"
        : s.phase === "stepping"
          ? `한 ${T.step}씩`
          : s.phase === "disabled"
            ? `${T.autoDisabled}로 멈춤`
            : s.phase === "finished"
              ? "끝"
              : "실행 중";
  return {
    caption: `${TITLE} · ${T.turn} ${Math.max(1, s.steps)}`,
    holder: holding && !disabled ? "helm" : null,
    phase: `${T.inquiry} · ${T.step} ${s.steps}/${TOTAL}`,
    since: `${T.turn} 1부터`,
    trial: (
      <div className="flex flex-wrap items-center gap-1.5 text-ui-xs text-text-secondary">
        <Badge size="xs" tone="neutral" icon={<FlaskConical />}>
          {T.trial} · {word}
        </Badge>
        <span>
          {T.profile} {PROFILE} · 대상 <span className="font-mono text-mono-sm">helm</span>
        </span>
      </div>
    ),
    gauges: {
      turns: [Math.max(1, Math.min(4, s.steps)), 4],
      spawns: [s.steps >= 2 ? 5 : 0, 8],
      tokens: `${18 + s.steps * 9}k / 400k`,
      tokenRatio: (18 + s.steps * 9) / 400,
    },
    queue: [],
    groups: [
      {
        layer: "L3",
        name: "helm",
        state: disabled ? T.autoDisabled : `켜짐 · ${T.trial}에서`,
        ...(disabled ? { tone: "danger" as const } : {}),
        points: ["drive", "turn.end", "tool.call.before", "boundary.settle.after"],
      },
      {
        layer: "L3",
        name: "learning",
        state: `빠짐 · ${T.trialThread}`,
        points: ["session.end", "turn.end"],
      },
      { layer: "L2", name: "web-exa", state: "켜짐", points: ["capability web.search"] },
    ],
    switches: [
      ...(s.phase === "finished" || s.phase === "cleared"
        ? [
            {
              at: "14:31",
              turn: 6,
              text: `helm이 ${josa(T.lead, "을", "를")} 놓았어요 · ${T.trial} 끝`,
            },
          ]
        : []),
      ...(s.steps >= 3 && s.items.some((i) => i.k === "row" && i.icon === "step")
        ? [{ at: "14:26", turn: 3, text: `${T.step} 3만 진행 · 다시 멈춤` }]
        : []),
      ...(s.items.some((i) => i.k === "row" && i.icon === "pause")
        ? [{ at: "14:25", turn: 2, text: `${T.stepBoundary} 2에서 멈춤 · ${T.lead} helm 유지` }]
        : []),
      ...(disabled
        ? [{ at: "14:26", turn: 3, text: `helm ${T.autoDisabled} · ${T.trial} 멈춤` }]
        : []),
      { at: "14:22", turn: 1, text: `helm이 ${josa(T.lead, "을", "를")} 받았어요` },
      { at: "14:22", turn: 1, text: `${T.profile} ${PROFILE} 적용 · 이 ${T.trialThread}에만` },
    ],
    ...(disabled
      ? {
          failures: [
            { name: "helm", text: "boundary.settle.after · 연속 5", tone: "danger" as const },
          ],
        }
      : {}),
  };
}

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const pre = usePrefill(SCRIPTS, AT[state]);
  const [s, dispatch] = useMachine<S, A>({
    init: init(pre.script),
    reduce,
    prefill: pre.prefill,
    effect,
  });
  const [draft, setDraft] = useState(s.phase === "draft" ? PROMPT : "");
  const [current, setCurrent] = useState<string | null>(TRIAL_ID);
  const compact = shell.layout === "compact";

  const items: Thread[] = threads.map((t) =>
    t.id === TRIAL_ID && t.trial !== undefined
      ? {
          ...t,
          status: trialState(s) === "running" ? "running" : "idle",
          trial: { ...t.trial, state: s.phase === "draft" ? "paused" : trialState(s) },
        }
      : t,
  );
  const listed = s.phase === "cleared" ? items.filter((t) => t.trial?.state !== "done") : items;
  const clear = () => {
    dispatch({ t: "clear" });
    setCurrent(null);
    toast({ title: `끝난 ${T.trialThread} 2개를 지웠어요`, tone: "neutral" });
  };

  const band = (() => {
    const p = s.phase;
    const actions = (xs: BandAction[]) => xs;
    if (p === "draft" || p === "cleared") return undefined;
    if (p === "running")
      return (
        <TrialBand
          icon={<FlaskConical emphasis="muted" />}
          text={`${T.trial} 실행 중`}
          meta={`${T.step} ${s.steps}/${TOTAL}`}
          actions={actions([{ label: "멈춤", onClick: () => dispatch({ t: "pause" }) }])}
        />
      );
    if (p === "pausing")
      return (
        <TrialBand
          icon={<LoaderCircle className="animate-spin motion-reduce:animate-none" />}
          text="멈추는 중"
          meta={`이번 ${josa(T.step, "이", "가")} 끝나면 멈춰요`}
          actions={actions([{ label: "멈추는 중", onClick: () => {}, disabled: true }])}
        />
      );
    if (p === "paused")
      return (
        <TrialBand
          icon={<Pause />}
          text={`${T.stepBoundary}에서 멈춤`}
          meta={`${T.step} ${s.steps}/${TOTAL} · ${T.lead} helm 유지`}
          actions={actions([
            { label: `한 ${T.step}씩`, onClick: () => dispatch({ t: "stepOnce" }) },
            { label: "이어서", onClick: () => dispatch({ t: "resume" }), primary: true },
          ])}
        />
      );
    if (p === "stepping")
      return (
        <TrialBand
          icon={<LoaderCircle className="animate-spin motion-reduce:animate-none" />}
          text={`${T.step} ${s.steps + 1}만 진행 중`}
          meta={`끝나면 ${T.stepBoundary}에서 다시 멈춰요`}
          actions={actions([{ label: "이어서", onClick: () => {}, disabled: true }])}
        />
      );
    if (p === "disabled")
      return (
        <TrialBand
          tone="danger"
          icon={<CircleAlert />}
          text={`helm이 ${T.autoDisabled}이라 ${T.trial}을 멈췄어요`}
          meta="연속 실패 5"
          actions={actions([
            {
              label: "실패 기록",
              onClick: () =>
                toast({ title: `${T.workbench} 확장 상세 기록으로 가요`, tone: "neutral" }),
            },
            {
              label: "다시 켜고 이어서",
              onClick: () => dispatch({ t: "reenable" }),
              primary: true,
            },
          ])}
        />
      );
    return (
      <TrialBand
        tone="success"
        icon={<FlaskConical />}
        text={`${T.trial}이 끝났어요`}
        meta={`${T.step} ${TOTAL} · 실패 0`}
        actions={actions([
          {
            label: `${T.workbench}에서 결과`,
            onClick: () => {
              shell.setContext({ kind: "trial", threadId: TRIAL_ID });
              shell.setArea("workbench");
            },
          },
          { label: `끝난 ${T.trial} 지우기`, onClick: clear },
        ])}
      />
    );
  })();

  const runtimeLine = (() => {
    const p = s.phase;
    if (p === "draft") return `${T.lead} 없음 · ${T.trial} 준비 · 확장 3`;
    if (p === "paused")
      return `${T.stepBoundary}에서 멈춤 · ${T.lead} helm 유지 · ${T.step} ${s.steps}/${TOTAL}`;
    if (p === "pausing") return `helm ${T.drive} · 이번 ${josa(T.step, "이", "가")} 끝나면 멈춰요`;
    if (p === "disabled") return `${T.trial} 멈춤 · helm ${T.autoDisabled} · 실패 1`;
    if (p === "finished") return `${T.lead} 없음 · ${T.trial} 끝 · ${T.step} ${TOTAL}`;
    return `helm ${T.drive} · ${T.inquiry} ${T.step} ${Math.max(1, s.steps)}/${TOTAL} · 확장 3`;
  })();

  const marks = (
    <>
      <Badge size="xs" tone="neutral" icon={<FlaskConical />} className="shrink-0">
        {T.trial}
      </Badge>
      {!compact && (
        <span className="min-w-0 shrink truncate text-ui-sm text-text-tertiary">
          {T.profile} {PROFILE} · 대상 <span className="font-mono text-mono-sm">helm</span>
        </span>
      )}
    </>
  );

  const running = s.phase === "running" || s.phase === "pausing" || s.phase === "stepping";
  const pausedInput = s.phase === "paused" || s.phase === "pausing";

  const stage =
    s.phase === "cleared" || current === null ? (
      <div className="grid min-h-0 flex-1 place-items-center">
        <EmptyState
          icon={<FlaskConical />}
          surface="none"
          title={`끝난 ${T.trialThread}를 지웠어요`}
          description={`결과는 ${T.workbench} ${T.trials}에 읽기 전용으로 남아요`}
        />
      </div>
    ) : current !== TRIAL_ID ? (
      <div className="grid min-h-0 flex-1 place-items-center">
        <EmptyState surface="none" title="이 목업은 시험 대화만 그려요" />
      </div>
    ) : (
      <ChatStage
        follow={s.items.length}
        head={
          <ChatHead
            title={TITLE}
            marks={marks}
            runtime={runtimeLine}
            runtimeLabel={`${T.runtime} 탭 열기: ${runtimeLine}`}
          />
        }
        band={band}
        composer={
          <ChatComposer
            value={draft}
            onValueChange={setDraft}
            running={running && !pausedInput}
            placeholder={
              pausedInput ? "멈춘 동안 보낸 입력은 이어서 할 때 들어가요" : "메시지를 입력하세요"
            }
            {...(s.queued.length > 0
              ? { note: `대기 중인 입력 ${s.queued.length}개 · 이어서 하면 보내요` }
              : {})}
            onSubmit={(text) => {
              if (s.phase === "draft") dispatch({ t: "send", text });
              else if (pausedInput) dispatch({ t: "queue", text });
              setDraft("");
            }}
            onStop={() => dispatch({ t: "pause" })}
          />
        }
      >
        {s.phase === "draft" && (
          <RuntimeRow icon={<FlaskConical emphasis="muted" />} source="core">
            {`${T.trialThread}를 만들었어요 · ${T.profile} ${PROFILE} · 대상 helm을 이 ${T.thread}에서만 켰어요`}
          </RuntimeRow>
        )}
        {s.items.map((it, i) => (
          <TranscriptItem key={i} item={it} />
        ))}
      </ChatStage>
    );

  return (
    <>
      <Shell
        activeNav="chat"
        stageLabel={T.trialThread}
        threads={{
          currentId: current,
          items: listed,
          trialsOpen: true,
          onSelect: (id) => setCurrent(id),
          onNew: () => {},
          onClearTrials: clear,
        }}
        rightTabs={chatRightTabs({
          inbox: <NoticeList notices={inbox.notices} />,
          inboxBadge: 3,
          runtime: <RuntimePanel data={runtimeData(s)} />,
          runtimeBadge: s.phase === "disabled" ? 1 : 0,
        })}
        status={defaultStatusCells({
          layout: shell.layout,
          thread: current !== null,
          pendingApprovals: 0,
          openEnd: shell.openEnd,
          runtime: {
            drive: runtimeData(s).holder,
            extFailures: s.phase === "disabled" ? 1 : 0,
            onOpen: () => shell.openEnd("runtime"),
            detail: `${T.trial} · ${T.step} ${s.steps}/${TOTAL}`,
          },
        })}
      >
        {stage}
      </Shell>
      <Toaster label="알림" />
      <ScenarioDock scenarios={SCENARIOS} />
    </>
  );
}
