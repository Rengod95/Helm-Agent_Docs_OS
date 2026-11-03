// 크래프트 개요 캔버스의 자리. 지도·순서·링크 보기는 T-CANVAS가 `register`로 채우고, 비어 있으면 층 목록이 대신 보인다.
// 보기는 상태를 props로 받지 않고 `useWorkbench`·`useWorkbenchActions`로 읽는다(`packages/client/src/workbench/README.md`).
import type { WorkbenchView } from "@fresnel/client/workbench";
import { Bug } from "@fresnel/contracts";
import type { ReactNode } from "react";

export interface CanvasSlots {
  /** 같은 보기를 두 번 등록하면 `Bug`다 */
  register(view: WorkbenchView, render: () => ReactNode): void;
  render(view: WorkbenchView): ReactNode | null;
}

export function createCanvasSlots(): CanvasSlots {
  const views = new Map<WorkbenchView, () => ReactNode>();
  return {
    register(view, render) {
      if (views.has(view)) throw new Bug(`canvas view registered twice: ${view}`);
      views.set(view, render);
    },
    render: (view) => views.get(view)?.() ?? null,
  };
}
