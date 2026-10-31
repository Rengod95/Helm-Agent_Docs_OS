// 미니맵 + 줌 막대(오른쪽 아래, glass 한 덩어리). 줌은 caustic ZoomControl(variant ghost, FloatingBar 안 쓰임과 같다).
// caustic 빈틈 [gap:C-37 제안]: 미니맵(`CanvasMinimap`: 세계 축소판, 보이는 영역 사각형, 눌러 이동)이 없다.
import { IconButton, ZoomControl } from "@caustic/react";
import { Maximize } from "../../_shell";
import { BANDS, type BandId } from "../data";
import { clampK } from "./viewport";
import type { View } from "../store";

export interface MiniNode {
  id: string;
  band: BandId;
  x: number;
  y: number;
  w: number;
  h: number;
  on: boolean;
  tone?: "danger" | "warning";
}

export function MinimapBar({
  view,
  onView,
  nodes,
  world,
  box,
  onFit,
  showMap,
}: {
  view: View;
  onView: (v: View) => void;
  nodes: MiniNode[];
  world: { w: number; h: number };
  /** 캔버스 화면 크기. */
  box: { w: number; h: number };
  onFit: () => void;
  showMap: boolean;
}) {
  const MW = 160;
  const s = MW / world.w;
  const MH = world.h * s;
  const vr = {
    x: (-view.x / view.k) * s,
    y: (-view.y / view.k) * s,
    w: (box.w / view.k) * s,
    h: (box.h / view.k) * s,
  };
  const zoomBy = (f: number) => {
    const k = clampK(view.k * f);
    const cx = box.w / 2;
    const cy = box.h / 2;
    onView({ k, x: cx - ((cx - view.x) / view.k) * k, y: cy - ((cy - view.y) / view.k) * k });
  };
  return (
    <div className="glass absolute right-2 bottom-2 z-10 grid gap-1 rounded-toolbar p-1 glass-shadow-3">
      {showMap && (
        <div
          role="button"
          tabIndex={0}
          aria-label="미니맵, 눌러서 그곳으로 이동"
          className="relative cursor-pointer overflow-hidden rounded-[10px] bg-surface-base/60 outline-none focus-visible:shadow-focus"
          style={{ width: MW, height: MH }}
          onPointerDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const wx = (e.clientX - r.left) / s;
            const wy = (e.clientY - r.top) / s;
            onView({ ...view, x: box.w / 2 - wx * view.k, y: box.h / 2 - wy * view.k });
          }}
        >
          {BANDS.map((b) => (
            <div
              key={b.id}
              className="absolute inset-x-0 bg-neutral-soft"
              style={{ top: b.y * s, height: b.h * s }}
            />
          ))}
          {nodes.map((n) => (
            <div
              key={n.id}
              className={`absolute rounded-[1px] ${n.tone === "danger" ? "bg-danger-graphic" : n.tone === "warning" ? "bg-warning-graphic" : n.on ? "bg-text-tertiary" : "bg-border-strong"}`}
              style={{
                left: n.x * s,
                top: n.y * s,
                width: Math.max(2, n.w * s),
                height: Math.max(2, n.h * s),
              }}
            />
          ))}
          <div
            className="absolute rounded-[2px] shadow-[0_0_0_1.5px_var(--cs-color-canvas-selection)]"
            style={{ left: vr.x, top: vr.y, width: vr.w, height: vr.h }}
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-1">
        <ZoomControl
          variant="ghost"
          size="sm"
          readout="static"
          value={`${Math.round(view.k * 100)}%`}
          label="확대·축소"
          zoomOutLabel="축소"
          zoomInLabel="확대"
          onZoomOut={() => zoomBy(1 / 1.2)}
          onZoomIn={() => zoomBy(1.2)}
        />
        <IconButton size="sm" variant="ghost" label="전체 보기" onClick={onFit}>
          <Maximize />
        </IconButton>
      </div>
    </div>
  );
}
