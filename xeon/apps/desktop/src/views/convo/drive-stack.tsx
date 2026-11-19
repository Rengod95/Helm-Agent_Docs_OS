import {
  ChevronRight,
  CircleDot,
  Compass,
  MessageCircleQuestion,
  Pause,
} from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { Fragment, type ReactNode } from "react";
import { InfoTip } from "../craft/info-tip.tsx";
import {
  driveStateTextOf,
  type DriveMeter,
  type DriveStackView,
  type DriveStep,
} from "./drive-stack-model.ts";

// Drive 스택 그림 둘(lcM6a, L4 desktop-ux §6.6.1).
// - 띠(`DriveStackBand`): 입력창 위 한 줄. "기본 › helm › verifier"에서 지금 이끄는 칸을 굵게, 기다리는 칸을 흐리게 적는다.
// - 목록(`DriveStackList`): 런타임 탭·검사 탭. 띠와 같은 순서(아래 칸부터)로 한 줄씩, 넘겨받은 칸일수록 들여 쓰고 칸마다 상태와 한도 칸을 적는다.
// 아이콘은 상태 하나에 하나다: 이끄는 중 나침반(강조색), 핸드오프하고 기다림 멈춤, 답을 기다림 물음 말풍선(경고색), 기본 루프 점.

function StateIcon(props: { readonly step: DriveStep }): ReactNode {
  const { step } = props;
  if (step.state === "asking") {
    return <MessageCircleQuestion aria-hidden className="size-3.5 shrink-0 text-warning-text" />;
  }
  if (step.state === "waiting") {
    return <Pause aria-hidden className="size-3.5 shrink-0 text-text-tertiary" />;
  }
  if (step.core) return <CircleDot aria-hidden className="size-3.5 shrink-0 text-text-tertiary" />;
  return <Compass aria-hidden className="size-3.5 shrink-0 text-accent-text" />;
}

function Meters(props: { readonly meters: readonly DriveMeter[] }): ReactNode {
  if (props.meters.length === 0) return null;
  return (
    <span className="flex items-center gap-1.5 text-footnote text-text-tertiary tabular-nums">
      {props.meters.map((meter) => (
        <span key={meter.text} className={meter.warn ? "text-warning-text" : undefined}>
          {meter.text}
        </span>
      ))}
    </span>
  );
}

/** 입력창 위 한 줄. 플러그인 프레임이 없으면(기본 루프만) 그리지 않는다 */
export function DriveStackBand(props: { readonly view: DriveStackView }): ReactNode {
  const { view } = props;
  const top = view.steps.at(-1);
  if (view.alone || top === undefined) return null;
  return (
    <div
      role="status"
      aria-label={t("desktop.drive.aria", { path: view.path })}
      data-slot="drive-stack-band"
      className="flex min-h-7 min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-3 text-ui"
    >
      <StateIcon step={top} />
      <span className="flex min-w-0 items-center gap-1" aria-hidden>
        {view.steps.map((step, index) => (
          <Fragment key={step.key}>
            {index === 0 ? null : <ChevronRight className="size-3 shrink-0 text-text-tertiary" />}
            <span
              data-drive-step={step.state}
              className={
                step === top
                  ? "truncate text-ui-strong text-text-primary"
                  : "truncate text-text-tertiary"
              }
            >
              {step.name}
            </span>
          </Fragment>
        ))}
      </span>
      <span className="text-text-secondary">
        {view.handoff && top.state === "driving"
          ? t("desktop.drive.handoff")
          : driveStateTextOf(top.state)}
      </span>
      <Meters meters={top.meters} />
      <InfoTip text={t("desktop.drive.info")} label={t("desktop.drive.infoLabel")} />
    </div>
  );
}

/** 아래 칸 들여쓰기(12px씩, 넷째부터 같다) */
const INDENT = ["", "ps-3", "ps-6", "ps-9"] as const;

/**
 * 런타임 탭·검사 탭의 스택 목록. 띠의 "기본 › helm › verifier"와 같은 순서로 아래 칸(기본)부터 적고,
 * 핸드오프로 넘겨받은 칸일수록 들여 쓴다. 맨 끝 줄이 지금 이끄는 칸이다.
 */
export function DriveStackList(props: { readonly view: DriveStackView }): ReactNode {
  const { view } = props;
  const top = view.steps.at(-1);
  return (
    <div className="grid gap-1.5" data-slot="drive-stack-list">
      <ol
        aria-label={t("desktop.drive.aria", { path: view.path })}
        className="m-0 grid list-none gap-1 p-0"
      >
        {view.steps.map((step, index) => (
          <li
            key={step.key}
            data-drive-step={step.state}
            className={`flex min-h-7 flex-wrap items-center gap-x-2 gap-y-0.5 text-ui ${INDENT[Math.min(index, INDENT.length - 1)] ?? ""}`}
          >
            <StateIcon step={step} />
            <span
              className={step === top ? "text-ui-strong text-text-primary" : "text-text-secondary"}
            >
              {step.name}
            </span>
            {step.core && view.alone ? (
              <span className="text-text-tertiary">{t("desktop.drive.alone")}</span>
            ) : (
              <span className="text-text-tertiary">{driveStateTextOf(step.state)}</span>
            )}
            <Meters meters={step.meters} />
          </li>
        ))}
      </ol>
    </div>
  );
}
