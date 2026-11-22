import type { ReactNode } from "react";
import { BeamEdge } from "./effects/beam.tsx";
import { DrawnCheck } from "./effects/drawn-check.tsx";
import { LINE_GLYPH, octagonPath } from "./illustrations/line-glyph.ts";

/**
 * 도구 호출 줄의 상태 칩(dzM2 시안 §3, DP-118·127). 실행 중에는 테두리 칩 + 경과 초이고 칩 아래 변의 곧은 구간에 beam 작은 변형이 흐른다
 * (스피너 없음, 둥근 양 끝에는 빛이 없다, 승인 대기면 빛이 멈추고 같은 구간이 경고 색으로 고정). 끝나면 칩 틀 없이
 * 체크 하나(DP-67), 실패 종류(실패·중단됨은 위험, 거부함·막힘·훅 막음은 경고)는 빛깔과 아이콘이 갈린다.
 * 움직임은 상태가 바뀐 순간에만 돈다(`changed`): 끝남은 체크 선이 그려지고, 실패는 칩 바탕이 한 번 번진다. 이미 끝난 줄을 다시 그리면 끝 모양 그대로다.
 * 움직임 줄이기(OS 설정, 앱 설정 `data-motion="reduce"`)에서는 전환 없이 끝 모양이 바로 보인다.
 *
 * 칩 글은 DOM 글이 아니라 `data-text`를 CSS가 그린다(읽는 글이 둘로 겹치지 않게).
 * 칩은 눈으로 보는 겉모양일 뿐이다. 같은 글은 caustic ToolCall의 상태 알약이 읽는 사람용으로 그대로 들고 있다(화면에서만 가린다).
 */
type CallChipTone = "danger" | "warning" | "neutral";

export type CallChipProps = {
  readonly status: "running" | "done" | "failed";
  /** 칩 글(실행 중 경과 시간, 실패 종류 이름). 끝남은 보통 비운다 */
  readonly label?: string | undefined;
  /** 실패일 때 빛깔. 기본은 위험이다 */
  readonly tone?: CallChipTone;
  /** 승인을 기다리는 중. beam이 멈추고 아래 변 곧은 구간이 경고 색 선이다 */
  readonly waiting?: boolean;
  /** 이 칩이 화면에 있는 동안 상태가 바뀌었다. 끝 모양으로 가는 움직임을 이때만 돌린다 */
  readonly changed?: boolean;
};

/**
 * 실패 그림(m6R7 [결정: 2026-11-22 사용자, 도구 줄의 실패 그림을 리뷰 화면과 같은 팔각형으로]). 고리와 느낌표를 쓰지 않는다.
 * 실패(위험)는 리뷰 화면의 막힘과 같은 팔각형 + 가로 막대, 정책 거부(주의)는 팔각형 + 사선이다: 사고가 아니라 정책이 멈춘 것이다.
 * 선은 바탕 선(`LINE_GLYPH`, 화면 1px). 칸은 그려지는 크기(칩 12, 줄 표시 14)와 같아서 가로·세로 획이 0.5 칸 배수에 놓이고 번지지 않는다
 */
type IconSize = 12 | 14;

const OCTAGON: Readonly<Record<IconSize, string>> = {
  12: octagonPath(1.5, 10.5, 2.65, 0.45),
  14: octagonPath(1.5, 12.5, 3.25, 0.5),
};
const MARK: Readonly<Record<"failed" | "denied", Readonly<Record<IconSize, string>>>> = {
  failed: { 12: "M4 6h4", 14: "M4.5 7h5" },
  denied: { 12: "M4.1 4.1 7.9 7.9", 14: "M4.6 4.6 9.4 9.4" },
};

function StopIcon(props: {
  readonly mark: "failed" | "denied";
  readonly size: IconSize;
}): ReactNode {
  return (
    <svg
      viewBox={`0 0 ${String(props.size)} ${String(props.size)}`}
      {...LINE_GLYPH}
      className={`${LINE_GLYPH.className} call-chip-icon`}
      data-call-glyph={props.mark}
      aria-hidden
    >
      <path d={OCTAGON[props.size]} />
      <path d={MARK[props.mark][props.size]} />
    </svg>
  );
}

function iconOf(props: CallChipProps): ReactNode {
  if (props.status === "running")
    return <BeamEdge state={props.waiting === true ? "wait" : "run"} />;
  return <StopIcon mark={props.tone === "warning" ? "denied" : "failed"} size={12} />;
}

export function CallChip(props: CallChipProps): ReactNode {
  // 끝남: 테두리·채움·여백·그려지는 전환이 없는 맨 체크 14px(2026-11-11 사용자 "단순 체크 아이콘만")
  if (props.status === "done") {
    return (
      <span
        data-slot="call-chip"
        data-status="done"
        data-tone="neutral"
        aria-hidden
        className="call-chip-done"
      >
        <DrawnCheck draw={props.changed === true} className="call-chip-check" />
      </span>
    );
  }
  const tone = props.status === "failed" ? (props.tone ?? "danger") : "neutral";
  return (
    <span
      data-slot="call-chip"
      data-status={props.status}
      data-tone={tone}
      data-waiting={props.waiting === true ? "true" : undefined}
      data-changed={props.changed === true ? "true" : undefined}
      aria-hidden
      className="call-chip"
    >
      <span className="call-chip-fill" />
      {iconOf(props)}
      {props.label === undefined || props.label === "" ? null : (
        <span className="call-chip-label" data-text={props.label} />
      )}
    </span>
  );
}

/**
 * 묶음 안 줄의 상태 표시(DP-154). 알약·경과 초 없이 14px 칸 하나다: 실행 중은 흐린 고리(승인 대기는 경고 색), 끝남은 체크,
 * 실패는 종류 글리프 + 짧은 이름(12, 톤 글자색). 경과 초와 실행 중 수는 묶음 머리가 한 번 말한다.
 * 움직이는 빛은 두지 않는다: 열 줄이 동시에 돌 때 빛이 줄마다 겹치지 않게 한다(DP-127)
 */
export function CallMark(props: CallChipProps): ReactNode {
  if (props.status === "done")
    return (
      <CallChip
        status="done"
        {...(props.changed === undefined ? {} : { changed: props.changed })}
      />
    );
  if (props.status === "running") {
    return (
      <span
        data-slot="call-mark"
        data-status="running"
        data-waiting={props.waiting === true ? "true" : undefined}
        aria-hidden
        className="call-mark"
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden className="call-mark-ring">
          <circle
            cx="8"
            cy="8"
            r="5.25"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="2.5 2.25"
          />
        </svg>
      </span>
    );
  }
  const tone = props.tone ?? "danger";
  return (
    <span
      data-slot="call-mark"
      data-status="failed"
      data-tone={tone}
      aria-hidden
      className="call-mark"
    >
      <StopIcon mark={tone === "warning" ? "denied" : "failed"} size={14} />
      {props.label === undefined || props.label === "" ? null : (
        <span className="call-mark-label">{props.label}</span>
      )}
    </span>
  );
}
