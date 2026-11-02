// W6 테스트 실행(P-19): 테스트 표 + 고른 결과 상세(같은 화면 아래, 나눔 창 대신 위아래 흐름 [gap:C-14]).
// replay 실패 상세는 ReplayDriveReport 모양을 따른다: 커밋 시점마다 절단 재실행(cuts), 처음 다른 seq, 효과 수(EffectCounts).
import {
  Alert,
  Button,
  CodeDiff,
  CodeDiffLine,
  EmptyState,
  ListDescription,
  ListDescriptionRow,
  Progress,
  Select,
  SelectOption,
} from "@caustic/react";
import type { ReactNode } from "react";
import { CircleCheck, CircleX, Clock, Pause, Play, ToneIcon, TriangleAlert } from "../../_shell";
import { ExtCell } from "../parts/ext-cell";
import { GridTable, type GridColumn } from "../parts/grid-table";
import { ScreenHead, SectionTitle, WB_WIDTH } from "../parts/screen-head";
import {
  benchRows,
  diffCheck,
  effectCounts,
  firstDiff,
  replayCuts,
  tests,
  type TestRun,
} from "../fixtures";
import { useMock } from "../store";

const KIND: Record<TestRun["kind"], string> = {
  trial: "테스트 대화",
  replay: "replay",
  bench: "bench",
  diff: "코어 변경 검사",
};

type Tone = "success" | "danger" | "warning" | "neutral" | "info";

function resultOf(t: TestRun): { tone: Tone; icon: ReactNode; text: string } {
  switch (t.result) {
    case "running":
      return { tone: "info", icon: <Play />, text: "실행 중" };
    case "passed":
      return { tone: "success", icon: <CircleCheck />, text: "통과" };
    case "failed":
      return { tone: "danger", icon: <CircleX />, text: `실패 · 절단 ${t.failedAt}` };
    case "budget_pending":
      return { tone: "neutral", icon: <Clock />, text: "예산 미정" };
    case "clean":
      return { tone: "success", icon: <CircleCheck />, text: `보호 경로 ${t.protectedLines}줄` };
    case "env_error":
      return { tone: "warning", icon: <TriangleAlert />, text: "못 돌림" };
  }
}

function TargetCell({ t }: { t: TestRun }) {
  if (t.kind === "bench" || t.kind === "diff")
    return <span className="font-mono text-mono-sm text-text-secondary">{t.target}</span>;
  return <ExtCell name={t.target} />;
}

function RunningCell({ t }: { t: TestRun }) {
  const m = useMock();
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Progress
        size="xs"
        value={t.progress ?? 0}
        label="테스트 대화 진행"
        className="w-14 shrink-0"
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          m.notify("다음 단계 경계에서 멈춰요");
        }}
        aria-label="테스트 대화 멈춤"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-text-tertiary outline-none hover:bg-neutral-hover hover:text-text-primary focus-visible:focus-ring [&_svg]:size-icon-sm"
      >
        <Pause />
      </button>
    </span>
  );
}

const columns: GridColumn<TestRun>[] = [
  {
    key: "kind",
    header: "종류",
    width: "9.5rem",
    cell: (t) => <span className="text-text-primary">{KIND[t.kind]}</span>,
  },
  { key: "target", header: "대상", width: "11rem", cell: (t) => <TargetCell t={t} /> },
  {
    key: "result",
    header: "결과",
    cell: (t) => {
      if (t.result === "running") return <RunningCell t={t} />;
      const r = resultOf(t);
      return (
        <span className="inline-flex items-center gap-1.5">
          <ToneIcon tone={r.tone}>{r.icon}</ToneIcon>
          {r.text}
        </span>
      );
    },
  },
  {
    key: "at",
    header: "시각",
    width: "5rem",
    hideCompact: true,
    cell: (t) => <span className="text-text-secondary">{t.at}</span>,
  },
  {
    key: "took",
    header: "소요",
    width: "4rem",
    align: "end",
    cell: (t) => <span className="text-text-secondary">{t.took}</span>,
  },
];

// ── 상세 ─────────────────────────────────────────────────────────

