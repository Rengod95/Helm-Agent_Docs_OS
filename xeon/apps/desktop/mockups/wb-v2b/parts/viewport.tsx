// 캔버스 호스트: 투명한 가운데 위 점 격자, 이동(끌기·휠)과 확대(⌘/Ctrl+휠, 줌 캡슐), 화면 좌표 덧그림 칸.
// 캔버스 안 떠 있는 것: 왼쪽 위 중첩 경로(그룹 안으로 들어간 깊이, DP-05의 창 머리 경로와 다름), 오른쪽 위 보기 바꾸기,
// 오른쪽 아래 미니맵 + 줌. [gap: C-34 CanvasViewport, C-37 CanvasMinimap]
import { ZoomControl } from "@caustic/react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as RPE,
  type WheelEvent as RWE,
} from "react";
import { ChevronRight } from "../../_shell";

export interface MiniRect {
  x: number;
  y: number;
  w: number;
  h: number;
  tone?: "base" | "strong" | "danger" | "lane" | "accent";
}

export interface ViewportProps {
  world: { w: number; h: number };
  children: ReactNode;
  crumbs: { label: string; onClick?: () => void; icon?: ReactNode }[];
  crumbMeta?: ReactNode;
  topRight?: ReactNode;
  overlay?: ReactNode;
  bottomLeft?: ReactNode;
  mini?: MiniRect[];
  /** 맞춤 여백(화면 px): 위, 오른쪽, 아래, 왼쪽. */
  pad?: [number, number, number, number];
  minK?: number;
  maxK?: number;
  /** 가로가 넘치면 왼쪽(start)에 붙일지 가운데(center)에 둘지. */
  anchor?: "start" | "center";
  onBackground?: () => void;
  label: string;
  alwaysMini?: boolean;
}

const MINI_W = 132;

