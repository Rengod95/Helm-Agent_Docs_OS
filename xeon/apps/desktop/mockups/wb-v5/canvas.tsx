// 크래프트 캔버스: 지도(Orbit)나 순서(Strata)가 페이지 전체를 채우고, 한 줄 도구 막대·확대·찾기·패널이 그 위에 뜬다.
import { useCallback, useEffect, useRef, useState } from "react";
import { Field } from "./field";
import { Finder } from "./finder";
import { Lanes } from "./lanes";
import { Link } from "./link";
import { Orbit } from "./orbit";
import { PANEL_W, RingPanel, SelectionPanel } from "./panels";
import { useMock } from "./store";
import { CanvasBar } from "./toolbars";
import type { View } from "./viewport";

const TOP = 60;

export function Canvas() {
  const m = useMock();
  const { view, ring, closeRing } = m;
  const [zoomSlot, setZoomSlot] = useState<HTMLDivElement | null>(null);
  // 지도의 이동·배율은 여기서 쥔다: 배경 셰이더가 같은 값을 읽는다. WebGL이 없으면 CSS 그라디언트로 돌아간다.
  const bg = useRef<View>({ k: 1, x: 0, y: 0 });
  const [glOk, setGlOk] = useState(true);
  const noGl = useCallback(() => setGlOk(false), []);
  // 링크 보기는 오른쪽 열이 선택 패널 자리를 쓴다: 패널은 숨기고 상태는 둔다(지도로 돌아가면 그대로).
  const panelOpen = m.panel && m.sel.k !== "layer" && view !== "link";
  const right = panelOpen ? PANEL_W + 24 : 0;
  const ringOpen = ring !== null && view === "orbit";
  // 고리 패널이 열려 있으면 다른 보기로 가도 남지 않게 접는다.
  useEffect(() => {
    if (view !== "orbit") closeRing();
  }, [view, closeRing]);
  return (
    <div
      data-wb5-view={view}
      className={`absolute inset-0 overflow-hidden bg-surface-base ${glOk ? "" : "wb5-paper"}`}
    >
      {glOk && <Field view={bg} onUnavailable={noGl} />}
      {view === "orbit" ? (
        <Orbit
          insets={{ top: TOP, right, bottom: ringOpen ? 196 : 64, left: 0 }}
          zoomSlot={zoomSlot}
          view={bg}
        />
      ) : view === "link" ? (
        <Link rightInset={right} />
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
