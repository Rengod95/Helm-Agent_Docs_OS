// 오른쪽 계기 열: 지금 단계(trial.phase)와 주도, 진행 한도 막대 셋, 단계 사이 기록. 다시 돌려 검사가 있으면 그 결과가 한도 자리에 온다.
// 멈춘 동안 막대는 움직이지 않는다(주도를 쥔 채 돌지 않음, C-9).
import { Button, Progress, Timeline, TimelineItem } from "@caustic/react";
import { LineGridBlock, LineGridCell, LineGridMetric, PageSection, T } from "../../_shell";
import { replayReport } from "../../_wb-c/data";
import { PHASE_LABEL } from "../../f01-compose-entry/parts/flow-board";
import { CUTS, FIRST_DIFF, type Model } from "../flow";

const LIMIT = { turn: 4, spawn: 8, tokens: 400 };

function Bar({ label, used, max }: { label: string; used: number; max: number }) {
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-body text-text-secondary">{label}</span>
      </div>
      <Progress size="xs" tone="neutral" value={Math.round((used / max) * 100)} label={label} />
    </div>
  );
}

function CutStrip({ done }: { done: number }) {
  const diff = replayReport.cuts.filter((c) => !c.equal).map((c) => c.n);
  return (
    <div
      role="img"
      aria-label={`커밋 시점 ${CUTS}개 중 ${diff.join(", ")}번이 달랐어요`}
      className="grid grid-cols-[repeat(41,minmax(0,1fr))] gap-px"
    >
      {replayReport.cuts.map((c) => (
        <span
          key={c.n}
          className={`h-4 rounded-[1px] ${
            c.n > done ? "bg-neutral-soft" : c.equal ? "bg-border-strong" : "bg-danger-solid"
          }`}
        />
      ))}
    </div>
  );
}

function Report({ s, onCopy }: { s: Model; onCopy: () => void }) {
  const running = s.replay !== null;
  const done = s.replay ?? CUTS;
  const reached = done >= FIRST_DIFF;
  const diffs = replayReport.cuts.filter((c) => !c.equal && c.n <= done).length;
  return (
    <PageSection level="group" title={T.replayReport}>
      <LineGridBlock marks={false} columns={2} aria-label={T.replayReport}>
        <LineGridMetric
          value={running ? `${done}/${CUTS}` : reached ? `${diffs}/${CUTS}` : `0/${CUTS}`}
          metricLabel={running ? "돌린 절단" : "다른 절단"}
        />
        <LineGridMetric value={reached ? `절단 ${FIRST_DIFF}` : "없음"} metricLabel={T.firstDiff} />
      </LineGridBlock>
      <CutStrip done={done} />
      {!running && (
        <div>
          <Button size="xs" variant="outline" onClick={onCopy}>
            JSON 복사
          </Button>
        </div>
      )}
    </PageSection>
  );
}

export function TrialAside({ s, onCopy }: { s: Model; onCopy: () => void }) {
  const done = s.run === "done";
  const showReport = s.replay !== null || s.report;
  return (
    <aside
      aria-label={`${T.trial} 진행`}
      className="grid w-68 flex-none content-start gap-6 overflow-y-auto border-s border-border-subtle px-4 py-4"
    >
      <LineGridBlock marks={false} columns={2} aria-label={`지금 ${T.step}`}>
        <LineGridMetric
          value={done && s.replay === null ? T.stageDone : PHASE_LABEL[s.now]}
          metricLabel={`지금 ${T.step}`}
        />
        <LineGridMetric
          value={done ? T.leadReturn : "helm"}
          metricLabel={s.run === "paused" ? `${T.lead} 유지` : T.lead}
        />
      </LineGridBlock>

      {showReport ? (
        <Report s={s} onCopy={onCopy} />
      ) : !s.dev && done ? (
        <PageSection level="group" title={T.pastResult}>
          <LineGridBlock marks={false} columns={2} aria-label={T.pastResult}>
            <LineGridCell className="grid gap-0.5">
              <span className="text-title-3 text-text-primary">통과</span>
              <span className="text-body text-text-tertiary">판정</span>
            </LineGridCell>
            <LineGridCell className="grid gap-0.5">
              <span className="text-title-3 text-text-primary">어제 18:02</span>
              <span className="text-body text-text-tertiary">시각</span>
            </LineGridCell>
          </LineGridBlock>
        </PageSection>
      ) : (
        <PageSection level="group" title={T.leadLimit}>
          <div className="grid gap-3">
            <Bar label={T.turn} used={s.use[0]} max={LIMIT.turn} />
            <Bar label={T.childAgent} used={s.use[1]} max={LIMIT.spawn} />
            <Bar label="토큰" used={s.use[2]} max={LIMIT.tokens} />
          </div>
        </PageSection>
      )}

      <PageSection level="group" title={T.boundaryLog}>
        <Timeline aria-label={T.boundaryLog} size="sm">
          {[...s.log].reverse().map((l) => (
            <TimelineItem
              key={`${l.text}-${l.at}-${l.live === true}`}
              author="system"
              title={l.text}
              time={l.at}
              running={l.live === true}
            />
          ))}
        </Timeline>
      </PageSection>
    </aside>
  );
}
