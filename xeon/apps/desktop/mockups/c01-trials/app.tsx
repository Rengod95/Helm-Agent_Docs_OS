// P-19 테스트 실행 다시 그리기 + O-12 새 테스트 + N-30 개발 모드(spec §6.26, §6.31, 결정 4·9, 캔버스 5·9).
// - 테스트 대화가 기본 행이다(위 구역). replay·bench·코어 변경 검사는 아래 구역이고, 배포 앱에서는 "개발 모드에서만" 잠금과
//   지난 결과 읽기 전용. 개발 모드면 ReplayDriveReport 그대로 + JSON 복사.
// - 고른 행 상세는 같은 화면 아래(나눔 창 대신 위아래 흐름). 좁은 폭(720 아래)은 표가 두 줄 목록이 되고 상세는 아래로 쌓인다.
// - 개발 모드 배지 자리: 상태 표시줄 왼쪽 묶음 끝 "개발 모드" 칸(켜졌을 때만, DP-27).
import { Button, EmptyState, Toaster, toast } from "@caustic/react";
import { useEffect, useRef, type ReactNode } from "react";
import {
  CircleCheck,
  Clock,
  FlaskConical,
  GitBranch,
  josa,
  LoaderCircle,
  Plus,
  RotateCcw,
  ScenarioDock,
  T,
  useScenarioParam,
  ToneIcon,
  useShell,
  WB_WIDTH,
  WorkbenchHead,
  CircleX,
  workbenchNav,
} from "../_shell";
import { useMachine, usePrefill } from "../_chat-rt";
import { goFolder, WbFrame } from "../_wb-c/frame";
import { GridTable, type GridColumn } from "../_wb-c/grid-table";
import { DevLock, DotText, ExtName, Mono, SectionTitle } from "../_wb-c/parts";
import type { Run } from "../_wb-c/data";
import { effect, init, reduce, SCRIPTS, type A, type S } from "./flow";
import { OtherDetail, profileTitle, ReplayDetail, TrialDetail } from "./parts/detail";
import { DevModeDialog, NewTrialSheet } from "./parts/sheets";

export const STATES = [
  { id: "list", label: "기본: 배포 앱, 테스트 대화(멈춤) 상세" },
  { id: "running", label: "새 테스트 대화 실행 중" },
  { id: "stopped", label: "테스트 중 대상 자동 꺼짐(실패 기록)" },
  { id: "past-locked", label: "지난 replay 결과(읽기 전용, 잠김)" },
  { id: "lock-tooltip", label: "다시 실행 잠금 이유" },
  { id: "devmode-dialog", label: "개발 모드 켜기" },
  { id: "devmode-checking", label: "개발 모드: 저장소 확인 중" },
  { id: "devmode-norepo", label: "실패: 저장소에 테스트 도구 없음" },
  { id: "dev", label: "개발 모드: 검사 보고 전체" },
  { id: "dev-rerun", label: "개발 모드: 다시 실행 중" },
  { id: "new", label: "새 테스트(O-12)" },
  { id: "new-confirm", label: "새 테스트: 비용 확인 문장" },
  { id: "new-starting", label: "새 테스트: 프로필 적용 중" },
  { id: "new-preview-fail", label: "실패: 프로필 미리 보기 실패" },
  { id: "trace-off", label: "계측 꺼짐: 턴 다시 보기 잠김" },
  { id: "empty", label: "빈 목록" },
  { id: "web", label: "웹: 원격 호스트의 개발 모드" },
  { id: "narrow", label: "좁은 폭(390)" },
] as const;
export type StateId = (typeof STATES)[number]["id"];

const AT: Record<StateId, { script: string; n: number }> = {
  list: { script: "base", n: 1 },
  running: { script: "trial-new", n: 5 },
  stopped: { script: "stopped", n: 1 },
  "past-locked": { script: "past", n: 1 },
  "lock-tooltip": { script: "trial-dev-locked", n: 2 },
  "devmode-dialog": { script: "trial-dev-locked", n: 3 },
  "devmode-checking": { script: "trial-dev-locked", n: 4 },
  "devmode-norepo": { script: "trial-dev-locked-norepo", n: 5 },
  dev: { script: "dev", n: 4 },
  "dev-rerun": { script: "trial-dev-locked", n: 9 },
  new: { script: "trial-new", n: 1 },
  "new-confirm": { script: "trial-new", n: 2 },
  "new-starting": { script: "trial-new", n: 3 },
  "new-preview-fail": { script: "trial-new-fail", n: 2 },
  "trace-off": { script: "trace-off", n: 1 },
  empty: { script: "base", n: 0 },
  web: { script: "web", n: 1 },
  narrow: { script: "base", n: 1 },
};

