import type { ReactNode } from "react";
import { DotOrb } from "./effects/dot-orb.tsx";
import { ORB_STATE } from "./effects/fx-config.ts";

// 생각 표시(DP-162·168 [결정: 2026-11-13 사용자], DP-208 [결정: 2026-11-15 사용자]). thinking-orbs(MIT, libraries.dev)의 점 구슬이다. 상태는 사용자가 짚은 미리보기 칸의 것(fx-config ORB_STATE).
// 생각에 쓰는 구슬은 모두 작은 프리셋(20) 하나다(사용자: "작은거 기준으로 통일"). 첫 응답을 기다리는 줄과 생각하는 중 줄은 같은 `ThinkingLive`(구슬 + 반짝이는 글)다.
// 그리기는 라이브러리 부품(`ThinkingOrb`)이 아니라 앱의 `DotOrb`다(같은 기하 `MODE_FRAMES`·같은 잉크): 라이브러리는 canvas 해상도를 기기 배율 2에서 자르고
// 앱 배율(CSS zoom)을 몰라 150~200%에서 흐렸다. DotOrb는 기기 배율 × 앱 배율(최대 4)로 그린다. 테마는 `<html data-theme>`(없으면 운영체제 설정)를 따른다.
// 움직임을 줄이면(앱 설정 포함) 멈춘 한 장면이다. 창이 숨거나 화면 밖이면 그리지 않는다. 그려진 동안만 있다(생각이 끝나면 부르는 쪽이 지운다).

/** 구슬 프리셋(px). 라이브러리가 글줄 안 크기로 다듬은 것이다 */
const ORB_SIZE = 20;

export function ThinkingIndicator(props: {
  /** 움직이는지. 끝난 생각은 false(멈춘 한 장면) */
  readonly active: boolean;
  readonly className?: string;
}): ReactNode {
  return (
    <DotOrb
      state={ORB_STATE}
      tone="ink"
      size={ORB_SIZE}
      kind="thinking"
      live={props.active}
      data-active={props.active ? "true" : "false"}
      className={`thinking-indicator${props.className === undefined ? "" : ` ${props.className}`}`}
    />
  );
}

/**
 * 생각하는 중 표시: 14px 아이콘 칸의 작은 구슬과 반짝이는 동사. 대화 줄(`.convo-line`) 안에 둔다.
 * 생각 블록 머리와 첫 응답을 기다리는 줄이 이것 하나를 써서 기다림이 생각으로 바뀌어도 줄이 그대로다
 */
export function ThinkingLive(props: { readonly label: string }): ReactNode {
  return (
    <>
      <span className="convo-line-icon">
        <ThinkingIndicator active className="thinking-indicator-inline" />
      </span>
      <ShimmerText className="convo-line-verb" text={props.label} />
    </>
  );
}

/** 반짝이는 글. 화면 낭독은 글 하나만 읽는다(겹친 띠는 ::before의 content이고 대체 글을 비워 읽지 않는다) */
export function ShimmerText(props: {
  readonly text: string;
  readonly className?: string;
}): ReactNode {
  return (
    <span
      className={`thinking-shimmer${props.className === undefined ? "" : ` ${props.className}`}`}
      data-text={props.text}
    >
      {props.text}
    </span>
  );
}

/**
 * 단계 표시의 살아 있는 표시(DP-185 2차): caustic Stepper·Plan의 `live` 칸(14px)에 넣는 생각 구슬. 고리·별·단색 점 대신 쓴다.
 * 움직이지 않는 지금 단계(사용자 입력을 기다림)는 멈춘 한 장면이다
 */
export function stepperLive(moving: boolean): ReactNode {
  return <ThinkingIndicator active={moving} className="thinking-indicator-inline" />;
}
