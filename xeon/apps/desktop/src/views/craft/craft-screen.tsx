// 크래프트 개요 화면. 지도·순서·링크 세 보기와 자세히 보기를 `CraftSource` 하나로 읽는다.
// 데이터 연결(T-BENCH)이 오기 전에는 source가 없고, 화면은 빈 상태를 그린다.
import { CENTER, type View } from "@fresnel/client/workbench/canvas";
import { EmptyState } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { useRef, type ReactNode } from "react";
import { CraftProvider, useCraft, type CraftSource } from "./craft-context.tsx";
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

function CraftBody(): ReactNode {
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

export function CraftScreen(props: { readonly source: CraftSource | null }): ReactNode {
  if (props.source === null) {
    return (
      <EmptyState
        size="md"
        surface="none"
        title={t("desktop.craft.screen.noSourceTitle")}
        description={t("desktop.craft.screen.noSourceBody")}
      />
    );
  }
  return (
    <CraftProvider source={props.source}>
      <CraftBody />
    </CraftProvider>
  );
}