export const SCENARIOS = [
  { id: "trial-new", label: "새 테스트 → 비용 확인 → 테스트 대화" },
  { id: "trial-new-fail", label: "실패: 프로필 미리 보기 실패" },
  { id: "trial-dev-locked", label: "잠긴 replay → 개발 모드 → 보고" },
  { id: "trial-dev-locked-norepo", label: "실패: 저장소에 테스트 도구 없음" },
  { id: "trial-step", label: "테스트 대화: 한 단계씩 → 이어서" },
];

/** 상세가 주인공인 상태: 처음에 상세로 스크롤한다(1280×800에서 상세가 표 아래로 밀리므로). */
const DETAIL_STATES: StateId[] = ["dev", "dev-rerun", "past-locked", "lock-tooltip", "web"];

/** 정적 상태에서도 토스트를 보일 상태(나머지는 시나리오가 살아 있을 때만). */
const TOAST_STATES: StateId[] = ["running"];

const KIND_ICON: Record<Run["kind"], ReactNode> = {
  trial: <FlaskConical />,
  replay: <RotateCcw />,
  bench: <Clock />,
  diff: <GitBranch />,
};
const kindLabel = (k: Run["kind"]) =>
  k === "trial"
    ? T.trialThread
    : k === "replay"
      ? T.replay
      : k === "bench"
        ? T.benchmark
        : T.coreDiff;

function trialStatus(r: Run): ReactNode {
  const [a, b] = r.steps ?? [0, 6];
  switch (r.result) {
    case "running":
      return <DotText tone="info">{`실행 중 · ${a}/${b}`}</DotText>;
    case "pausing":
      return <DotText tone="info">멈추는 중</DotText>;
    case "paused":
      return <DotText tone="neutral">{`${T.stepBoundary}에서 멈춤 · ${a}/${b}`}</DotText>;
    case "stopped":
      return <DotText tone="danger">{`멈춤 · 대상 ${T.autoDisabled}`}</DotText>;
    default:
      return <DotText tone="success">{`끝 · ${b}/${b}`}</DotText>;
  }
}

function devResult(r: Run): ReactNode {
  const face = (tone: "success" | "danger" | "neutral" | "info", icon: ReactNode, text: string) => (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <ToneIcon tone={tone}>{icon}</ToneIcon>
      <span className="truncate">{text}</span>
    </span>
  );
  switch (r.result) {
    case "running":
      return face("info", <LoaderCircle className="animate-spin" />, "다시 돌리는 중");
    case "passed":
      return face("success", <CircleCheck />, `통과 ${r.commits}/${r.commits}`);
    case "failed":
      return face("danger", <CircleX />, `digest 다름 ${r.diffCuts?.length ?? 0}/${r.commits}`);
    case "budget_pending":
      return face("neutral", <Clock />, "예산 미정");
    default:
      return face("success", <CircleCheck />, `보호 경로 변경 ${r.protectedFiles ?? 0}`);
  }
}

const trialCols: GridColumn<Run>[] = [
  {
    key: "title",
    header: T.thread,
    cell: (r) => <span className="truncate text-text-primary">{r.title}</span>,
  },
  { key: "target", header: "대상", width: "9rem", cell: (r) => <ExtName id={r.target} /> },
  {
    key: "profile",
    header: T.profile,
    width: "7rem",
    hideCompact: true,
    cell: (r) => (
      <span className="truncate text-text-secondary">{profileTitle(r.profile ?? "")}</span>
    ),
  },
  { key: "state", header: "상태", width: "12rem", cell: trialStatus },
  {
    key: "at",
    header: "시작",
    width: "4.5rem",
    hideCompact: true,
    cell: (r) => <span className="text-text-secondary">{r.at}</span>,
  },
  {
    key: "took",
    header: "소요",
    width: "3.5rem",
    align: "end",
    cell: (r) => <span className="text-text-secondary">{r.took}</span>,
  },
];

