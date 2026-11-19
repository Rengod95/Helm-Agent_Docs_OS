// cvC 캔버스의 이동·확대. 빈 바탕을 끌면 옮기고, 휠은 옮기고(트랙패드), ⌘/Ctrl+휠과 집기는 포인터 둘레로 확대한다.
// 앱 확대(`<html>` CSS zoom) 아래에서는 화면 px을 CSS px로 나눈다(lib/zoom.ts). 직접 조작이라 움직임을 넣지 않는다(PLAN-motion).
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { cssPxOf, cssZoomOf } from "../../../../lib/zoom.ts";
import type { View } from "./glow-grid.tsx";
import type { Rect } from "./model.ts";

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.8;

function clampK(k: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));
}

/** 세계 사각형을 화면(w×h)의 여백 안에 맞추는 시점. 1보다 크게 키우지 않는다 */
export function fitView(
  bounds: Rect,
  w: number,
  h: number,
  inset: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  },
): View {
  const aw = Math.max(1, w - inset.left - inset.right);
  const ah = Math.max(1, h - inset.top - inset.bottom);
  const k = clampK(Math.min(1, aw / bounds.w, ah / bounds.h));
  return {
    k,
    x: inset.left + (aw - bounds.w * k) / 2 - bounds.x * k,
    y: inset.top + (ah - bounds.h * k) / 2 - bounds.y * k,
  };
}

/** 점(px) 둘레로 배율을 f배 */
export function zoomAround(view: View, f: number, px: number, py: number): View {
  const k = clampK(view.k * f);
  const r = k / view.k;
  return { k, x: px - (px - view.x) * r, y: py - (py - view.y) * r };
}

export interface Surface {
  readonly view: View;
  readonly setView: (v: View) => void;
  /** 바탕에서 누르면 옮기기를 시작한다 */
  readonly onPanStart: (e: ReactPointerEvent<HTMLElement>) => void;
  readonly panning: boolean;
}

export function useSurface(ref: RefObject<HTMLElement | null>): Surface {
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [panning, setPanning] = useState(false);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // 휠: 확대는 ⌘/Ctrl(트랙패드 집기도 ctrlKey로 온다), 아니면 옮기기
  useEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const zoom = cssZoomOf(el);
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const px = cssPxOf(e.clientX - r.left, zoom);
        const py = cssPxOf(e.clientY - r.top, zoom);
        setView(zoomAround(v, Math.exp(-e.deltaY * 0.0045), px, py));
        return;
      }
      setView({ ...v, x: v.x - cssPxOf(e.deltaX, zoom), y: v.y - cssPxOf(e.deltaY, zoom) });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref]);

  const onPanStart = useCallback(
    (e: ReactPointerEvent<HTMLElement>): void => {
      if (e.button !== 0) return;
      const el = ref.current;
      if (el === null) return;
      const zoom = cssZoomOf(el);
      const start = { x: e.clientX, y: e.clientY, v: viewRef.current };
      setPanning(true);
      const move = (ev: PointerEvent): void => {
        setView({
          ...start.v,
          x: start.v.x + cssPxOf(ev.clientX - start.x, zoom),
          y: start.v.y + cssPxOf(ev.clientY - start.y, zoom),
        });
      };
      const up = (): void => {
        setPanning(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [ref],
  );

  return { view, setView, onPanStart, panning };
}