/** 커밋 시점 띠: 절단마다 한 칸. 같으면 연한 칸, 다르면 danger 칸(tone은 칸 면에만). */
function CutStrip() {
  const diff = replayCuts.filter((c) => !c.equal).map((c) => c.n);
  return (
    <div className="grid gap-1">
      <div
        role="img"
        aria-label={`커밋 시점 ${replayCuts.length}개를 모두 끊어 다시 돌렸어요. ${diff.join(", ")}번이 달랐어요.`}
        className="flex flex-wrap gap-0.5"
      >
        {replayCuts.map((c) => (
          <span
            key={c.n}
            title={`절단 ${c.n}${c.equal ? " 같음" : " 다름"}`}
            className={`h-3.5 w-2 rounded-[2px] ${c.equal ? "bg-neutral-track" : "bg-danger-graphic"}`}
          />
        ))}
      </div>
    </div>
  );
}

function ReplayFailed({ t }: { t: TestRun }) {
  const m = useMock();
  return (
    <div className="grid gap-3">
      <ListDescription variant="ghost" size="xs" aria-label="replay 결과">
        <ListDescriptionRow term="판정">
          <span className="text-text-secondary">절단 {t.failedAt}번부터 재개 결과가 달라요</span>
        </ListDescriptionRow>
        <ListDescriptionRow term="절단">
          <CutStrip />
        </ListDescriptionRow>
        <ListDescriptionRow term="첫 차이">
          <span className="tabular-nums">seq {t.firstDiffSeq}</span>
        </ListDescriptionRow>
        <ListDescriptionRow term="새 효과">
          <span className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-0.5 tabular-nums">
            {effectCounts.map((e) => (
              <span key={e.kind} className={e.cut > 0 ? "text-text-primary" : "text-text-tertiary"}>
                {e.kind} {e.cut}
                <span className="text-text-tertiary">/{e.baseline}</span>
              </span>
            ))}
          </span>
        </ListDescriptionRow>
      </ListDescription>

      {/* C-20 이벤트열 나란히 비교의 대용: 처음 다른 이벤트 하나를 CodeDiff로(- 기록, + 재개 뒤). 전체 비교는 "이벤트 비교 열기". */}
      <CodeDiff
        actions={false}
        aria-label={`seq ${firstDiff.seq} 이벤트 비교`}
        filename={`seq ${firstDiff.seq} · 기록 ↔ 재개 뒤`}
        added={2}
        removed={1}
      >
        {firstDiff.lines.map((l, i) => (
          <CodeDiffLine key={i} number={210 + i} kind={l.kind}>
            {l.text}
          </CodeDiffLine>
        ))}
      </CodeDiff>

      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="soft" onClick={() => m.notify("이벤트 비교를 열어요 (500행씩)")}>
          이벤트 비교 열기
        </Button>
        <Button size="sm" variant="ghost" onClick={() => m.notify("같은 인자로 다시 돌려요")}>
          다시 실행
        </Button>
      </div>
    </div>
  );
}

function BenchDetail() {
  return (
    <div className="grid gap-2">
      <Alert tone="neutral" variant="soft" size="sm" emphasis="lead">
        <b>예산이 아직 없어요.</b> bench 예산은 모두 사용자 결정 대기예요.
      </Alert>
      <ListDescription variant="ghost" size="xs" aria-label="bench 결과">
        {benchRows.map((b) => (
          <ListDescriptionRow key={b.metric} term={b.metric}>
            <span className="tabular-nums">{b.value}</span>
          </ListDescriptionRow>
        ))}
      </ListDescription>
    </div>
  );
}

function DiffDetail() {
  return (
    <ListDescription variant="ghost" size="xs" aria-label="코어 변경 검사 결과">
      <ListDescriptionRow term="범위" mono>
        {diffCheck.range}
      </ListDescriptionRow>
      {diffCheck.groups.map((g) => (
        <ListDescriptionRow
          key={g.path}
          term={<span className="font-mono text-mono-sm">{g.path}</span>}
        >
          <span className="tabular-nums text-text-secondary">{g.lines}줄</span>
        </ListDescriptionRow>
      ))}
    </ListDescription>
  );
}

