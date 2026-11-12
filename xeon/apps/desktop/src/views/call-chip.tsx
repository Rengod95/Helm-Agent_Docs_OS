import type { ReactNode } from "react";
import { DrawnCheck } from "./effects/drawn-check.tsx";

/**
 * 도구 호출 줄의 상태 칩(dzM2 시안 §3, DP-118). 실행 중에는 테두리 칩 + 스피너 + 경과 초(줄 아래 변의 굴절광은 ToolLine), 끝나면 칩 틀 없이
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
  /** 승인을 기다리는 중. 스피너가 멈춘 고리다 */
  readonly waiting?: boolean;
  /** 이 칩이 화면에 있는 동안 상태가 바뀌었다. 끝 모양으로 가는 움직임을 이때만 돌린다 */
  readonly changed?: boolean;
};

const ICON_PROPS = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function AlertIcon(): ReactNode {
  return (
    <svg {...ICON_PROPS} className="call-chip-icon">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5M8 11h.01" />
    </svg>
  );
}

/** 막힘·거부: 사고가 아니라 정책이 멈춘 것이라 느낌표 대신 금지 표시를 쓴다 */
function BanIcon(): ReactNode {
  return (
    <svg {...ICON_PROPS} className="call-chip-icon">
      <circle cx="8" cy="8" r="6" />
      <path d="m3.8 3.8 8.4 8.4" />
    </svg>
  );
}

function iconOf(props: CallChipProps): ReactNode {
  if (props.status === "running") return <span className="call-chip-spinner" />;
  return props.tone === "warning" ? <BanIcon /> : <AlertIcon />;
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
