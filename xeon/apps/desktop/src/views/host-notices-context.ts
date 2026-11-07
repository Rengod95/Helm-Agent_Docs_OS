import { createContext, useContext, type Context } from "react";
import type { HostNoticesSnapshot } from "./commands.ts";

// 호스트 알림(`host.status`의 `settingsProblems`, F wire §3.3.1). `host-notices-provider.tsx`가 엔진이 running이 되고 연결이 열릴 때 읽어 얹는다.
// 값이 없으면(읽기 전, 읽기 실패) null이고 그때는 아무것도 보이지 않는다. safe-mode-context.ts와 같은 방식이다.

export const HostNoticesContext: Context<HostNoticesSnapshot | null> =
  createContext<HostNoticesSnapshot | null>(null);

export function useHostNotices(): HostNoticesSnapshot | null {
  return useContext(HostNoticesContext);
}
