// 캔버스 그리기의 rAF 틱과 이벤트 연결. 언제 그릴지는 frame-policy의 shouldRender가 정하고, 여기는 틱과 리스너만 맡는다.
import { shouldRender, type ActivityMode, type FrameInput } from "@fresnel/client/workbench/canvas";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

/** 한 장 그리기. still이면 움직임 줄이기 상태라 시간을 멈춘 한 장이다. */
export type FrameDraw = (now: number, still: boolean) => void;

export interface FrameLoopOptions {
  /** 문맥 상실·되살림 이벤트를 듣는 캔버스 */
  readonly canvas: RefObject<HTMLCanvasElement | null>;
  /** 가만히 있을 때 상한: idle은 30fps(배경), active는 60fps(구체) */
  readonly mode: ActivityMode;
  /** GL 자원이 살아 있을 때만 true. false면 루프를 세운다(CSS 대체 중에도 되살림 이벤트는 듣는다) */
  readonly enabled: boolean;
  /** 문맥이 돌아오면 프로그램과 버퍼를 다시 짠다 */
  readonly onRestored: () => void;
  /** 이 값이 바뀌면 다음 틱에 바로 그린다(움직이는 중에만 효과가 있다: 움직임 줄이기는 루프가 멈춘다) */
  readonly watch?: () => string;
  /** 그림을 바꾸는 입력(색 판, 에너지 목표). 바뀌면 움직임 줄이기에서도 한 장을 다시 그린다 */
  readonly paint?: string;
}

export interface FrameLoop {
  readonly reducedMotion: boolean;
  readonly contextLost: boolean;
  /** 한 장을 다시 그린다(캔버스 크기가 바뀔 때). 크기를 바꾸면 그림이 지워지므로 부른다 */
  readonly redraw: () => void;
}

interface LoopState {
  raf: number;
  last: number;
  drawnOnce: boolean;
  lost: boolean;
  reduced: boolean;
  watched: string | undefined;
}

function readReducedMotion(): boolean {
  return window.matchMedia(REDUCE_QUERY).matches;
}

export function useFrameLoop(draw: FrameDraw, opts: FrameLoopOptions): FrameLoop {
  const [reducedMotion, setReducedMotion] = useState<boolean>(readReducedMotion);
  const [contextLost, setContextLost] = useState(false);
  // 틱과 리스너는 최신 값을 ref로 읽는다: 프레임마다 React를 다시 그리지 않는다
  const latest = useRef({ draw, opts });
  const loop = useRef<LoopState>({
    raf: 0,
    last: Number.NEGATIVE_INFINITY,
    drawnOnce: false,
    lost: false,
    reduced: false,
    watched: undefined,
  });
  const paintRef = useRef(opts.paint);

  const st = loop.current;
  const running = (): boolean => latest.current.opts.enabled && !st.lost && !document.hidden;
  const cancel = (): void => {
    if (st.raf !== 0) cancelAnimationFrame(st.raf);
    st.raf = 0;
  };
  const schedule = (): void => {
    if (st.raf !== 0 || !running()) return;
    // 움직임 줄이기: 한 장을 그리면 더 돌지 않는다
    if (st.reduced && st.drawnOnce) return;
    st.raf = requestAnimationFrame(tick);
  };
  const kick = (): void => {
    if (running()) schedule();
    else cancel();
  };
  // 매 렌더 뒤에 최신 값을 싣고, 그림을 바꾸는 입력이 바뀌었으면 한 장을 다시 그린다(움직임 줄이기도 포함)
  useLayoutEffect(() => {
    latest.current = { draw, opts };
    if (opts.paint !== paintRef.current) {
      paintRef.current = opts.paint;
      st.drawnOnce = false;
      kick();
    }
  });
  const tick = (now: number): void => {
    st.raf = 0;
    const cur = latest.current;
    const key = cur.opts.watch?.();
    if (key !== undefined && key !== st.watched) {
      st.watched = key;
      st.drawnOnce = false;
    }
    const input: FrameInput = {
      now,
      last: st.last,
      mode: cur.opts.mode,
      hidden: document.hidden,
      reducedMotion: st.reduced,
      contextLost: st.lost,
      drawnOnce: st.drawnOnce,
    };
    if (shouldRender(input)) {
      st.last = now;
      st.drawnOnce = true;
      cur.draw(now, st.reduced);
    }
    schedule();
  };

  // 마운트 한 번: 움직임 줄이기, 탭 가림, 문맥 상실·되살림 리스너를 건다
  useEffect(() => {
    const mq = window.matchMedia(REDUCE_QUERY);
    const canvas = latest.current.opts.canvas.current;
    st.reduced = mq.matches;
    setReducedMotion(mq.matches);
    const onMotion = (): void => {
      st.reduced = mq.matches;
      setReducedMotion(mq.matches);
      st.drawnOnce = false;
      kick();
    };
    const onVisibility = (): void => {
      if (document.hidden) cancel();
      else schedule();
    };
    const onLost = (e: Event): void => {
      // 복구를 허용하려면 기본 동작을 막아야 한다. 그리기는 멈추고 CSS 대체가 보인다.
      e.preventDefault();
      st.lost = true;
      cancel();
      setContextLost(true);
    };
    const onRestored = (): void => {
      st.lost = false;
      st.drawnOnce = false;
      latest.current.opts.onRestored();
      setContextLost(false);
      kick();
    };
    mq.addEventListener("change", onMotion);
    document.addEventListener("visibilitychange", onVisibility);
    canvas?.addEventListener("webglcontextlost", onLost);
    canvas?.addEventListener("webglcontextrestored", onRestored);
    kick();
    return () => {
      cancel();
      mq.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas?.removeEventListener("webglcontextlost", onLost);
      canvas?.removeEventListener("webglcontextrestored", onRestored);
    };
    // 리스너는 마운트 때 한 번만 건다. 나머지 값은 ref로 읽는다(의존 목록을 비운 이유).
  }, []);

  // GL 자원이 생기거나 없어질 때 루프를 켜거나 끈다
  const enabled = opts.enabled;
  useEffect(() => {
    kick();
  }, [enabled]);

  const redraw = useCallback((): void => {
    loop.current.drawnOnce = false;
    kick();
  }, []);

  return { reducedMotion, contextLost, redraw };
}
