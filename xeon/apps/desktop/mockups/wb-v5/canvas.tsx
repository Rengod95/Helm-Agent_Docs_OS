// 크래프트 캔버스: 지도(Orbit)나 순서(Strata)가 페이지 전체를 채우고, 도구·거르기·범례·패널이 그 위에 뜬다. 고른 것은 두 보기가 함께 읽는다.
import { useEffect } from "react";
import { Lanes } from "./lanes";
import { Legend } from "./marks";
import { Orbit } from "./orbit";
import { PANEL_W, RingPanel, SelectionPanel } from "./panels";
import { useMock } from "./store";
import { CanvasToolbar, FilterBar } from "./toolbars";

const TOP = 108;

export function Canvas() {
  const m = useMock();
  const { view, ring, closeRing } = m;
  const panelOpen = m.panel && m.sel.k !== "layer";
  const right = panelOpen ? PANEL_W + 24 : 0;
  const ringOpen = ring !== null && view === "orbit";
  // 고리 패널이 열려 있으면 다른 보기로 가도 남지 않게 접는다.
  useEffect(() => {
    if (view !== "orbit") closeRing();
  }, [view, closeRing]);
  return (
    <div
      className={`absolute inset-0 overflow-hidden ${view === "orbit" ? "wb5-paper" : "bg-surface-base"}`}
    >
      {view === "orbit" ? (
        <Orbit insets={{ top: TOP, right, bottom: ringOpen ? 236 : 64, left: 0 }} />
      ) : (
        <Lanes rightInset={right} />
      )}
      <div className="absolute left-3 top-3 z-20">
        <CanvasToolbar />
      </div>
      <div className="absolute left-3 top-[60px] z-20">
        <FilterBar />
      </div>
      {view === "orbit" && (
        <div className="absolute bottom-3 left-3 z-10">
          <Legend />
        </div>
      )}
      {ringOpen && <RingPanel right={right === 0 ? 12 : right} />}
      {panelOpen && <SelectionPanel />}
    </div>
  );
}
