// 지도의 확대·이동을 쥐는 훅. 값은 ref에 있고, 바뀔 때마다 컨테이너의 CSS 변수(--k --tx --ty --ls)만 쓴다.
// 휠·끌기·모으기 동안 React를 다시 그리지 않는다(퍼센트 표시만 정수가 바뀔 때 상태로 올린다).
// 수학은 모델의 순수 함수(viewport.ts)만 쓴다.
import {
  fitView,
  glideAt,
  labelScale,
  panBy,
  percent as percentOf,
  pinchDelta,
  wheelFactor,
  zoomAt,
  zoomSteps,
  type Insets,
  type Size,
  type View,
} from "@fresnel/client/workbench/canvas";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** 이름표가 옆으로 나오는 폭(화면 px). 맞춤 계산이 이 폭을 뺀다 */
const LABEL_PAD = 150;
/** 이 거리(px)를 넘게 움직여야 끌기로 본다. 그 아래는 누르기다 */
const PAN_SLOP = 5;

export interface ViewportApi {
  /** 지금 시점. 배경과 중심 구체가 매 프레임 읽는다 */
  readonly view: RefObject<View>;
  /** 화면에 보이는 배율(%) */
  readonly percent: number;
  /** 끌고 있는 중인가 */
  readonly panning: boolean;
  /** 확대 막대의 단계 확대·축소 */
  readonly zoomBy: (direction: "in" | "out") => void;
  /** 전체 보기(맞춤). 이 뒤에는 패널이 바뀌어도 다시 맞춘다 */
  readonly fit: () => void;
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function sameView(a: View, b: View): boolean {
  return a.k === b.k && a.x === b.x && a.y === b.y;
}

/**
 * 지도 시점. `box`는 지도 컨테이너이고, `size`와 `insets`는 지도가 놓인 칸과 떠 있는 패널이 차지한 여백이다.
 * 직접 만지지 않았다면 여백이 바뀔 때(패널이 열리고 닫힐 때, 창 크기) 맞춤을 다시 한다.
 */
export function useViewport(
  box: RefObject<HTMLElement | null>,
  size: Size,
  insets: Insets,
): ViewportApi {
  const view = useRef<View>({ k: 1, x: 0, y: 0 });
  const touched = useRef(false);
  const placed = useRef(false);
  const raf = useRef(0);
  const shownPercent = useRef(100);
  const [percent, setPercent] = useState(100);
  const [panning, setPanning] = useState(false);

  // 여백과 크기는 값으로 쓴다: 객체 주소가 매 렌더 바뀌어도 효과가 다시 돌지 않게
  const { w, h } = size;
  const { top, right, bottom, left } = insets;

  const write = useCallback(() => {
    const el = box.current;
    const v = view.current;
    if (el !== null) {
      el.style.setProperty("--k", String(v.k));
      el.style.setProperty("--tx", `${v.x}px`);
      el.style.setProperty("--ty", `${v.y}px`);
      el.style.setProperty("--ls", String(labelScale(v.k)));
    }
    const pct = percentOf(v.k);
    if (pct !== shownPercent.current) {
      shownPercent.current = pct;
      setPercent(pct);
    }
  }, [box]);

  const stop = useCallback(() => {
    if (raf.current !== 0) cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  /** to까지 가는 애니메이션. 움직임 줄이기에서는 한 번에 간다 */
  const glideTo = useCallback(
    (to: View, instant: boolean) => {
      stop();
      if (instant || reducedMotion()) {
        view.current = to;
        write();
        return;
      }
      const from = view.current;
      const t0 = performance.now();
      const step = (now: number): void => {
        const next = glideAt(from, to, now - t0);
        view.current = next;
        write();
        raf.current = sameView(next, to) ? 0 : requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    },
    [stop, write],
  );

  const fit = useCallback(() => {
    touched.current = false;
    glideTo(fitView({ w, h }, { top, right, bottom, left }, LABEL_PAD), false);
  }, [glideTo, w, h, top, right, bottom, left]);

  const zoomBy = useCallback(
    (direction: "in" | "out") => {
      touched.current = true;
      glideTo(zoomSteps(view.current, direction, { w, h }, { top, right, bottom, left }), false);
    },
    [glideTo, w, h, top, right, bottom, left],
  );

  // 여백이 바뀌면 맞춤을 다시 한다. 처음 놓을 때는 기다리지 않는다.
  useLayoutEffect(() => {
    if (w === 0 || h === 0 || touched.current) return;
    glideTo(fitView({ w, h }, { top, right, bottom, left }, LABEL_PAD), !placed.current);
    placed.current = true;
  }, [glideTo, w, h, top, right, bottom, left]);

  useEffect(() => {
    const el = box.current;
    if (el === null) return undefined;

    const pts = new Map<number, { readonly x: number; readonly y: number }>();
    let drag: { readonly x: number; readonly y: number; readonly start: View } | null = null;
    let pinch = 0;
    let moved = false;
    // 끌고 난 직후의 click은 누르기로 세지 않는다(끌기 뒤 버튼이 눌리는 것을 막는다)
    let suppressClick = false;

    const local = (e: { readonly clientX: number; readonly clientY: number }) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      touched.current = true;
      stop();
      view.current = zoomAt(view.current, wheelFactor(e.deltaY, e.ctrlKey), local(e));
      write();
    };

    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      pts.set(e.pointerId, local(e));
      if (pts.size === 1) {
        stop();
        drag = { x: e.clientX, y: e.clientY, start: view.current };
        moved = false;
      }
      const vals = [...pts.values()];
      const a = vals[0];
      const b = vals[1];
      if (pts.size === 2 && a !== undefined && b !== undefined) {
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };

    const onMove = (e: PointerEvent): void => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, local(e));
      const vals = [...pts.values()];
      const a = vals[0];
      const b = vals[1];
      if (vals.length >= 2 && a !== undefined && b !== undefined) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        touched.current = true;
        stop();
        view.current = zoomAt(view.current, pinchDelta(pinch, d), {
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
        });
        write();
        pinch = d;
        moved = true;
        return;
      }
      if (drag === null) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!moved) {
        if (Math.hypot(dx, dy) < PAN_SLOP) return;
        moved = true;
        touched.current = true;
        el.setPointerCapture(e.pointerId);
        setPanning(true);
      }
      view.current = panBy(drag.start, dx, dy);
      write();
    };

    const onUp = (e: PointerEvent): void => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      if (pts.size === 0) {
        if (moved) {
          suppressClick = true;
          window.setTimeout(() => {
            suppressClick = false;
          }, 0);
        }
        drag = null;
        moved = false;
        setPanning(false);
      }
    };

    const onClick = (e: MouseEvent): void => {
      if (!suppressClick) return;
      suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    // 캡처 단계에서 막아야 버튼의 클릭 처리기까지 닿지 않는다
    el.addEventListener("click", onClick, true);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("click", onClick, true);
      stop();
    };
  }, [box, stop, write]);

  return { view, percent, panning, zoomBy, fit };
}
