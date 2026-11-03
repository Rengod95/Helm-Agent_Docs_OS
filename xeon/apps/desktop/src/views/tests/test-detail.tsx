// 테스트 화면의 상세(§6.26). replay는 판정 배지, 절단 띠, 첫 차이, 효과 수(참고), 실패 종류와 "JSON 복사"를 그린다.
// Test run은 상태, 멈춘 채 표지, 단계 이름과 "멈춤·이어서·한 경계씩"을 그린다. 새 턴을 여는 동작은 두지 않는다.
import { t } from "@fresnel/client/i18n";
import {
  cutStripOf,
  effectRowsOf,
  replayVerdictOf,
  runControlsOf,
  type CutStripVM,
  type RunControl,
  type TestRowVM,
} from "@fresnel/client/workbench";
import { Button, Progress } from "@caustic/react";
import { Copy } from "@caustic/react/icons";
import type { ReplayReport } from "@fresnel/contracts/services";
import type { ReactNode } from "react";
import {
  CELL_TEXT,
  CONTROL_TEXT,
  EFFECT_TEXT,
  FAILURE_TEXT,
  KIND_TEXT,
  STATE_TEXT,
  VERDICT_TEXT,
} from "./tests-text.ts";

const MUTED = "m-0 text-ui-sm text-text-tertiary";

const TAG_TONE = {
  neutral: "bg-neutral-soft text-text-secondary",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text",
} as const;

export type TagTone = keyof typeof TAG_TONE;

/** 판정과 상태의 작은 표지. 색은 caustic 토큰 클래스로만 준다(`Badge`의 `tone`은 쓰지 않는다) */
export function Tag(props: { readonly tone: TagTone; readonly children: ReactNode }): ReactNode {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-ui-sm font-medium ${TAG_TONE[props.tone]}`}
    >
      {props.children}
    </span>
  );
}

export interface TestDetailHandlers {
  readonly control: (threadId: string, action: RunControl) => void;
  readonly copy: (report: ReplayReport) => void;
}

export interface TestDetailProps {
  readonly row: TestRowVM;
  /** 이 Test run이 멈춘 채인가(명령 결과가 든 값) */
  readonly paused: boolean;
  /** 단계 이름. 읽지 못했거나 Test run이 아니면 null */
  readonly phase: string | null;
  readonly handlers: TestDetailHandlers;
}

export function TestDetail(props: TestDetailProps): ReactNode {
  const { row, paused, phase, handlers } = props;
  return (
    <section
      aria-label={t("desktop.tests.detail.heading")}
      className="grid gap-3 rounded-md border border-border-subtle p-4"
    >
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="m-0 text-ui-strong text-text-primary">{row.target}</h2>
        <span className="text-ui-sm text-text-tertiary">{t(KIND_TEXT[row.kind])}</span>
        <span className="text-ui-sm text-text-secondary">{t(STATE_TEXT[row.state])}</span>
      </header>
      {row.replay === null ? null : <ReplayResult report={row.replay} handlers={handlers} />}
      {row.kind === "testRun" ? (
        <TestRunState row={row} paused={paused} phase={phase} handlers={handlers} />
      ) : null}
    </section>
  );
}

/** 절단 띠. 칸은 커밋 하나의 절단이다. 같은 칸만 칠하고 나머지는 wire가 칸별 값을 주지 않아 칠하지 않는다 */
function CutStrip(props: { readonly strip: CutStripVM }): ReactNode {
  const { strip } = props;
  return (
    <div className="grid gap-1">
      <ol aria-label={t("desktop.tests.detail.heading")} className="m-0 flex flex-wrap gap-1 p-0">
        {strip.cells.map((cell) => (
          <li
            key={cell.commitIndex}
            data-cell={cell.cell}
            title={t(CELL_TEXT[cell.cell])}
            className={
              cell.cell === "same"
                ? "h-3 w-3 rounded-sm bg-success-soft"
                : "h-3 w-3 rounded-sm bg-neutral-track"
            }
          >
            <span className="sr-only">{t(CELL_TEXT[cell.cell])}</span>
          </li>
        ))}
      </ol>
      {strip.hidden > 0 ? (
        <p className={MUTED}>{t("desktop.tests.detail.cutHidden", { hidden: strip.hidden })}</p>
      ) : null}
    </div>
  );
}

function ReplayResult(props: {
  readonly report: ReplayReport;
  readonly handlers: TestDetailHandlers;
}): ReactNode {
  const { report, handlers } = props;
  const verdict = replayVerdictOf(report);
  const strip = cutStripOf(report);
  const tone: TagTone =
    verdict.kind === "same" ? "success" : verdict.kind === "digest-differs" ? "warning" : "danger";
  return (
    <div className="grid gap-3 text-ui-sm">
      <p className={MUTED}>{t("desktop.tests.detail.limit")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={tone}>{t(VERDICT_TEXT[verdict.kind])}</Tag>
        <span className="text-text-primary">
          {t("desktop.tests.detail.cut", { commits: report.commits, passed: report.passed })}
        </span>
      </div>
      <CutStrip strip={strip} />
      {report.passed === report.commits ? null : (
        <p className={MUTED}>{t("desktop.tests.detail.cutNote")}</p>
      )}
      <p className="m-0 text-text-primary">
        {report.firstDiff === null
          ? t("desktop.tests.detail.firstDiffNone")
          : t("desktop.tests.detail.firstDiff", { seq: report.firstDiff })}
      </p>
      <section aria-label={t("desktop.tests.detail.effects")} className="grid gap-1">
        <h3 className="m-0 text-ui-sm font-semibold text-text-secondary">
          {t("desktop.tests.detail.effects")}
        </h3>
        <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {effectRowsOf(report).map((row) => (
            <div key={row.key} className="grid gap-0.5">
              <dt className="text-ui-sm text-text-tertiary">{t(EFFECT_TEXT[row.key])}</dt>
              <dd className="m-0 font-mono text-text-primary">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      {report.failure === null ? null : (
        <p className="m-0 text-danger-text">
          {t("desktop.tests.detail.failure")}: {t(FAILURE_TEXT[report.failure])}
        </p>
      )}
      <div>
        <Button
          variant="outline"
          size="sm"
          iconStart={<Copy />}
          onClick={() => {
            handlers.copy(report);
          }}
        >
          {t("desktop.tests.detail.copyJson")}
        </Button>
      </div>
    </div>
  );
}

function TestRunState(props: {
  readonly row: TestRowVM;
  readonly paused: boolean;
  readonly phase: string | null;
  readonly handlers: TestDetailHandlers;
}): ReactNode {
  const { row, paused, phase, handlers } = props;
  const controls = runControlsOf(row, paused);
  const threadId = row.threadId;
  return (
    <div className="grid gap-3 text-ui-sm">
      {row.state === "running" ? <Progress indeterminate size="sm" /> : null}
      <div className="flex flex-wrap items-center gap-2">
        {paused ? <Tag tone="warning">{t("desktop.tests.detail.paused")}</Tag> : null}
        <span className="text-text-secondary">
          {phase === null
            ? t("desktop.tests.detail.phaseNone")
            : t("desktop.tests.detail.phase", { phase })}
        </span>
      </div>
      {controls.length === 0 || threadId === null ? null : (
        <div
          role="group"
          aria-label={t("desktop.tests.detail.heading")}
          className="flex flex-wrap gap-2"
        >
          {controls.map((action) => (
            <Button
              key={action}
              size="sm"
              variant="outline"
              onClick={() => {
                handlers.control(threadId, action);
              }}
            >
              {t(CONTROL_TEXT[action])}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
