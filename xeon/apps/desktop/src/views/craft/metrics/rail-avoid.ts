// 인사이트 열이 셸의 오른쪽 세로 단추 띠(`[data-end-rail]`, DP-135)를 비키는 법(m6X3).
// 열은 창 오른쪽 끝까지 가고 왼쪽·오른쪽 안쪽 여백이 같다. 띠는 본문 세로 가운데의 짧은 구간에만 떠 있으므로, 띠와 같은 높이에 걸린
// 덩어리(`data-rail-avoid`: 카드, 접힌 줄, 묶음 머리)만 그 안쪽 끝 여백을 늘려 내용을 띠 왼쪽에서 끝낸다. 덩어리 안의 줄은 모두 한 줄이라
// (말줄임) 여백이 바뀌어도 높이는 그대로다. 재는 때는 열을 스크롤하거나 크기가 바뀔 때뿐이라 쉬는 화면에서는 일하지 않는다.
import { useEffect, type RefObject } from "react";
import { cssPxOf, cssZoomOf } from "../../../lib/zoom.ts";

/** 띠와 내용 사이에 남길 틈(px) */
export const RAIL_GAP = 8;

/** 화면 위 상자(`getBoundingClientRect`의 네 변) */
export interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * 덩어리가 띠를 비키려고 안쪽 끝 여백에 더할 화면 px. 덩어리의 내용 끝(`box.right − baseEnd`)이 띠 왼쪽 − 틈보다 오른쪽에 있고
 * 세로로 띠(위아래 틈 포함)와 겹칠 때만 0보다 크다. 띠가 없으면 0
 */
export function railInsetOf(
  box: Box,
  rail: Box | null,
  baseEnd: number,
  gap: number = RAIL_GAP,
): number {
  if (rail === null) return 0;
  const overlapsY = box.bottom > rail.top - gap && box.top < rail.bottom + gap;
  if (!overlapsY) return 0;
  const contentEnd = box.right - baseEnd;
  return Math.max(0, Math.ceil(contentEnd - (rail.left - gap)));
}

function railBox(): Box | null {
  const bar = document.querySelector("[data-end-rail] [role='toolbar']");
  if (bar === null) return null;
  const r = bar.getBoundingClientRect();
  return r.width === 0 ? null : r;
}

/**
 * `scroller` 안의 `[data-rail-avoid="<기본 끝 여백 px>"]` 덩어리마다 `--rail-avoid`(CSS px)를 적는다.
 * 덩어리는 `pe-[calc(<기본>+var(--rail-avoid,0px))]`처럼 그 값을 끝 여백에 더해 쓴다
 */
export function useRailAvoid(scroller: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = scroller.current;
    if (el === null) return undefined;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const rail = railBox();
      for (const unit of el.querySelectorAll<HTMLElement>("[data-rail-avoid]")) {
        const base = Number(unit.dataset.railAvoid ?? "0");
        const zoom = cssZoomOf(unit);
        const screenBase = Number.isFinite(base) ? base * zoom : 0;
        const inset = cssPxOf(railInsetOf(unit.getBoundingClientRect(), rail, screenBase), zoom);
        const next = inset === 0 ? "" : `${String(Math.ceil(inset))}px`;
        if (unit.style.getPropertyValue("--rail-avoid") !== next) {
          if (next === "") unit.style.removeProperty("--rail-avoid");
          else unit.style.setProperty("--rail-avoid", next);
        }
      }
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    schedule();
    el.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(el);
    const content = el.firstElementChild;
    if (content !== null) observer?.observe(content);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      el.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [scroller]);
}
