// cv6 배율 칸과 배치(cvZoom, AGE-31). 배율이 배치 눈금 칸(`lod.ts`의 stepOf)을 넘으면 판 높이와 판 사이가 그 칸의 값으로 바뀐다.
// 바뀌는 동안(180ms, 움직임 줄이기면 바로) 두 칸의 값을 섞어 프레임마다 배치를 다시 잡으므로 판, 선, 묶음 테두리가 함께 부드럽게 간다.
// 포인터(없으면 화면 가운데)에서 가장 가까운 판은 화면에서 제자리에 남는다: 시점을 옮기지 않고 배치 전체를 그만큼 밀어(`offset`)
// React Flow의 확대 동작과 다투지 않는다. 시점을 프로그램으로 옮기는 동안(`fly`)과 처음 맞춤(`autoFit`) 동안에는 붙들지 않고
// 경계의 늦춤도 쓰지 않는다(가는 곳을 그 배율의 배치로 미리 계산하므로).
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useReactFlow, useViewportStore } from "@xyflow/react";
import {
  holdAt,
  holdPoint,
  layoutProfile,
  type Hold,
  type Point,
  type ProfileLayout,
} from "./layout.ts";
import { metricsOf, mixMetrics, stepOf, type StepMetrics } from "./lod.ts";
import type { CanvasProfile } from "./model.ts";

/** 칸이 바뀔 때 높이가 옮겨 가는 시간 */
const STEP_GLIDE_MS = 180;

/** 처음은 빠르고 끝은 천천히(ease-out cubic) */
function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

export interface StepView {
  /** 지금 그리는 배치(밀기 전 좌표) */
  readonly layout: ProfileLayout;
  /** 배치를 화면 좌표(React Flow 좌표)로 미는 값. 노드 자리와 시점 계산에 더한다 */
  readonly offset: Point;
  readonly metrics: StepMetrics;
  /** 다른 모양이나 배율에서의 배치(시점을 옮길 곳을 그 배율로 미리 잴 때) */
  readonly layoutAt: (
    profile: CanvasProfile,
    collapsed: ReadonlySet<string>,
    zoom: number,
  ) => ProfileLayout;
  /** 시점을 프로그램으로 옮긴다고 알린다(그동안 붙들지 않는다) */
  readonly fly: (ms: number) => void;
}

interface Shown {
  readonly metrics: StepMetrics;
  readonly offset: Point;
}

export function useStepLayout(
  profile: CanvasProfile,
  collapsed: ReadonlySet<string>,
  opts: {
    readonly wrapRef: RefObject<HTMLDivElement | null>;
    readonly autoFit: RefObject<boolean>;
    readonly reduced: boolean;
  },
): StepView {
  const { wrapRef, autoFit, reduced } = opts;
  const rf = useReactFlow();
  const zoom = useViewportStore((s) => s.transform[2]);
  const [shown, setShown] = useState<Shown>(() => ({
    metrics: metricsOf(stepOf(zoom, null)),
    offset: { x: 0, y: 0 },
  }));
  const step = useRef(stepOf(zoom, null));
  const latest = useRef({ profile, collapsed, shown });
  useLayoutEffect(() => {
    latest.current = { profile, collapsed, shown };
  }, [profile, collapsed, shown]);
  const hold = useRef<Hold | null>(null);
  const flyUntil = useRef(0);
  const frame = useRef(0);
  const pointer = useRef<Point | null>(null);

  // 포인터를 따라간다(휠과 집기 확대도 포인터 자리를 준다)
  useEffect(() => {
    const el = wrapRef.current;
    if (el === null) return undefined;
    const at = (e: PointerEvent | WheelEvent): void => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    const away = (): void => {
      pointer.current = null;
    };
    el.addEventListener("pointermove", at, { passive: true });
    el.addEventListener("wheel", at, { capture: true, passive: true });
    el.addEventListener("pointerleave", away);
    return () => {
      el.removeEventListener("pointermove", at);
      el.removeEventListener("wheel", at, { capture: true });
      el.removeEventListener("pointerleave", away);
    };
  }, [wrapRef]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /** 값 하나를 그린다. 붙든 판이 있으면 그 판의 자리가 바뀐 만큼 배치를 거꾸로 민다 */
  const apply = useCallback((next: StepMetrics): void => {
    const { profile: p, collapsed: c, shown: before } = latest.current;
    const h = hold.current;
    let dx = 0;
    let dy = 0;
    if (h !== null) {
      const a = holdPoint(layoutProfile(p, c, before.metrics), h);
      const b = holdPoint(layoutProfile(p, c, next), h);
      if (a !== null && b !== null) {
        dx = a.x - b.x;
        dy = a.y - b.y;
      }
    }
    const value: Shown = {
      metrics: next,
      offset: { x: before.offset.x + dx, y: before.offset.y + dy },
    };
    latest.current = { ...latest.current, shown: value };
    setShown(value);
  }, []);

  /** 포인터(캔버스 밖이면 화면 가운데)에서 가장 가까운 판을 붙든다 */
  const capture = useCallback((): Hold | null => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return null;
    const p = pointer.current;
    const inside =
      p !== null && p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;
    const focus = inside ? p : { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const flow = rf.screenToFlowPosition(focus, { snapToGrid: false });
    const { profile: pr, collapsed: c, shown: s } = latest.current;
    return holdAt(layoutProfile(pr, c, s.metrics), {
      x: flow.x - s.offset.x,
      y: flow.y - s.offset.y,
    });
  }, [rf, wrapRef]);

  useLayoutEffect(() => {
    const free = autoFit.current || performance.now() < flyUntil.current;
    const next = stepOf(zoom, free ? null : step.current);
    if (next === step.current) return;
    step.current = next;
    hold.current = free ? null : capture();
    cancelAnimationFrame(frame.current);
    const target = metricsOf(next);
    if (reduced || autoFit.current) {
      apply(target);
      return;
    }
    const from = latest.current.shown.metrics;
    const t0 = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - t0) / STEP_GLIDE_MS);
      apply(t >= 1 ? target : mixMetrics(from, target, easeOut(t)));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [zoom, reduced, autoFit, capture, apply]);

  const layout = useMemo(
    () => layoutProfile(profile, collapsed, shown.metrics),
    [profile, collapsed, shown.metrics],
  );
  const layoutAt = useCallback(
    (p: CanvasProfile, c: ReadonlySet<string>, z: number): ProfileLayout =>
      layoutProfile(p, c, metricsOf(stepOf(z, null))),
    [],
  );
  const fly = useCallback((ms: number): void => {
    flyUntil.current = performance.now() + ms + 60;
  }, []);
  return { layout, offset: shown.offset, metrics: shown.metrics, layoutAt, fly };
}
