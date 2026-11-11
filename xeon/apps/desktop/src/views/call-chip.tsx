import { Check } from "@caustic/react/icons";
import type { ReactNode } from "react";

/**
 * 도구 호출 줄의 상태 칩. 실행 중에는 채움이 가로로 쓸리는 칩과 스피너, 끝나면 테두리·채움 없이 아이콘 세트의 기본 체크만 그리고(DP-67),
 * 실패 종류(실패·중단됨은 위험, 거부함·막힘·훅 막음은 경고)는 빛깔과 아이콘이 갈린다. 움직임은 `call-chip.css`가 맡고
 * 움직임 줄이기(OS 설정, 앱 설정 `data-motion="reduce"`)에서는 전환 없이 끝 모양이 바로 보인다.
 * 아이디어는 React Bits의 Call Chip(실행 중 채움이 쓸리고 초록으로 끝나거나 빨강으로 흔들림)에서 얻었고 코드는 옮기지 않고 직접 썼다.
 *
 * 칩 글은 DOM 글이 아니라 `data-text`를 CSS가 그린다(읽는 글이 둘로 겹치지 않게).
 * 칩은 눈으로 보는 겉모양일 뿐이다. 같은 글은 caustic ToolCall의 상태 알약이 읽는 사람용으로 그대로 들고 있다(화면에서만 가린다).
 */
export type CallChipTone = "danger" | "warning" | "neutral";

export type CallChipProps = {
  readonly status: "running" | "done" | "failed";
  /** 칩 글(실행 중 경과 시간, 실패 종류 이름). 끝남은 보통 비운다 */
  readonly label?: string | undefined;
  /** 실패일 때 빛깔. 기본은 위험이다 */
  readonly tone?: CallChipTone;
  /** 승인을 기다리는 중. 채움이 쓸리지 않고 멈춰 있다 */
  readonly waiting?: boolean;
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
  if (props.status === "done")
    return <Check aria-hidden className="call-chip-icon call-chip-check" />;
  return props.tone === "warning" ? <BanIcon /> : <AlertIcon />;
}

export function CallChip(props: CallChipProps): ReactNode {
  const tone = props.status === "failed" ? (props.tone ?? "danger") : "neutral";
  return (
    <span
      data-slot="call-chip"
      data-status={props.status}
      data-tone={tone}
      data-waiting={props.waiting === true ? "true" : undefined}
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