const devCols: GridColumn<Run>[] = [
  {
    key: "kind",
    header: "종류",
    width: "10rem",
    cell: (r) => (
      <span className="inline-flex items-center gap-1.5 text-text-primary [&_svg]:size-icon-sm [&_svg]:text-text-tertiary">
        {KIND_ICON[r.kind]}
        {kindLabel(r.kind)}
      </span>
    ),
  },
  {
    key: "target",
    header: "대상",
    width: "9rem",
    cell: (r) =>
      r.kind === "replay" ? <ExtName id={r.target} /> : <Mono dim={false}>{r.target}</Mono>,
  },
  { key: "result", header: "결과", cell: devResult },
  {
    key: "at",
    header: "시각",
    width: "4.5rem",
    hideCompact: true,
    cell: (r) => <span className="text-text-secondary">{r.at}</span>,
  },
  {
    key: "took",
    header: "소요",
    width: "3.5rem",
    align: "end",
    cell: (r) => <span className="text-text-secondary">{r.took}</span>,
  },
];

/** 좁은 폭(720 아래): 표 대신 두 줄 목록(§6.26 좁은 폭, N-59). */
function RunList({
  rows,
  sel,
  onSelect,
}: {
  rows: Run[];
  sel: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="m-0 grid list-none gap-0.5 p-0">
      {rows.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            aria-current={r.id === sel}
            onClick={() => onSelect(r.id)}
            className={`grid w-full gap-0.5 rounded-md px-2 py-1.5 text-start outline-none focus-visible:focus-ring ${r.id === sel ? "bg-control-raised shadow-[inset_0_0_0_1px_var(--cs-color-control-edge)]" : "hover:bg-neutral-hover"}`}
          >
            <span className="flex min-w-0 items-center gap-2 text-ui-dense">
              <span className="truncate text-text-primary">
                {r.kind === "trial" ? r.title : kindLabel(r.kind)}
              </span>
              <span className="ms-auto flex-none text-ui-xs text-text-tertiary">{r.at}</span>
            </span>
            <span className="flex min-w-0 items-center gap-2 text-ui-xs text-text-tertiary">
              {r.kind === "trial" ? trialStatus(r) : devResult(r)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function App({ state }: { state: StateId }) {
  const shell = useShell();
  const pre = usePrefill(SCRIPTS, AT[state]);
  const [s0, dispatch] = useMachine<S, A>({
    init: init(pre.script),
    reduce,
    prefill: pre.prefill,
    effect,
    kick: pre.live,
  });
  const s: S =
    state === "empty"
      ? { ...s0, runs: [] }
      : state === "web"
        ? { ...s0, dev: true, web: true }
        : s0;
  const compact = shell.layout === "compact";

  // 토스트: 시나리오가 살아 있으면 note가 바뀔 때마다, 정적 상태는 TOAST_STATES만.
  const seen = useRef<number | null>(
    pre.live || TOAST_STATES.includes(state) ? null : (s.note?.id ?? null),
  );
  useEffect(() => {
    if (s.note === null || s.note.id === seen.current) return;
    seen.current = s.note.id;
    toast({
      title: s.note.title,
      ...(s.note.body !== undefined ? { description: s.note.body } : {}),
      tone: s.note.tone ?? "neutral",
    });
  }, [s.note]);

  // 상세로 스크롤: 시나리오 중이거나 상세가 주인공인 정적 상태에서, 고른 행·개발 모드가 바뀌면.
  const detailRef = useRef<HTMLElement | null>(null);
  const scenario = useScenarioParam();
  const follow = scenario !== null || DETAIL_STATES.includes(state);
  useEffect(() => {
    if (!follow || s.runs.find((r) => r.id === s.sel)?.kind === "trial") return undefined;
    // 가운데 스크롤 열만 옮긴다(scrollIntoView는 창 전체까지 밀어 올린다).
    const id = window.setTimeout(() => {
      const el = detailRef.current;
      const sc = el?.closest<HTMLElement>("[data-scroll]");
      if (el == null || sc == null) return;
      sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8;
    }, 60);
    return () => window.clearTimeout(id);
  }, [follow, s.sel, s.dev]);

  // 정적 상태 준비: 좁은 폭은 왼쪽 패널 닫힘.
  useEffect(() => {
    if (state === "narrow") shell.setStartOpen(false);
    shell.setEndOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trials = s.runs.filter((r) => r.kind === "trial");
  const devRuns = s.runs.filter((r) => r.kind !== "trial");
  const run = s.runs.find((r) => r.id === s.sel);
  const nav = workbenchNav.map((n) =>
    n.id === "tests"
      ? (() => {
          const k = trials.filter((r) => r.result === "running").length;
          const { badge: _b, badgeLabel: _l, ...rest } = n;
          return k > 0 ? { ...rest, badge: `${k}*`, badgeLabel: `실행 중 ${k}개` } : rest;
        })()
      : n,
  );

  const hint = (() => {
    const sc = pre.live ? pre.script : null;
    if (sc === "trial-new" || sc === "trial-new-fail") {
      if (s.sheet === "closed")
        return s.sel === "r0" ? "새 테스트 대화가 맨 위에 생겼어요" : `"새 테스트"을 누르세요`;
      if (s.sheet === "open")
        return s.previewFail
          ? `미리 보기가 실패해 시작이 잠겼어요`
          : sc === "trial-new-fail"
            ? `${josa(T.profile, "을", "를")} "review 테스트"으로 바꿔 보세요`
            : `"시작"을 누르세요`;
      if (s.sheet === "confirm") return `"토큰 쓰고 시작"을 누르세요`;
      return "기다리세요";
    }
    if (sc === "trial-dev-locked" || sc === "trial-dev-locked-norepo") {
      if (s.devDialog === "open") return `"켜기"를 누르세요`;
      if (s.devDialog === "norepo") return `"이걸로" 뒤 "켜기"`;
      if (!s.dev)
        return s.tip
          ? `"${T.devMode} 켜기…"를 누르세요`
          : `review ${T.replay}의 "다시 실행"을 누르세요`;
      if (s.rerun !== null) return "절단을 다시 돌리는 중";
      return `"다시 실행" 또는 "JSON 복사"`;
    }
    if (sc === "trial-step") return `"한 단계씩" 또는 "이어서"`;
    return undefined;
  })();

  const head = (
    <WorkbenchHead
      title={T.trials}
      meta={`${s.runs.length}개`}
      actions={
        <Button
          size="xs"
          tone="neutral"
          variant="outline"
          iconStart={<Plus />}
          onClick={() => dispatch({ t: "openNew" })}
        >
          새 테스트
        </Button>
      }
      sub={<span>14:24 기준 · 보기 기준 전체</span>}
    />
  );

  const devHeadEnd = s.dev ? (
    <span className="max-compact:hidden">
      {s.web ? `원격 컴퓨터 build-box의 ${T.devMode}` : `${T.devMode} · ${T.repoPath} ${s.repo}`}
    </span>
  ) : (
    <>
      <span className="max-compact:hidden">{`${T.pastResult} · 읽기 전용`}</span>
      <DevLock
        reason={`배포 앱이라 잠겨 있어요. ${josa(T.devMode, "을", "를")} 켜면 ${T.repoPath}의 테스트 도구로 돌려요.`}
      />
    </>
  );

  // 고른 행 상세는 그 행이 속한 구역 바로 아래에 둔다(테스트 대화면 위 구역 아래, 지난 결과면 아래 구역 아래).
  const detailBlock =
    run === undefined ? null : (
      <section
        ref={detailRef}
        aria-label="고른 테스트 상세"
        className="grid scroll-mt-2 gap-2 pt-1"
      >
        {run.kind === "trial" ? (
          <TrialDetail
            run={run}
            traceOff={s.traceOff}
            onPause={() => dispatch({ t: "pause" })}
            onStep={() => dispatch({ t: "stepOnce" })}
            onResume={() => dispatch({ t: "resume" })}
            onTraceSettings={() => goFolder("c04-settings-rows", "state=trace")}
          />
        ) : run.kind === "replay" ? (
          <ReplayDetail
            run={run}
            dev={s.dev}
            web={s.web}
            tip={s.tip}
            rerun={s.rerun}
            onRerun={() => dispatch({ t: "rerun" })}
            onLockedClick={() => dispatch({ t: "tip", on: !s.tip })}
            onDevMode={() => dispatch({ t: "openDev" })}
            onCopy={() => {
              void navigator.clipboard?.writeText("{}").catch(() => undefined);
              dispatch({ t: "copyJson" });
            }}
          />
        ) : (
          <OtherDetail run={run} dev={s.dev} />
        )}
      </section>
    );

  return (
    <>
      <WbFrame
        active="tests"
        stageLabel={T.trials}
        wbNav={nav}
        modalOpen={s.sheet !== "closed" || s.devDialog !== "closed"}
        devMode={{
          on: s.dev,
          repo: s.repo,
          ...(s.web ? { remote: "build-box" } : {}),
        }}
      >
        <div data-scroll className="flex min-h-0 flex-1 flex-col overflow-auto">
          {head}
          {s.runs.length === 0 ? (
            <div className={`${WB_WIDTH} pt-8`}>
              <EmptyState
                size="sm"
                icon={<FlaskConical />}
                title="아직 돌린 테스트가 없어요"
                description={`${josa(T.profile, "을", "를")} 적용한 ${T.trialThread}에서 확장을 테스트해요.`}
                actions={
                  <Button
                    size="sm"
                    tone="neutral"
                    variant="outline"
                    iconStart={<Plus />}
                    onClick={() => dispatch({ t: "openNew" })}
                  >
                    새 테스트
                  </Button>
                }
              />
            </div>
          ) : (
            <div className={`${WB_WIDTH} grid gap-5 pb-8`}>
              <section className="grid gap-1">
                <SectionTitle
                  end={`실행 중 ${trials.filter((r) => r.result === "running").length} · 멈춤 ${trials.filter((r) => r.result === "paused").length}`}
                >
                  {T.trialThread}
                </SectionTitle>
                {compact ? (
                  <RunList
                    rows={trials}
                    sel={s.sel}
                    onSelect={(id) => dispatch({ t: "select", id })}
                  />
                ) : (
                  <GridTable
                    label={T.trialThread}
                    columns={trialCols}
                    rows={trials}
                    selectedId={s.sel}
                    onSelect={(id) => dispatch({ t: "select", id })}
                    rowLabel={(r) => `${r.title ?? ""}`}
                  />
                )}
              </section>
              {run?.kind === "trial" && detailBlock}
              <section className="grid gap-1">
                <SectionTitle
                  end={devHeadEnd}
                >{`${T.replay} · ${T.benchmark} · ${T.coreDiff}`}</SectionTitle>
                {compact ? (
                  <RunList
                    rows={devRuns}
                    sel={s.sel}
                    onSelect={(id) => dispatch({ t: "select", id })}
                  />
                ) : (
                  <GridTable
                    label={`${T.replay}, ${T.benchmark}, ${T.coreDiff}`}
                    columns={devCols}
                    rows={devRuns}
                    selectedId={s.sel}
                    onSelect={(id) => dispatch({ t: "select", id })}
                    rowLabel={(r) => `${kindLabel(r.kind)} ${r.target}`}
                  />
                )}
              </section>
              {run !== undefined && run.kind !== "trial" && detailBlock}
            </div>
          )}
        </div>
      </WbFrame>
      <NewTrialSheet
        step={s.sheet}
        kind={s.kind}
        profile={s.profile}
        previewFail={s.previewFail}
        dev={s.dev}
        onKind={(kind) => dispatch({ t: "kind", kind })}
        onProfile={(id) => dispatch({ t: "profile", id })}
        onStart={() => dispatch({ t: "start" })}
        onConfirm={() => dispatch({ t: "confirm" })}
        onBack={() => dispatch({ t: "openNew" })}
        onClose={() => dispatch({ t: "closeSheet" })}
      />
      <DevModeDialog
        state={s.devDialog}
        repo={s.repo}
        onRepo={(path) => dispatch({ t: "repo", path })}
        onCheck={() => dispatch({ t: "checkDev" })}
        onClose={() => dispatch({ t: "closeDev" })}
      />
      <Toaster label="알림" />
      <ScenarioDock scenarios={SCENARIOS} hint={hint} />
    </>
  );
}
