// 크래프트 캔버스: 지도(Orbit)나 순서(Strata)가 페이지 전체를 채우고, 한 줄 도구 막대·확대·찾기·패널이 그 위에 뜬다.
import { useEffect, useState } from "react";
import { Finder } from "./finder";
import { Lanes } from "./lanes";
import { Orbit } from "./orbit";
import { PANEL_W, RingPanel, SelectionPanel } from "./panels";
import { useMock } from "./store";
import { CanvasBar } from "./toolbars";

const TOP = 64;

export function Canvas() {
  const m = useMock();
  const { view, ring, closeRing } = m;
  const [zoomSlot, setZoomSlot] = useState<HTMLDivElement | null>(null);
  const panelOpen = m.panel && m.sel.k !== "layer";
  const right = panelOpen ? PANEL_W + 24 : 0;
  const ringOpen = ring !== null && view === "orbit";
  // 고리 패널이 열려 있으면 다른 보기로 가도 남지 않게 접는다.
  useEffect(() => {
    if (view !== "orbit") closeRing();
  }, [view, closeRing]);
  return (
    <div className="absolute inset-0 overflow-hidden bg-surface-base">
      {view === "orbit" ? (
        <Orbit
          insets={{ top: TOP, right, bottom: ringOpen ? 196 : 64, left: 0 }}
          zoomSlot={zoomSlot}
        />
      ) : (
        <Lanes rightInset={right} />
      )}
      <CanvasBar />
      <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex items-center gap-2">
        <div ref={setZoomSlot} />
        <Finder />
      </div>
      {ringOpen && <RingPanel right={right === 0 ? 12 : right} />}
      {panelOpen && <SelectionPanel />}
    </div>
  );
}
