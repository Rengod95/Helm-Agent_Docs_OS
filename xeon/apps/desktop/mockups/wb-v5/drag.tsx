// 끌어서 놓기. 줄의 칩은 같은 줄 안에서 순서를 바꾸고, 지도의 점은 순서 줄에 놓아 그 훅에 더한다.
// 포인터로 직접 구현한다: 놓을 자리는 [data-lane]과 그 안의 [data-chip]으로 찾는다.
import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useMock, type DragState, type Mock } from "./store";

interface Payload {
  id: string;
  from: string | null;
  label: string;
}

function hit(x: number, y: number, from: string | null, id: string): DragState["over"] {
  const el = document.elementFromPoint(x, y);
  const lane = el instanceof HTMLElement ? el.closest<HTMLElement>("[data-lane]") : null;
  const hook = lane?.dataset["lane"];
  if (lane === null || hook === undefined) return null;
  if (from !== null && from !== hook) return null;
  const chips = [...lane.querySelectorAll<HTMLElement>("[data-chip]")].filter((c) => c.dataset["chip"] !== id);
  let index = chips.length;
  for (let i = 0; i < chips.length; i += 1) {
    const r = chips[i]?.getBoundingClientRect();
    if (r === undefined) continue;
    if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) {
      index = i;
      break;
    }
  }
  return { hook, index };
}

/** 끌기를 시작하는 pointerdown 핸들러. 5px 안쪽은 그냥 누르기로 둔다(눌러 고르기가 그대로 동작). */
export function useDragSource(payload: Payload): (e: ReactPointerEvent<HTMLElement>) => void {
  const m = useMock();
  const latest = useRef<Mock>(m);
  latest.current = m;
  return (e) => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let started = false;
    const onMove = (ev: PointerEvent): void => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        started = true;
      }
      latest.current.setDrag({ ...payload, x: ev.clientX, y: ev.clientY, over: hit(ev.clientX, ev.clientY, payload.from, payload.id) });
    };
    const finish = (ev: PointerEvent, drop: boolean): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (!started) return;
      const stop = (c: MouseEvent): void => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener("click", stop, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
      const cur = latest.current;
      cur.setDrag(null);
      if (!drop) return;
      const over = hit(ev.clientX, ev.clientY, payload.from, payload.id);
      if (over === null) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        if (payload.from !== null && el instanceof HTMLElement && el.closest("[data-lane]") !== null) cur.notify("이 핸들러는 이 훅에만 걸려 있어요");
        return;
      }
      if (payload.from !== null) cur.move(payload.from, payload.id, over.index);
      else cur.addToLane(over.hook, payload.id);
    };
    const onUp = (ev: PointerEvent): void => finish(ev, true);
    const onCancel = (ev: PointerEvent): void => finish(ev, false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };
}

/** 끄는 동안 따라다니는 이름표 */
export function DragGhost() {
  const m = useMock();
  const d = m.drag;
  if (d === null) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-50 flex h-7 items-center rounded-full border border-text-primary bg-text-primary px-3 text-ui-sm text-surface-base shadow-3"
      style={{ left: d.x + 14, top: d.y + 10 }}
    >
      {d.label}
    </div>
  );
}
