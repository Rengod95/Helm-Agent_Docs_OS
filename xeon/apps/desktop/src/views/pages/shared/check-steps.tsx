import { Button } from "@caustic/react";
import { Check, CircleAlert, Minus, X } from "@caustic/react/icons";
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { ReactNode } from "react";
import { FORM_CONTROL_SIZE } from "../settings/settings-section.tsx";

// 점검 줄(L4.desktop-ux DP-85 [결정: 2026-11-11 사용자]). "넣기 → 시험 → 결과"를 보이는 앱 공용 부품이다.
// 모델 제공자 키, 시크릿, 원격 연결 wizard, MCP 연결 시험, 샌드박스 자가 점검이 같은 모양을 쓴다. 순수 표시 부품이고 데이터와 동작은 props다.
//   CheckSteps  여러 단계 세로 목록. 줄 = 상태 아이콘(16칸) · 이름 13/500 · 원인 13 secondary ……… 걸린 시간 12 tertiary.
//               실패 줄 아래 들여서 고치는 법(13 tertiary)과 동작 단추 하나. 머리에 "N개 중 M개 통과"와 "다시 시험"을 둘 수 있다.
//   CheckInline 한 단계. [시험] 단추 옆에 결과 한 줄, 실패면 아래에 고치는 법과 동작 단추.
// 바탕·테두리·그림자가 없다. 넣는 카드의 면을 쓴다. 상태 색은 아이콘에만 주고 글은 secondary다(색만으로 뜻을 주지 않고 낭독기 글이 따로 있다).
// 표시는 caustic Stepper의 렌즈와 한 식구다(DP-187): 기다림 = 1px 테 원, 도는 중 = 1.5px 테 + 숨 쉬는 심, 통과 체크, 실패 ×,
// 건너뜀 −. 회전 스피너는 쓰지 않는다. 움직임 줄이기에서 심은 멈춘다(caustic 토큰 규칙).

/** 단계 하나의 상태. 기다림 → 도는 중 → 통과·실패·건너뜀. `attention`은 실패가 아니라 사용자 확인을 기다리는 멈춤이다(새 호스트 키) */
export type CheckState = "waiting" | "running" | "passed" | "failed" | "attention" | "skipped";

export interface CheckStep {
  /** 단계 이름의 안정된 키 */
  readonly id: string;
  /** 이름(짧게, "키 저장") */
  readonly label: string;
  readonly state: CheckState;
  /** 한 줄 원인이나 결과("41바이트", "키가 저장소에 없어요"). 없으면 null */
  readonly detail?: string | null;
  /** 실패했을 때 고치는 법(한두 문장). 실패가 아니면 그리지 않는다 */
  readonly fix?: string | null;
  /** 고치는 동작 하나(실패 줄 아래 단추) */
  readonly action?: { readonly label: string; readonly onAction: () => void } | null;
  /** 걸린 시간(ms). 끝난 단계만 보인다 */
  readonly elapsedMs?: number | null;
}

const STATE_LABEL: Readonly<Record<CheckState, MessageId>> = {
  waiting: "desktop.check.state.waiting",
  running: "desktop.check.state.running",
  passed: "desktop.check.state.passed",
  failed: "desktop.check.state.failed",
  attention: "desktop.check.state.attention",
  skipped: "desktop.check.state.skipped",
};

