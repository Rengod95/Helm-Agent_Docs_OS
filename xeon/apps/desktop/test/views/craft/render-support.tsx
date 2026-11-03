// 크래프트 그리기 시험의 공용 도구. 캔버스 훅은 워크벤치 스토어를 읽으므로 모든 그리기 시험이 스토어 provider 안에서 그린다.
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import {
  createWorkbenchStore,
  WorkbenchStoreContext,
  type WorkbenchStore,
} from "../../../src/state/workbench/index.ts";

/** 스토어 provider로 감싼다. 시작 상태는 `createWorkbenchStore(start)`로 넣는다 */
export function inStore(ui: ReactNode, store: WorkbenchStore = createWorkbenchStore()): ReactNode {
  return <WorkbenchStoreContext value={store}>{ui}</WorkbenchStoreContext>;
}

/**
 * 서버 그리기 동안만 window를 흉내 낸다. 배경 셰이더의 프레임 고리는 첫 그리기 때 움직임 설정을 읽는다.
 * 실제 창에서는 있는 값이고, 시험 뒤에는 지워서 다른 시험 파일에 남지 않게 한다.
 */
const STUB_WINDOW = {
  devicePixelRatio: 1,
  matchMedia: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }),
};

export function renderWithWindowStub(ui: ReactNode): string {
  Object.defineProperty(globalThis, "window", {
    value: STUB_WINDOW,
    configurable: true,
    writable: true,
  });
  try {
    return renderToString(<>{ui}</>);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
}
