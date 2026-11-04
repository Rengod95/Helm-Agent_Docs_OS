// 크래프트 개요(`overview`, P-16). 캔버스(지도·순서·링크)가 화면 전체를 쓰고, 도구 막대·찾기·층 패널·선택 패널·자세히 보기는 캔버스의 떠 있는 판이다.
// 이 파일은 목록 읽기 상태 띠(읽는 중·오류·오프라인)를 위에 두고, 목록이 읽힌 뒤에만 캔버스를 그리며 원천을 잇는다.
// 자동 꺼짐 알림은 위 띠에 두지 않고 고른 플러그인의 카드에 있다(`craft-parts.tsx`의 `ExtNotice`). 그 카드의 답은 여기서 준다.
import { useWorkbench } from "../../state/workbench/index.ts";
import { useMemo, type ReactNode } from "react";
import { CraftProvider } from "../craft/craft-context.tsx";
import { CraftBody } from "../craft/craft-screen.tsx";
import { detachVoid, useWorkbenchController } from "./controller.ts";
import { useCraftSource } from "./craft-source.ts";
import { AutoOffActionsContext, ListStatusBand, useToggleRequest } from "./craft-parts.tsx";

export function CraftScreen(): ReactNode {
  const controller = useWorkbenchController();
  const toggle = useToggleRequest(controller);
  const source = useCraftSource(controller, toggle.request);
  const ready = useWorkbench((s) => s.list === "ready");
  // 자동 꺼짐 알림의 두 답: 다시 켜기(켜 두기)와 끄기(둘 다 컨트롤러가 설정을 쓰고 목록을 다시 읽는다)
  const answers = useMemo(
    () => ({
      keepOn: (name: string) => {
        detachVoid(controller.reenable(name));
      },
      keepOff: (name: string) => {
        detachVoid(controller.keepOff(name));
      },
    }),
    [controller],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ListStatusBand controller={controller} />
      {ready && (
        <AutoOffActionsContext value={answers}>
          <CraftProvider source={source}>
            <CraftBody />
          </CraftProvider>
        </AutoOffActionsContext>
      )}
      {toggle.dialog}
    </div>
  );
}
