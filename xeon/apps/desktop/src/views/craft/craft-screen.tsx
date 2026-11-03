// 크래프트 개요의 캔버스 본문: 지도·순서·링크 세 보기와 자세히 보기. 목록 띠와 원천 연결은 `views/workbench/craft-screen.tsx`가 맡는다.
// `CraftProvider` 안에서만 그린다.
import { CENTER, type View } from "@fresnel/client/workbench/canvas";
import { useRef, type ReactNode } from "react";
import { useCraft } from "./craft-context.tsx";
import { Detail } from "./detail.tsx";
import { LinkView } from "./link.tsx";
import { Orbit, useCraftTheme } from "./orbit.tsx";
import { SpaceBackground } from "./space-bg.tsx";
import { Strata } from "./strata.tsx";
import { CraftToolbar } from "./toolbar.tsx";

/** 순서·링크 뒤에 깔리는 배경. 지도처럼 움직이지 않으므로 시점은 고정이다 */
const STILL_VIEW: View = { k: 1, x: CENTER, y: CENTER };

function FlatBackdrop(): ReactNode {
  const view = useRef<View>(STILL_VIEW);
  return <SpaceBackground view={view} theme={useCraftTheme()} />;
}

export function CraftBody(): ReactNode {
  const { state } = useCraft();
  if (state.detail !== null) {
    return (
      <div className="relative flex h-full min-h-0 flex-1 flex-col">
        <Detail />
      </div>
    );
  }
  return (
    <div className="relative h-full min-h-0 flex-1 overflow-hidden" data-craft-mode={state.mode}>
      {state.mode === "orbit" ? (
        <Orbit />
      ) : (
        <>
          <FlatBackdrop />
          {state.mode === "strata" ? <Strata /> : <LinkView />}
        </>
      )}
      <CraftToolbar />
    </div>
  );
}