/** 걸린 시간의 짧은 글: 1초 밑은 ms, 그 위는 소수 한 자리 초 */
export function elapsedText(ms: number): string {
  if (ms < 1000) return `${String(Math.max(0, Math.round(ms)))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 단계 목록의 요약. 하나라도 도는 중이면 running, 실패가 있으면 failed, 모두 통과(건너뜀 포함)면 passed, 아니면 waiting */
export function overallOf(steps: readonly CheckStep[]): CheckState {
  if (steps.some((step) => step.state === "running")) return "running";
  if (steps.some((step) => step.state === "failed")) return "failed";
  if (steps.some((step) => step.state === "attention")) return "attention";
  if (steps.length > 0 && steps.every((s) => s.state === "passed" || s.state === "skipped")) {
    return "passed";
  }
  return "waiting";
}

/** 상태 표시 14px(렌즈 둘은 12px). 16px 칸 가운데 글자 첫 줄에 맞춘다 */
function CheckIcon(props: { readonly state: CheckState }): ReactNode {
  const cls = "size-icon-sm";
  switch (props.state) {
    case "passed":
      return <Check aria-hidden className={`${cls} text-success-text`} />;
    case "failed":
      return <X aria-hidden className={`${cls} text-danger-text`} />;
    case "attention":
      return <CircleAlert aria-hidden className={`${cls} text-warning-text`} />;
    case "running":
      return (
        <span
          aria-hidden
          className="grid size-3 place-items-center rounded-full shadow-[inset_0_0_0_1.5px_var(--cs-color-accent-solid)]"
        >
          <span className="size-1 animate-breathe rounded-full bg-accent-solid" />
        </span>
      );
    case "skipped":
      return <Minus aria-hidden className={`${cls} text-text-tertiary`} />;
    case "waiting":
      return (
        <span
          aria-hidden
          className="size-3 rounded-full shadow-[inset_0_0_0_1px_var(--cs-color-border-strong)]"
        />
      );
    default:
      return assertNever(props.state, "CheckState");
  }
}

function StepRow(props: { readonly step: CheckStep; readonly disabled: boolean }): ReactNode {
  const { step } = props;
  const failed = step.state === "failed" || step.state === "attention";
  const done = step.state === "passed" || failed;
  return (
    <li data-slot="check-step" data-state={step.state} className="grid min-w-0 gap-1">
      <div className="flex min-h-5 min-w-0 items-start gap-2">
        <span className="flex h-5 w-4 flex-none items-center justify-center">
          <CheckIcon state={step.state} />
        </span>
        <span className="sr-only">{t(STATE_LABEL[step.state])}</span>
        <span className="min-w-0 flex-1 text-ui">
          <span
            className={`font-medium ${step.state === "waiting" || step.state === "skipped" ? "text-text-tertiary" : "text-text-primary"}`}
          >
            {step.label}
          </span>
          {step.detail === undefined || step.detail === null ? null : (
            <span className="text-text-secondary">
              <span aria-hidden className="mx-1.5 text-text-tertiary">
                ·
              </span>
              {step.detail}
            </span>
          )}
        </span>
        {done && step.elapsedMs !== undefined && step.elapsedMs !== null ? (
          <span className="flex-none pt-px font-mono text-mono-sm text-text-tertiary tabular-nums">
            {elapsedText(step.elapsedMs)}
          </span>
        ) : null}
      </div>
      {failed && ((step.fix ?? null) !== null || (step.action ?? null) !== null) ? (
        <div className="grid justify-items-start gap-2 ps-6">
          {step.fix === undefined || step.fix === null ? null : (
            <p className="m-0 text-ui text-text-tertiary">{step.fix}</p>
          )}
          {step.action === undefined || step.action === null ? null : (
            <Button
              size={FORM_CONTROL_SIZE}
              variant="outline"
              disabled={props.disabled}
              onClick={step.action.onAction}
            >
              {step.action.label}
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

export interface CheckStepsProps {
  readonly steps: readonly CheckStep[];
  /** 목록의 접근성 이름("Anthropic 연결 시험") */
  readonly label: string;
  /** 주면 머리에 요약과 "다시 시험"이 생긴다. 도는 동안은 꺼진다 */
  readonly onRetry?: (() => void) | undefined;
  /** 동작 단추를 모두 끈다(오프라인 등) */
  readonly disabled?: boolean | undefined;
}

/** 여러 단계 점검 목록. 단계가 바뀔 때마다 부모가 새 `steps`를 준다(진행 중 갱신) */
export function CheckSteps(props: CheckStepsProps): ReactNode {
  const { steps } = props;
  const overall = overallOf(steps);
  const passed = steps.filter((step) => step.state === "passed").length;
  const disabled = props.disabled === true;
  return (
    <div data-slot="check-steps" data-state={overall} className="grid min-w-0 gap-2">
      {props.onRetry === undefined ? null : (
        <div className="flex min-h-7 items-center gap-2">
          <span role="status" className="min-w-0 flex-1 text-ui-sm text-text-tertiary">
            {overall === "running"
              ? t("desktop.check.summary.running")
              : t("desktop.check.summary.done", { passed, total: steps.length })}
          </span>
          <Button
            size={FORM_CONTROL_SIZE}
            variant="ghost"
            disabled={disabled || overall === "running"}
            onClick={props.onRetry}
          >
            {t("desktop.check.retry")}
          </Button>
        </div>
      )}
      <ol
        aria-label={props.label}
        aria-busy={overall === "running"}
        className="m-0 grid list-none gap-2 p-0"
      >
        {steps.map((step) => (
          <StepRow key={step.id} step={step} disabled={disabled} />
        ))}
      </ol>
    </div>
  );
}

export interface CheckInlineProps {
  /** 시험 단추 글. 기본 "시험" */
  readonly runLabel?: string | undefined;
  /** 아직 시험하지 않았으면 null */
  readonly result: CheckStep | null;
  readonly onRun: () => void;
  readonly disabled?: boolean | undefined;
}

/** 한 단계 점검: [시험] 단추와 결과 한 줄. 실패면 아래에 고치는 법과 동작 단추 */
export function CheckInline(props: CheckInlineProps): ReactNode {
  const { result } = props;
  const running = result?.state === "running";
  const disabled = props.disabled === true;
  return (
    <div
      data-slot="check-inline"
      data-state={result?.state ?? "idle"}
      className="grid min-w-0 gap-2"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Button
          size={FORM_CONTROL_SIZE}
          variant="outline"
          disabled={disabled || running}
          onClick={props.onRun}
        >
          {props.runLabel ?? t("desktop.check.run")}
        </Button>
        {result === null ? null : (
          <span role="status" className="flex min-w-0 items-center gap-1.5 text-ui">
            <CheckIcon state={result.state} />
            <span className="sr-only">{t(STATE_LABEL[result.state])}</span>
            <span className="min-w-0 truncate text-text-secondary">
              {result.detail ?? result.label}
            </span>
            {result.state !== "running" &&
            result.elapsedMs !== undefined &&
            result.elapsedMs !== null ? (
              <span className="flex-none font-mono text-mono-sm text-text-tertiary tabular-nums">
                {elapsedText(result.elapsedMs)}
              </span>
            ) : null}
          </span>
        )}
      </div>
      {(result?.state === "failed" || result?.state === "attention") &&
      ((result.fix ?? null) !== null || (result.action ?? null) !== null) ? (
        <div className="grid justify-items-start gap-2">
          {result.fix === undefined || result.fix === null ? null : (
            <p className="m-0 text-ui text-text-tertiary">{result.fix}</p>
          )}
          {result.action === undefined || result.action === null ? null : (
            <Button
              size={FORM_CONTROL_SIZE}
              variant="outline"
              disabled={disabled}
              onClick={result.action.onAction}
            >
              {result.action.label}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