function PassedDetail() {
  return (
    <div className="grid gap-2">
      <ListDescription variant="ghost" size="xs" aria-label="replay 결과">
        <ListDescriptionRow term="판정">모든 절단이 같아요 · 새 효과 0</ListDescriptionRow>
      </ListDescription>
    </div>
  );
}

function TrialDetail({ t }: { t: TestRun }) {
  const m = useMock();
  return (
    <div className="grid gap-2">
      <ListDescription variant="ghost" size="xs" aria-label="테스트 대화">
        <ListDescriptionRow term="대화">테스트: 렌즈 5개</ListDescriptionRow>
        <ListDescriptionRow term="프로필">{t.profile}</ListDescriptionRow>
        <ListDescriptionRow term="진행">
          <Progress size="xs" value={t.progress ?? 0} label="턴 진행" className="w-24" />
        </ListDescriptionRow>
      </ListDescription>
      <div className="flex gap-1.5">
        <Button size="sm" variant="soft" onClick={() => m.notify("대화 영역의 테스트 대화로 가요")}>
          대화로 가기
        </Button>
      </div>
    </div>
  );
}

function Detail({ t }: { t: TestRun }) {
  const r = resultOf(t);
  return (
    <section aria-labelledby="trial-detail" className="grid gap-2 pt-4">
      <SectionTitle id="trial-detail">
        {KIND[t.kind]} {t.target} · {r.text}
      </SectionTitle>
      <div className="px-2">
        {t.kind === "replay" && t.result === "failed" && <ReplayFailed t={t} />}
        {t.kind === "replay" && t.result === "passed" && <PassedDetail />}
        {t.kind === "bench" && <BenchDetail />}
        {t.kind === "diff" && <DiffDetail />}
        {t.kind === "trial" && <TrialDetail t={t} />}
      </div>
    </section>
  );
}

export function TrialsScreen() {
  const m = useMock();
  const selected = tests.find((t) => t.id === m.selectedTest) ?? null;
  return (
    <>
      <ScreenHead
        title="테스트 실행"
        asOf={m.emptyTests ? undefined : "14:05 기준"}
        actions={
          <Button size="sm" variant="soft" onClick={() => m.set({ newTrialOpen: true })}>
            새 테스트
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`${WB_WIDTH} pb-6`}>
          {m.emptyTests ? (
            <EmptyState
              size="md"
              surface="none"
              mark={null}
              title="아직 돌린 테스트가 없어요"
              className="mt-10"
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5 pb-2">
                <Select size="xs" aria-label="종류 거르기" defaultValue="all" className="w-36">
                  <SelectOption value="all">종류 전체</SelectOption>
                  <SelectOption value="replay">replay</SelectOption>
                  <SelectOption value="bench">bench</SelectOption>
                  <SelectOption value="diff">코어 변경 검사</SelectOption>
                  <SelectOption value="trial">테스트 대화</SelectOption>
                </Select>
                <Select size="xs" aria-label="결과 거르기" defaultValue="all" className="w-32">
                  <SelectOption value="all">결과 전체</SelectOption>
                  <SelectOption value="failed">실패</SelectOption>
                  <SelectOption value="running">실행 중</SelectOption>
                </Select>
              </div>
              {m.startError && (
                <Alert
                  tone="danger"
                  variant="soft"
                  size="sm"
                  className="mb-2"
                  emphasis="lead"
                  actions={[{ label: "다시 시도", onClick: () => m.notify("다시 시도해요") }]}
                >
                  <b>bench를 못 돌렸어요.</b> 도구나 환경이 없어 못 돌렸어요.
                </Alert>
              )}
              <GridTable
                label="테스트 목록"
                columns={columns}
                rows={tests}
                selectedId={m.selectedTest}
                onSelect={(id) => m.set({ selectedTest: id })}
                rowLabel={(t) => `${KIND[t.kind]} ${t.target}, ${resultOf(t).text}, ${t.at}`}
              />
              {selected !== null && <Detail t={selected} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}
