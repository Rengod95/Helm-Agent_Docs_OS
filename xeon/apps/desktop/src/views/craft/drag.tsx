// 한 훅 줄 안의 끌어 놓기. 자리는 같은 줄 안에서만 바뀐다(훅 사이 이동은 없다, 결정 15-2).
// 포인터로 직접 구현한다: 놓을 자리는 줄의 칩 상자들로 `dropIndex`가 정한다. 키보드는 strata-flow의 keyReorder가 맡는다.
import { dropIndex, type ChipBox } from "@fresnel/client/workbench/canvas";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

/** 이만큼 움직여야 끌기로 본다. 그보다 적으면 그냥 누르기(고르기)다 */
const START_PX = 5;
/** 줄 위아래로 이만큼 벗어나도 줄 안으로 본다(칩 사이 틈을 놓치지 않게) */
const SLOP_PX = 12;

export interface RowDrag {
  /** 끌고 있는 칩의 id. 끌기가 없으면 null */
  readonly dragId: string | null;
  /** 놓을 자리: 끌고 있는 칩을 뺀 목록에서의 index. 줄 밖이면 null */
  readonly overIndex: number | null;
  /** 칩의 pointerdown에 건다 */
  readonly begin: (id: string, e: ReactPointerEvent<HTMLElement>) => void;
}

interface DragState {
  readonly id: string;
  readonly over: number | null;
}

/** 한 줄의 끌기 상태. onDrop은 놓였을 때 한 번 불린다(index는 끌린 칩을 뺀 자리) */
export function useRowDrag(onDrop: (id: string, index: number) => void): RowDrag {
  const [drag, setDrag] = useState<DragState | null>(null);
  // 끌기 도중 줄이 사라지면 창 리스너를 떼어 놓지 않는다
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      stopRef.current?.();
    };
  }, []);

  const begin = (id: string, e: ReactPointerEvent<HTMLElement>): void => {
    if (e.button !== 0) return;
    // 칩은 자기 줄(data-lane) 안에 있다. 줄은 끌기 동안 바뀌지 않으므로 시작할 때 한 번 찾는다
    const lane = e.currentTarget.closest<HTMLElement>("[data-lane]");
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;

    const stop = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      stopRef.current = null;
    };
    const onMove = (ev: PointerEvent): void => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < START_PX) return;
        started = true;
      }
      setDrag({ id, over: overAt(lane, id, ev.clientX, ev.clientY) });
    };
    const onUp = (ev: PointerEvent): void => {
      stop();
      if (!started) return;
      swallowClick();
      setDrag(null);
      const index = overAt(lane, id, ev.clientX, ev.clientY);
      if (index !== null) onDrop(id, index);
    };
    const onCancel = (): void => {
      stop();
      if (started) setDrag(null);
    };

    stopRef.current = stop;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  return {
    dragId: drag?.id ?? null,
    overIndex: drag?.over ?? null,
    begin,
  };
}

/** 줄 안에서 포인터가 놓일 자리. 줄 밖이면 null이다 */
function overAt(lane: HTMLElement | null, id: string, x: number, y: number): number | null {
  if (lane === null) return null;
  const box = lane.getBoundingClientRect();
  if (x < box.left || x > box.right || y < box.top - SLOP_PX || y > box.bottom + SLOP_PX)
    return null;
  const chips: ChipBox[] = [...lane.querySelectorAll<HTMLElement>("[data-chip]")].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      id: el.dataset["chip"] ?? "",
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
    };
  });
  return dropIndex(chips, id, x, y);
}

/**
 * 끌어 놓은 뒤 클릭이 따라오면 고르기로 새지 않게 한 번 삼킨다. 0ms 뒤에는 리스너를 뗀다
 * (끌지 않고 놓았으면 클릭이 안 오므로 그 리스너도 같이 사라진다).
 */
function swallowClick(): void {
  window.addEventListener("click", stopClick, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", stopClick, { capture: true }), 0);
}

function stopClick(c: MouseEvent): void {
  c.stopPropagation();
  c.preventDefault();
}

/** 놓일 자리를 보이는 세로 막대 */
export function DropBar(): ReactNode {
  return <span aria-hidden className="h-8 w-0.5 flex-none rounded-full bg-text-primary" />;
}