export function Viewport({
  world,
  children,
  crumbs,
  crumbMeta,
  topRight,
  overlay,
  bottomLeft,
  mini,
  pad = [56, 24, 24, 24],
  minK = 0.8,
  maxK = 1.1,
  anchor = "center",
  onBackground,
  label,
  alwaysMini = false,
}: ViewportProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<{ k: number; x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(
    null,
  );

  const fit = useCallback(
    (b: { w: number; h: number }) => {
      const [pt, pr, pb, pl] = pad;
      const k = Math.min(
        maxK,
        Math.max(minK, Math.min((b.w - pl - pr) / world.w, (b.h - pt - pb) / world.h)),
      );
      const free = b.w - pl - pr - world.w * k;
      const x = pl + (free > 0 || anchor === "center" ? Math.max(free, 0) / 2 : 0);
      const freeY = b.h - pt - pb - world.h * k;
      const y = pt + Math.max(freeY, 0) / 2;
      return { k, x, y };
    },
    [pad, world.w, world.h, minK, maxK, anchor],
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
      setView(fit({ w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const v = view ?? { k: 1, x: 0, y: 0 };
  const zoomBy = (f: number, cx = box.w / 2, cy = box.h / 2) =>
    setView((o) => {
      const c = o ?? v;
      const k = Math.min(1.6, Math.max(0.4, c.k * f));
      return { k, x: cx - ((cx - c.x) * k) / c.k, y: cy - ((cy - c.y) * k) / c.k };
    });
  const onWheel = (e: RWE) => {
    const r = ref.current!.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey)
      zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08, e.clientX - r.left, e.clientY - r.top);
    else setView((o) => ({ ...(o ?? v), x: (o ?? v).x - e.deltaX, y: (o ?? v).y - e.deltaY }));
  };
  const onDown = (e: RPE) => {
    if ((e.target as HTMLElement).closest("[data-block],button,[role=button],a,input")) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPE) => {
    const d = drag.current;
    if (d === null) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setView({ k: v.k, x: d.vx + dx, y: d.vy + dy });
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d !== null && !d.moved) onBackground?.();
  };

  const mk = MINI_W / world.w;
  const mh = world.h * mk;
  // 미니맵은 내용이 화면을 넘칠 때만(다 보이면 줌 캡슐만).
  const overflow =
    v.x < 0 || v.y < 0 || v.x + world.w * v.k > box.w || v.y + world.h * v.k > box.h - 8;
  const showMini = mini !== undefined && box.w > 480 && (overflow || alwaysMini);

  return (
    <div
      ref={ref}
      role="application"
      aria-roledescription="캔버스"
      aria-label={label}
      className="v2b-grid relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden select-none"
      onWheel={onWheel}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: world.w,
          height: world.h,
          transform: `translate(${v.x}px, ${v.y}px) scale(${v.k})`,
          visibility: view === null ? "hidden" : "visible",
        }}
      >
        {children}
      </div>

      {/* 중첩 경로: 캔버스 안 왼쪽 위(그룹 깊이). 창 머리 경로가 아니다(DP-05). */}
      <nav
        aria-label="캔버스 깊이"
        className="glass glass-shadow-2 absolute top-3 left-3 z-10 flex h-8 max-w-[60%] items-center gap-0.5 rounded-lg px-1.5"
      >
        {crumbs.map((c, i) => (
          <span key={c.label} className="flex min-w-0 items-center gap-0.5">
            {i > 0 && (
              <ChevronRight emphasis="muted" className="size-3.5 flex-none text-text-tertiary" />
            )}
            {c.onClick !== undefined && i < crumbs.length - 1 ? (
              <button
                type="button"
                onClick={c.onClick}
                className="flex h-6 items-center gap-1.5 truncate rounded-md px-1.5 text-ui-sm text-text-secondary hover:bg-fill-hover focus-visible:shadow-focus focus-visible:outline-none"
              >
                {c.icon}
                {c.label}
              </button>
            ) : (
              <span className="flex h-6 items-center gap-1.5 truncate px-1.5 text-ui-sm text-text-primary">
                {c.icon}
                {c.label}
              </span>
            )}
          </span>
        ))}
        {crumbMeta !== undefined && (
          <span className="ms-1 truncate pe-1.5 text-ui-xs text-text-tertiary">{crumbMeta}</span>
        )}
      </nav>

      {topRight !== undefined && (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">{topRight}</div>
      )}
      {overlay}
      {bottomLeft !== undefined && (
        <div className="absolute bottom-3 left-3 z-10">{bottomLeft}</div>
      )}

      <div className="absolute right-3 bottom-3 z-10 flex flex-col items-end gap-1.5">
        {showMini && (
          <div className="glass glass-shadow-2 rounded-lg p-1.5" aria-hidden>
            <svg width={MINI_W} height={mh} className="block">
              {mini!.map((r, i) => (
                <rect
                  key={i}
                  x={r.x * mk}
                  y={r.y * mk}
                  width={Math.max(1.5, r.w * mk)}
                  height={Math.max(1.5, r.h * mk)}
                  rx={r.tone === "lane" ? 3 : 1.5}
                  fill={
                    r.tone === "lane"
                      ? "var(--lane-fill)"
                      : r.tone === "danger"
                        ? "var(--cs-color-danger-solid)"
                        : r.tone === "accent"
                          ? "var(--port-on)"
                          : r.tone === "strong"
                            ? "var(--cs-color-text-secondary)"
                            : "var(--cs-color-border-strong)"
                  }
                />
              ))}
              {view !== null && (
                <rect
                  x={(-v.x / v.k) * mk}
                  y={(-v.y / v.k) * mk}
                  width={(box.w / v.k) * mk}
                  height={(box.h / v.k) * mk}
                  rx={2}
                  fill="none"
                  stroke="var(--cs-color-text-primary)"
                  strokeOpacity={0.55}
                  strokeWidth={1}
                />
              )}
            </svg>
          </div>
        )}
        <ZoomControl
          variant="glass"
          size="sm"
          readout="menu"
          value={`${Math.round(v.k * 100)}%`}
          label="맞춤"
          zoomOutLabel="줄이기"
          zoomInLabel="키우기"
          onZoomOut={() => zoomBy(1 / 1.15)}
          onZoomIn={() => zoomBy(1.15)}
          onReadoutClick={() => setView(fit(box))}
        />
      </div>
    </div>
  );
}
