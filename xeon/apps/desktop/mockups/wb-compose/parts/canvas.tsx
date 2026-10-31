// 캔버스 호스트: 투명한 가운데(DP-01) 위에 점 격자만 깐다(바탕색 없음). 그래프 좌표(width×height)를 폭에 맞춰 줄이고
// (맞춤), 확대 버튼으로 바꾸면 넘친 만큼 스크롤한다. 줌 캡슐은 caustic ZoomControl(glass)을 캔버스 왼쪽 아래에 띄운다.
// caustic 빈틈: 캔버스 호스트(맞춤 배율, 팬, 줌 상태)가 없다. canvas-artboard·zoom-control은 부품만 준다.
import { ZoomControl } from "@caustic/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function CanvasHost({
  width,
  height,
  children,
  overlay,
  minScale = 0.55,
  minFitHeight = 0.88,
  pad = 24,
}: {
  width: number;
  height: number;
  children: ReactNode;
  /** 캔버스 위에 뜨는 것(줌 옆, Alert 등). 캔버스 좌표가 아니라 화면 좌표. */
  overlay?: ReactNode;
  minScale?: number;
  /** 높이 맞춤은 이 배율 밑으로 줄이지 않고 세로로 스크롤한다(글자가 읽히게). */
  minFitHeight?: number;
  pad?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const update = () => {
      const w = el.clientWidth - pad * 2;
      const h = el.clientHeight - pad * 2;
      setFit(Math.max(minScale, Math.min(1, w / width, Math.max(h / height, minFitHeight))));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height, minScale, minFitHeight, pad]);
  const s = zoom ?? fit;
  return (
    <div className="relative min-h-0 flex-1 [--graph-plate:var(--cs-color-bg-app)]">
      <div
        ref={ref}
        className="absolute inset-0 overflow-auto"
        style={{
          backgroundImage: "radial-gradient(var(--cs-color-canvas-dot) 1px, transparent 1.2px)",
          backgroundSize: "20px 20px",
        }}
      >
        <div
          className="mx-auto"
          style={{ width: width * s + pad * 2, height: height * s + pad * 2, padding: pad }}
        >
          <div style={{ width, height, transform: `scale(${s})`, transformOrigin: "0 0" }}>
            {children}
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end gap-2">
        <ZoomControl
          className="pointer-events-auto"
          size="sm"
          value={`${Math.round(s * 100)}%`}
          label="캔버스 배율"
          zoomOutLabel="줄이기"
          zoomInLabel="키우기"
          onZoomOut={() => setZoom(Math.max(0.4, s - 0.1))}
          onZoomIn={() => setZoom(Math.min(1.6, s + 0.1))}
          onReadoutClick={() => setZoom(null)}
        />
        {overlay}
      </div>
    </div>
  );
}

/** 열 머리: 층 mono 열 + 이름(DP-31). 캔버스 좌표 안에 놓는다. */
export function BandLabel({ layer, children }: { layer: string; children: ReactNode }) {
  return (
    <div className="flex h-5 items-baseline gap-1.5 text-ui-xs text-text-tertiary">
      <span className="font-mono text-mono-sm text-text-secondary">{layer}</span>
      <span>{children}</span>
    </div>
  );
}
