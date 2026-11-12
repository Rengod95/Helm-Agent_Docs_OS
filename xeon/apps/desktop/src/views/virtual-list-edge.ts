// 대화 기록 위아래 가장자리의 아주 약한 흐림(dzE 시안 §4, DP-128 [결정: 2026-11-12 사용자]).
// 그쪽에 가려진 내용이 있을 때만 스크롤 영역에 `data-fade-top`·`data-fade-bottom`을 단다. 모양(mask 그라데이션)은 styles.css의 `.scroller` 규칙이다.
// 속성은 DOM에 직접 쓴다: 스크롤마다 React를 다시 그리지 않는다. blur(backdrop-filter)는 스크롤 프레임마다 다시 그려 쓰지 않는다(시안 §7 측정).

import { useLayoutEffect, type RefObject } from "react";

/** 이만큼(px) 안쪽이면 위 끝에 닿은 것으로 본다(소수 스크롤 위치·확대율 반올림) */
const TOP_SLACK_PX = 2;
/**
 * 아래는 흐림 높이(24px)만큼 여유를 둔다. 바닥에 붙어 따라 내려가는 동안(DP-120 보간) 답이 한 줄 자랄 때마다 잠깐 바닥에서 떨어지는데,
 * 그때마다 흐림이 켜졌다 꺼지며 마지막 줄이 깜빡이지 않게 한다
 */
const BOTTOM_SLACK_PX = 24;

export type EdgeFade = { readonly top: boolean; readonly bottom: boolean };

/** 위·아래에 가려진 내용이 있는가 */
export function edgeFadeOf(input: {
  readonly top: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}): EdgeFade {
  return {
    top: input.top > TOP_SLACK_PX,
    bottom: input.scrollHeight - input.clientHeight - input.top > BOTTOM_SLACK_PX,
  };
}

function mark(el: HTMLElement, name: string, on: boolean): void {
  if (on === el.hasAttribute(name)) return;
  if (on) el.setAttribute(name, "");
  else el.removeAttribute(name);
}

/** 스크롤·크기 변화(흐르는 답이 자람)마다 가장자리 속성을 맞춘다 */
export function useEdgeFade(scroller: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el === null) return undefined;
    const update = (): void => {
      const fade = edgeFadeOf({
        top: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      });
      mark(el, "data-fade-top", fade.top);
      mark(el, "data-fade-bottom", fade.bottom);
    };
    el.addEventListener("scroll", update, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resize?.observe(el);
    const content = el.firstElementChild;
    if (content !== null) resize?.observe(content);
    update();
    return () => {
      el.removeEventListener("scroll", update);
      resize?.disconnect();
    };
  }, [scroller]);
}
