// 판의 시점(옮기기·확대). 처음과 크기가 바뀔 때 내용을 맞추고, 사용자가 옮기거나 확대하면 그 뒤로는 맞추지 않는다.
// 끌기·휠은 바로 따라간다(움직임 없음). 맞추기 단추만 짧게 옮겨 가고, 움직임 줄이기면 바로 간다.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Pt } from "./layout.ts";

export interface View {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

export interface Bounds {
  readonly min: Pt;
  readonly max: Pt;
}

const MIN_K = 0.35;
const MAX_K = 2.2;

function fitView(b: Bounds, w: number, h: number, pad: number, maxK: number): View {
  // 아래는 떠 있는 도구 막대 자리만큼 더 비운다
  // 오른쪽은 앱의 떠 있는 막대 자리만큼 더 비운다
  const bottom = pad + 44;
  const right = pad + 40;
  const bw = b.max.x - b.min.x;
  const bh = b.max.y - b.min.y;
  const k = Math.max(MIN_K, Math.min(maxK, (w - pad - right) / bw, (h - pad - bottom) / bh));
  const cx = (b.min.x + b.max.x) / 2;
  const cy = (b.min.y + b.max.y) / 2;
  return { x: (w - right + pad) / 2 - cx * k, y: (h - bottom + pad) / 2 - cy * k, k };
}

function clampK(k: number): number {
  return Math.max(MIN_K, Math.min(MAX_K, k));
}

export interface Viewport {
  readonly view: View;
  readonly size: Pt;
  readonly setView: (v: View) => void;
  readonly fit: () => void;
  readonly zoomBy: (factor: number, at?: Pt) => void;
  /** 화면 좌표(요소 기준) → 세계 좌표 */
  readonly toWorld: (p: Pt) => Pt;
  /** 사용자가 시점을 만졌다(이후 자동 맞추기 없음) */
  readonly touch: () => void;
}

/** `scene`이 바뀌면(다른 프로필·다른 플러그인) 사용자가 옮긴 시점을 버리고 다시 맞춘다 */
export function useViewport(
  el: RefObject<HTMLElement | null>,
  bounds: Bounds,
  maxK: number,
  scene: string,
): Viewport {
  const [view, setViewState] = useState<View>({ x: 0, y: 0, k: 1 });
  const [size, setSize] = useState<Pt>({ x: 0, y: 0 });
  const auto = useRef(true);
  const viewRef = useRef(view);
  viewRef.current = view;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  useEffect(() => {
    const node = el.current;
    if (node === null) return undefined;
    const measure = (): void => {
      const r = node.getBoundingClientRect();
      setSize((s) => (s.x === r.width && s.y === r.height ? s : { x: r.width, y: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => {
      ro.disconnect();
    };
  }, [el]);

  const key = `${String(bounds.min.x)},${String(bounds.min.y)},${String(bounds.max.x)},${String(bounds.max.y)}`;
  useEffect(() => {
    auto.current = true;
  }, [scene]);

  useEffect(() => {
    if (!auto.current || size.x === 0) return;
    setViewState(fitView(boundsRef.current, size.x, size.y, 36, maxK));
  }, [size, key, maxK, scene]);

  const setView = useCallback((v: View) => {
    setViewState(v);
  }, []);
  const touch = useCallback(() => {
    auto.current = false;
  }, []);
  const fit = useCallback(() => {
    auto.current = true;
    if (size.x > 0) setViewState(fitView(boundsRef.current, size.x, size.y, 36, maxK));
  }, [size, maxK]);
  const zoomBy = useCallback(
    (factor: number, at?: Pt) => {
      auto.current = false;
      const v = viewRef.current;
      const p = at ?? { x: size.x / 2, y: size.y / 2 };
      const k = clampK(v.k * factor);
      const wx = (p.x - v.x) / v.k;
      const wy = (p.y - v.y) / v.k;
      setViewState({ k, x: p.x - wx * k, y: p.y - wy * k });
    },
    [size],
  );
  const toWorld = useCallback((p: Pt): Pt => {
    const v = viewRef.current;
    return { x: (p.x - v.x) / v.k, y: (p.y - v.y) / v.k };
  }, []);
  return { view, size, setView, fit, zoomBy, toWorld, touch };
}
