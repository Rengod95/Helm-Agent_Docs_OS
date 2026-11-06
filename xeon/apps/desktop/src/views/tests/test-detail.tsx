// 테스트 화면의 상세(§6.26). replay는 판정 배지, 절단 띠, 첫 차이, 효과 수(참고), 실패 종류와 "JSON 복사"를 그린다.
// Test run은 상태, 멈춘 채 표지, 단계 이름과 "멈춤·이어서·한 경계씩"을 그린다. 새 턴을 여는 동작은 두지 않는다.
// 시안(c01-trials parts/detail.tsx): 상자 없이 제목 아래에 띠와 목록을 잇는다. 설명 글은 정보 아이콘 뒤(DP-58).
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
import { Button, ListDescription, ListDescriptionRow } from "@caustic/react";
import type { ReplayReport } from "@fresnel/contracts/services";
import type { ReactNode } from "react";
import { InfoTip } from "../craft/info-tip.tsx";
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
/** 시안의 목록 줄: 상자 없이, 용어 열만 좁게 */
const LD = "rounded-none [--cs-size-list-term:7.5rem] [&_[data-slot=list-description-row]]:px-0";

const TAG_TONE = {
  neutral: "bg-neutral-soft text-text-secondary",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text",
} as const;

export type TagTone = keyof typeof TAG_TONE;

/** 판정과 상태의 작은 표지. 색은 caustic 토큰 클래스로만 준다(`Badge`의 `tone`은 쓰지 않는다) */
function Tag(props: { readonly tone: TagTone; readonly children: ReactNode }): ReactNode {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-ui-sm ${TAG_TONE[props.tone]}`}
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
    <section aria-label={t("desktop.tests.detail.heading")} className="grid gap-4">
      <h2 className="m-0 truncate text-text-primary">
        {`${row.target} ${t(KIND_TEXT[row.kind])}`}
      </h2>
      {row.replay === null ? null : <ReplayResult report={row.replay} onCopy={handlers.copy} />}
      {row.kind === "testRun" ? (
        <TestRunState row={row} paused={paused} phase={phase} handlers={handlers} />
      ) : null}
    </section>
  );
}

/** 절단 띠. 칸은 커밋 하나의 절단이다. 같은 칸은 칠하고, 다른 칸은 붉은 칸으로 그린다(`cuts`의 칸별 같음·다름) */
function CutStrip(props: { readonly strip: CutStripVM }): ReactNode {
  const { strip } = props;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <ol aria-label={t("desktop.tests.detail.heading")} className="m-0 flex flex-wrap gap-0.5 p-0">
        {strip.cells.map((cell) => (
          <li
            key={cell.commitIndex}
            data-cell={cell.cell}
            title={t(CELL_TEXT[cell.cell])}
            className={`h-3.5 w-2 rounded-2xs ${cell.cell === "same" ? "bg-neutral-graphic/45" : "bg-danger-graphic"}`}
          >
            <span className="sr-only">{t(CELL_TEXT[cell.cell])}</span>
          </li>
        ))}
      </ol>
      {strip.hidden > 0 ? (
        <InfoTip text={t("desktop.tests.detail.cutHidden", { hidden: strip.hidden })} />
      ) : null}
    </div>
  );
}

/**
 * replay 결과 한 장: 판정, 절단 띠, 첫 차이, 효과 수(참고), 실패 종류, "JSON 복사". Tests 화면과 구성기 시험 실행이 같이 쓴다.
 * `limitInfo`가 참이면 한계 한 줄을 판정 옆 설명 아이콘 뒤에 둔다(구성기와 테스트 화면은 설명을 아이콘 뒤에 둔다).
 */
export function ReplayResult(props: {
  readonly report: ReplayReport;
  readonly onCopy: (report: ReplayReport) => void;
  readonly limitInfo?: boolean;
}): ReactNode {
  const { report, onCopy, limitInfo = false } = props;
  const verdict = replayVerdictOf(report);
  const strip = cutStripOf(report);
  const tone: TagTone =
    verdict.kind === "same" ? "success" : verdict.kind === "digest-differs" ? "warning" : "danger";
  return (
    <div className="grid gap-3 text-ui-sm">
      {limitInfo ? null : <p className={MUTED}>{t("desktop.tests.detail.limit")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={tone}>{t(VERDICT_TEXT[verdict.kind])}</Tag>
        <span className="text-text-primary">
          {t("desktop.tests.detail.cut", { commits: report.commits, passed: report.passed })}
        </span>
        {limitInfo ? <InfoTip text={t("desktop.tests.detail.limit")} /> : null}
      </div>
      <CutStrip strip={strip} />
      <p className="m-0 text-text-primary">
        {report.firstDiff === null
          ? t("desktop.tests.detail.firstDiffNone")
          : t("desktop.tests.detail.firstDiff", { seq: report.firstDiff })}
      </p>
      <section aria-label={t("desktop.tests.detail.effects")} className="grid gap-1">
        <h3 className="m-0 text-ui-sm text-text-secondary">{t("desktop.tests.detail.effects")}</h3>
        <ListDescription
          variant="ghost"
          size="xs"
          aria-label={t("desktop.tests.detail.effects")}
          className={LD}
        >
          {effectRowsOf(report).map((row) => (
            <ListDescriptionRow key={row.key} term={t(EFFECT_TEXT[row.key])}>
              <span className="font-mono text-text-primary">{row.value}</span>
            </ListDescriptionRow>
          ))}
        </ListDescription>
      </section>
      {report.failure === null ? null : (
        <p className="m-0 text-danger-text">
          {t("desktop.tests.detail.failure")}: {t(FAILURE_TEXT[report.failure])}
        </p>
      )}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onCopy(report);
          }}
        >
          {t("desktop.tests.detail.copyJson")}
        </Button>
      </div>
    </div>
  );
}

/** 입력창 위 테스트 띠와 같은 면(시안 Band). 글 하나와 동작 둘까지, 글 뒤에 흐린 메타 한 조각. */
function Band(props: {
  readonly text: ReactNode;
  readonly meta?: ReactNode;
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <div className="flex min-h-10 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-neutral-well px-3 py-1.5 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]">
      <span className="min-w-0 flex-1 text-ui-dense text-text-primary">
        {props.text}
        {props.meta === undefined ? null : (
          <span className="ms-2 text-ui-xs text-text-tertiary">{props.meta}</span>
        )}
      </span>
      {props.children === undefined ? null : (
        <span className="flex flex-none items-center gap-1">{props.children}</span>
      )}
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
  const phaseText =
    row.state !== "running"
      ? undefined
      : phase === null
        ? t("desktop.tests.detail.phaseNone")
        : t("desktop.tests.detail.phase", { phase });
  return (
    <Band
      text={paused ? t("desktop.tests.detail.paused") : t(STATE_TEXT[row.state])}
      meta={phaseText}
    >
      {controls.length === 0 || threadId === null
        ? null
        : controls.map((action) => (
            <Button
              key={action}
              size="xs"

              variant={action === "step" ? "ghost" : "outline"}
              onClick={() => {
                handlers.control(threadId, action);
              }}
            >
              {t(CONTROL_TEXT[action])}
            </Button>
          ))}
    </Band>
  );
}
