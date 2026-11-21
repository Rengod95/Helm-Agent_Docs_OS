// 끝까지 쓰는 화면(`ScreenDef.bleed`)이 오른쪽 떠 있는 막대를 스스로 비키는 길(m6R5, DP-68·DP-135).
// 셸은 이런 화면에 막대 자리 여백(`--stage-rail`)을 주지 않는다. 화면은 비킬 칸들을 고르는 선택자를 넘기고, 이 훅이 막대의 자리를 재어
// 막대와 세로로도 가로로도 겹치는 칸에만 `data-under-rail`과 `--rail-cut`(막대 왼쪽 끝에서 12px 앞까지 줄일 폭, CSS px)을 단다.
// 화면의 CSS가 그 값을 끝 바깥 여백(`margin-inline-end`)으로 쓴다. 겹치지 않는 칸은 열의 끝까지 간다.
// 스크롤, 창 크기, 칸의 크기·구성, 막대의 크기가 바뀌면 다음 그리기 틀에서 한 번 다시 잰다.
import { useEffect, type RefObject } from "react";
import { cssPxOf, cssZoomOf } from "../../lib/zoom.ts";

/** 막대를 재는 표지(`end-panel.tsx`의 막대 `FloatingBar`) */
const END_BAR_SELECTOR = "[data-end-bar]";
/** 화면이 따로 고르지 않아도 늘 비키는 칸의 표지 */
const RAIL_AVOID_ATTR = "data-rail-avoid";
const UNDER_ATTR = "data-under-rail";
const CUT_VAR = "--rail-cut";
/** 칸과 막대 사이(CSS px). 막대가 창 끝에서 떨어진 거리(`end-3`)와 같다 */
export const RAIL_GAP = 12;

export interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/**
 * 칸 하나가 막대를 비킬 폭(화면 px). `item`은 비키기 전의 상자(오른쪽 끝은 이미 단 폭을 되돌린 값)다.
 * 세로로 막대 위아래 `gap` 안에 들고, 오른쪽 끝이 막대 왼쪽 끝 − `gap`을 넘을 때만 넘는 만큼을 돌려준다. 그 밖에는 0이다
 */
export function railCutOf(item: Box, bar: Box | null, gap: number): number {
  if (bar === null || bar.bottom <= bar.top || bar.right <= bar.left) return 0;
  if (item.bottom <= bar.top - gap || item.top >= bar.bottom + gap) return 0;
  const limit = bar.left - gap;
  if (item.right <= limit || item.left >= bar.right) return 0;
  return Math.ceil(item.right - limit);
}

function boxOf(rect: DOMRect): Box {
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
}

/**
 * `root` 안에서 `selector`(그리고 `[data-rail-avoid]`)에 드는 칸들이 막대와 겹치면 비키게 한다. 막대가 없는 화면에서는 아무것도 달지 않는다.
 * 비킨 폭은 바깥 여백이라 칸의 상자가 줄어든다. 그래서 다시 잴 때는 단 폭을 오른쪽 끝에 되돌려 처음 상자로 판단한다(줄였다 폈다 흔들리지 않게)
 */
export function useRailAvoid(root: RefObject<HTMLElement | null>, selector: string): void {
  useEffect(() => {
    const host = root.current;
    if (host === null) return undefined;
    const query = selector === "" ? `[${RAIL_AVOID_ATTR}]` : `${selector}, [${RAIL_AVOID_ATTR}]`;
    // 칸마다 지금 단 폭(화면 px)
    const applied = new Map<HTMLElement, number>();
    let frame = 0;
    // 단 폭이 칸의 높이를 바꾸면 아래 칸들의 자리도 바뀌므로 한 번 더 잰다. 바깥 일로 다시 재기 시작할 때마다 0으로 돌린다
    let again = 0;
    const clear = (el: HTMLElement): void => {
      el.removeAttribute(UNDER_ATTR);
      el.style.removeProperty(CUT_VAR);
      applied.delete(el);
    };
    const measure = (): void => {
      frame = 0;
      const barEl = document.querySelector(END_BAR_SELECTOR);
      const bar = barEl === null ? null : boxOf(barEl.getBoundingClientRect());
      const zoom = cssZoomOf(host);
      const items = new Set(host.querySelectorAll<HTMLElement>(query));
      for (const el of applied.keys()) {
        if (!items.has(el)) clear(el);
      }
      let changed = false;
      for (const el of items) {
        const before = applied.get(el) ?? 0;
        const rect = boxOf(el.getBoundingClientRect());
        const cut = railCutOf({ ...rect, right: rect.right + before }, bar, RAIL_GAP * zoom);
        if (cut === before) continue;
        changed = true;
        if (cut === 0) {
          clear(el);
          continue;
        }
        el.setAttribute(UNDER_ATTR, "");
        el.style.setProperty(CUT_VAR, `${String(cssPxOf(cut, zoom))}px`);
        applied.set(el, cut);
      }
      if (changed && again < 2) {
        again += 1;
        frame = requestAnimationFrame(measure);
      }
    };
    const schedule = (): void => {
      again = 0;
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    schedule();
    host.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    const sizes = new ResizeObserver(schedule);
    sizes.observe(host);
    const barEl = document.querySelector(END_BAR_SELECTOR);
    if (barEl !== null) sizes.observe(barEl);
    // 칸이 생기거나 바뀌면(항목 바꾸기, 펼치기, 결정 뒤 결과 판) 다시 잰다. 이 훅이 다는 속성은 듣지 않는다
    const changes = new MutationObserver(schedule);
    changes.observe(host, { childList: true, subtree: true, characterData: true });
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      host.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      sizes.disconnect();
      changes.disconnect();
      for (const el of applied.keys()) clear(el);
    };
  }, [root, selector]);
}
