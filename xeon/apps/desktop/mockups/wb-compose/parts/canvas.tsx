// 캔버스 호스트: 투명한 가운데 위에 점 격자만 깐다(바탕색 없음). 세로 레일은 두지 않는다(옛 언어 이식, 가로 경계선은 rail.tsx). 그래프 좌표(width×height)를
// 폭에 맞춰 줄이고(맞춤), 확대 버튼으로 바꾸면 넘친 만큼 스크롤한다. 줌 캡슐은 caustic ZoomControl을 캔버스 왼쪽 아래에 띄운다.
// 구성 편집 캔버스이고 런타임 지도가 아니다(지도 보기·미니맵은 쓰지 않는다).
// caustic 빈틈: 캔버스 호스트(맞춤 배율, 팬, 줌 상태)가 없다. canvas-artboard·zoom-control은 부품만 준다.
import { SectionHeader, ZoomControl } from "@caustic/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function CanvasHost({
  width,
  height,
  children,
  minScale = 0.55,
  minFitHeight = 0.88,
  pad = 32,
}: {
  width: number;
  height: number;
  children: ReactNode;
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
          backgroundSize: "24px 24px",
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
      <div className="pointer-events-none absolute inset-x-4 bottom-4 flex items-end">
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
      </div>
    </div>
  );
}

/** 캔버스 열 머리: caustic SectionHeader(text-title-3). 층 코드·개수는 쓰지 않는다. 캔버스 좌표 안에 놓는다. */
export function ColumnHead({ title }: { title: ReactNode }) {
  return <SectionHeader size="sm" headingLevel={3} title={title} />;
}

const TITLE = "[&_[data-slot=node-graph-node-title]]:text-title-3";

/**
 * 캔버스 블록 겉모양: caustic GraphNode 기본(옛 언어 outline = 면 + 1px 테두리 + 높이 1, 반지름 lg)을 그대로 쓴다.
 * 고른 블록의 고리(selected)와 실패·실행 상태는 GraphNode의 props가 그린다. 여기서는 간격과 제목 글자만 준다.
 * 제목은 text-title-3, 본문 글은 자식 쪽에서 준다.
 */
export function blockClass({
  flat = true,
}: {
  /** 쌓기 열 안(부모 grid가 위치를 정함). false면 GraphNode x·y 절대 위치. */
  flat?: boolean;
} = {}) {
  return `${flat ? "relative top-0 left-0" : ""} gap-1.5 px-3 py-2.5 ${TITLE}`;
}
