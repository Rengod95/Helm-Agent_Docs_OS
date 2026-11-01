// 캔버스 호스트: 끌어서 이동, 휠로 이동(⌘·Ctrl 휠은 확대·축소), 점 격자 바탕. 세계 좌표 자식은 transform 한 겹 안에 그린다.
// caustic 빈틈 [gap:C-34 제안]: caustic canvas-* 부품은 오버레이(선택, 안내선, 자, 힌트)만 있고 이동·확대를 가진 캔버스 호스트가 없다.
// 디자인 도구 캔버스와 노드 그래프가 같이 쓸 수 있어 caustic `CanvasViewport`(view, onViewChange, minZoom, maxZoom, dot grid)로 제안한다.
import { useRef, type ReactNode, type PointerEvent, type WheelEvent } from "react";
import type { View } from "../store";

export interface ViewportProps {
  view: View;
  onView: (v: View) => void;
  /** 세계 좌표 내용(노드, 엣지, 띠). */
  world: ReactNode;
  /** 화면 좌표 덧그림(띠 이름, 줌, 미니맵, 재생 막대). */
  overlay?: ReactNode;
  /** 바탕을 눌렀을 때(고른 것 풀기). */
  onBackground?: () => void;
  dim?: boolean;
  label: string;
}

export const clampK = (k: number) => Math.min(1.6, Math.max(0.35, k));

export function Viewport({
  view,
  onView,
  world,
  overlay,
  onBackground,
  dim,
  label,
}: ViewportProps) {
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(
    null,
  );
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-node],button,[role=slider]") !== null) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d === null) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    onView({ ...view, x: d.vx + dx, y: d.vy + dy });
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d !== null && !d.moved) onBackground?.();
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      const r = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const k = clampK(view.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
      onView({ k, x: px - ((px - view.x) / view.k) * k, y: py - ((py - view.y) / view.k) * k });
    } else onView({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY });
  };
  const grid = 16 * view.k;
  return (
    <div
      role="application"
      aria-label={label}
      aria-roledescription="캔버스"
      className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
      style={{
        backgroundImage: "radial-gradient(var(--cs-color-canvas-dot) 1px, transparent 1.2px)",
        backgroundSize: `${grid}px ${grid}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onWheel={onWheel}
    >
      <div
        className={`absolute top-0 left-0 origin-top-left transition-opacity ${dim === true ? "opacity-55 saturate-0" : ""}`}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
        {world}
      </div>
      {overlay}
    </div>
  );
}
