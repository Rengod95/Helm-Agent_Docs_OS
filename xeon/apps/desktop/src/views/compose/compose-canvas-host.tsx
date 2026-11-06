// 흐름 캔버스를 담는 틀(시안 wb-compose `parts/canvas.tsx`의 CanvasHost): 점 격자 바탕 위에 그래프 좌표(width×height)를 폭에 맞춰 줄이고,
// 확대 버튼으로 바꾸면 넘친 만큼 스크롤한다. 줌 캡슐은 caustic ZoomControl을 캔버스 왼쪽 아래에 띄운다.
import { t } from "@fresnel/client/i18n";
import { ZoomControl } from "@caustic/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** 맞춤 배율의 아래 한계(글자가 읽히게). 이보다 줄여야 하면 스크롤한다 */
const MIN_SCALE = 0.6;
const CANVAS_PAD = 32;

export function CanvasHost(props: {
  readonly width: number;
  readonly height: number;
  readonly children: ReactNode;
}): ReactNode {
  const { width, height, children } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const update = (): void => {
      const w = el.clientWidth - CANVAS_PAD * 2;
      const h = el.clientHeight - CANVAS_PAD * 2;
      setFit(Math.max(MIN_SCALE, Math.min(1, w / width, Math.max(h / height, 0.88))));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [width, height]);
  const scale = zoom ?? fit;
  return (
    <div className="relative h-136 min-w-0 rounded-lg [--graph-plate:var(--cs-color-bg-app)]">
      <div
        ref={ref}
        className="absolute inset-0 overflow-auto"
        style={{
          backgroundImage: "radial-gradient(var(--cs-color-canvas-dot) 1px, transparent 1.2px)",
          backgroundSize: "24px 24px",
        }}
      >
        <div
          className="mx-auto"
          style={{
            width: width * scale + CANVAS_PAD * 2,
            height: height * scale + CANVAS_PAD * 2,
            padding: CANVAS_PAD,
          }}
        >
          <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
            {children}
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-4 bottom-4 flex items-end">
        <ZoomControl
          className="pointer-events-auto"
          size="sm"
          value={`${Math.round(scale * 100)}%`}
          label={t("desktop.compose.flow.zoom.label")}
          zoomOutLabel={t("desktop.compose.flow.zoom.out")}
          zoomInLabel={t("desktop.compose.flow.zoom.in")}
          onZoomOut={() => {
            setZoom(Math.max(0.4, scale - 0.1));
          }}
          onZoomIn={() => {
            setZoom(Math.min(1.6, scale + 0.1));
          }}
          onReadoutClick={() => {
            setZoom(null);
          }}
        />
      </div>
    </div>
  );
}
