import { ThinkingOrb } from "thinking-orbs";
import type { ReactNode } from "react";
import { useMotionReduced } from "../lib/motion-presets.tsx";
import { ORB_STATE } from "./effects/fx-config.ts";

// 생각 표시(DP-162 [결정: 2026-11-12 사용자]). thinking-orbs(MIT, libraries.dev)의 점 orb다. 상태는 사용자가 짚은 미리보기 칸의 것(fx-config ORB_STATE).
// 크기는 라이브러리가 따로 다듬은 두 프리셋(20: 글줄 안, 64: 대기 알약)만 쓰고, 보이는 크기(`display`)는 자리에 맞춘다.
// 테마는 라이브러리가 `<html data-theme>`(없으면 운영체제 설정)를 따라 고른다. 움직임을 줄이면(앱 설정 포함) 멈춘 한 장면이다.
// 창이 숨거나 화면 밖이면 라이브러리가 그리기를 멈춘다. 그려진 동안만 있다(생각이 끝나면 부르는 쪽이 지운다).

export function ThinkingIndicator(props: {
  /** 라이브러리 프리셋. 20은 글줄 안, 64는 대기 알약 */
  readonly size: 20 | 64;
  /** 보이는 한 변(px). 없으면 프리셋 크기 */
  readonly display?: number;
  /** 움직이는지. 끝난 생각은 false(멈춘 한 장면) */
  readonly active: boolean;
  readonly className?: string;
}): ReactNode {
  const reduced = useMotionReduced();
  const side = props.display ?? props.size;
  return (
    <ThinkingOrb
      state={ORB_STATE}
      size={props.size}
      theme="auto"
      paused={!props.active || reduced}
      aria-hidden
      data-active={props.active ? "true" : "false"}
      className={`thinking-indicator${props.className === undefined ? "" : ` ${props.className}`}`}
      style={{ width: side, height: side }}
    />
  );
}

/**
 * orb와 반짝이는 글의 알약(libraries.dev/orbs 미리보기 4번째 칸). 첫 응답을 기다리는 줄에 쓴다.
 * 글 위로 밝은 띠가 2초에 한 번 왼쪽으로 지나간다(같은 글을 겹쳐 그린 뒤 background-clip: text). 움직임을 줄이면 띠가 없다
 */
export function ThinkingPill(props: { readonly label: string }): ReactNode {
  return (
    <span className="thinking-pill">
      <ThinkingIndicator size={64} display={36} active />
      <ShimmerText text={props.label} />
    </span>
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
