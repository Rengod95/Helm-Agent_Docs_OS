// 지도의 확대·이동. 세계 좌표(1000×1000, 가운데 500,500)를 화면으로 옮기는 값 하나(k, x, y)를 들고,
// 바뀔 때마다 CSS 변수(--k --tx --ty --ls)만 쓴다: 끌거나 굴리는 동안 React를 다시 그리지 않는다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export const WORLD = 1000;
export const CENTER = WORLD / 2;
/** 가장 바깥 호의 반지름(세계 좌표) */
export const OUTER = 460;
export const MIN_K = 0.3;
export const MAX_K = 3.2;
/** 이름표 옆으로 나오는 폭(화면 px): 맞춤 계산에 더한다 */
const LABEL_PAD = 150;

export interface View {
  k: number;
  x: number;
  y: number;
}
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export interface ViewportApi {
  /** 지금 값(읽기 전용으로 쓴다: 배경 셰이더가 매 프레임 읽는다) */
  view: RefObject<View>;
  zoomBy: (factor: number) => void;
  fit: () => void;
  /** 화면에 보이는 배율(%) */
  percent: number;
  /** 눌러 끌던 중인가 */
  panning: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** 이름표 글자 배율: 확대하면 조금 커지고 축소하면 조금 작아지되 읽을 수 있는 범위에 둔다 */
export const labelScale = (k: number): number => clamp(k ** 0.5, 0.9, 1.3);
export const reducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useViewport(
  box: RefObject<HTMLElement | null>,
  size: { w: number; h: number },
  insets: Insets,
): ViewportApi {
  const view = useRef<View>({ k: 1, x: 0, y: 0 });
  const manual = useRef(false);
  const raf = useRef(0);
  const placed = useRef(false);
  const [percent, setPercent] = useState(100);
  const [panning, setPanning] = useState(false);
  const shown = useRef(100);

  const write = useCallback(() => {
    const el = box.current;
    if (el === null) return;
    const v = view.current;
    el.style.setProperty("--k", String(v.k));
    el.style.setProperty("--tx", `${v.x}px`);
    el.style.setProperty("--ty", `${v.y}px`);
    el.style.setProperty("--ls", String(labelScale(v.k)));
    const pct = Math.round(v.k * 100);
    if (pct !== shown.current) {
      shown.current = pct;
      setPercent(pct);
    }
  }, [box]);

  const cancel = useCallback(() => {
    if (raf.current !== 0) cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  const glide = useCallback(
    (to: View, instant: boolean) => {
      cancel();
      if (instant || reducedMotion()) {
        view.current = to;
        write();
        return;
      }
      const from = { ...view.current };
      const t0 = performance.now();
      const dur = 420;
      const step = (now: number): void => {
        const t = Math.min(1, (now - t0) / dur);
        const e = 1 - (1 - t) ** 3;
        view.current = {
          k: from.k + (to.k - from.k) * e,
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e,
        };
        write();
        raf.current = t < 1 ? requestAnimationFrame(step) : 0;
      };
      raf.current = requestAnimationFrame(step);
    },
    [cancel, write],
  );

  const target = useCallback((): View => {
    const l = insets.left;
    const t = insets.top;
    const w = size.w - insets.left - insets.right;
    const h = size.h - insets.top - insets.bottom;
    const k = clamp(
      Math.min((w - 2 * LABEL_PAD) / (2 * OUTER), (h - 24) / (2 * OUTER)),
      MIN_K,
      1.4,
    );
    return { k, x: l + w / 2 - CENTER * k, y: t + h / 2 - CENTER * k };
  }, [insets.left, insets.right, insets.top, insets.bottom, size.w, size.h]);

  const fit = useCallback(() => {
    manual.current = false;
    glide(target(), false);
  }, [glide, target]);

  // 직접 만지지 않았다면 놓인 영역이 바뀔 때(패널이 열리고 닫힐 때, 창 크기) 맞춤을 다시 한다.
  useLayoutEffect(() => {
    if (size.w === 0 || size.h === 0 || manual.current) return;
    glide(target(), !placed.current);
    placed.current = true;
  }, [size.w, size.h, target, glide]);

  const zoomAt = useCallback(
    (px: number, py: number, factor: number) => {
      const v = view.current;
      const k = clamp(v.k * factor, MIN_K, MAX_K);
      const f = k / v.k;
      manual.current = true;
      cancel();
      view.current = { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
      write();
    },
    [cancel, write],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const v = view.current;
      const k = clamp(v.k * factor, MIN_K, MAX_K);
      const cx = insets.left + (size.w - insets.left - insets.right) / 2;
      const cy = insets.top + (size.h - insets.top - insets.bottom) / 2;
      const f = k / v.k;
      manual.current = true;
      glide({ k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f }, false);
    },
    [glide, insets.left, insets.right, insets.top, insets.bottom, size.w, size.h],
  );

  useEffect(() => {
    const el = box.current;
    if (el === null) return undefined;
    const pts = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number; vx: number; vy: number } | null = null;
    let pinch = 0;
    let moved = false;
    const rel = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onWheel = (e: WheelEvent): void => {
      // 두 손가락 모으기(ctrl+휠)는 민감하게, 보통 휠은 부드럽게
      e.preventDefault();
      const p = rel(e);
      const rate = e.ctrlKey ? 0.012 : 0.0016;
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * rate));
    };
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      pts.set(e.pointerId, rel(e));
      if (pts.size === 1) {
        const v = view.current;
        start = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y };
        moved = false;
      }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        if (a !== undefined && b !== undefined) pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const onMove = (e: PointerEvent): void => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, rel(e));
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        if (a === undefined || b === undefined) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch);
        pinch = d;
        moved = true;
        return;
      }
      if (start === null) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      if (!moved) {
        moved = true;
        manual.current = true;
        cancel();
        el.setPointerCapture(e.pointerId);
        setPanning(true);
      }
      view.current = { ...view.current, x: start.vx + dx, y: start.vy + dy };
      write();
    };
    const onUp = (e: PointerEvent): void => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      if (pts.size === 0) {
        if (moved) {
          panGuard.current = true;
          window.setTimeout(() => {
            panGuard.current = false;
          }, 0);
        }
        start = null;
        moved = false;
        setPanning(false);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      cancel();
    };
  }, [box, zoomAt, write, cancel]);

  return { view, zoomBy, fit, percent, panning };
}

/** 끌고 난 직후의 click은 빈 곳 누르기로 세지 않는다 */
export const panGuard = { current: false };

/** 요소에 CSS 변수를 심는 ref 콜백: style 속성에 사용자 정의 속성을 쓰지 않고도 값을 넘긴다 */
export const setVars =
  (vars: Record<string, string | number>) =>
  (el: HTMLElement | SVGElement | null): void => {
    if (el === null) return;
    for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, String(v));
  };

/** 지도 점 이름표와 순서 칩이 같은 플러그인을 가리킬 때 보기 전환에서 서로를 따라가도록 붙이는 이름 */
export const vtName = (id: string): string => `vt-${id.replace(/[^a-zA-Z0-9]/g, "_")}`;
