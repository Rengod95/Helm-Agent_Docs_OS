import { createContext, useContext, type Context } from "react";
import type { AppearancePort } from "./appearance-prefs.ts";
import type { OsNotifier } from "./os-notify.ts";
import type { NotifyPrefsPort } from "./os-notify-prefs.ts";
import type { SubscribeShellIntent } from "./shell-intents.ts";

// 데스크톱 셸 다리(B-10)를 트리 안으로 내린다. 데스크톱 진입점(`main.tsx`)이 만들어 준다.
// 문맥이 없으면 null이고 트레이 다리, 알림 다리, 설정 패널은 아무것도 그리지 않는다(웹 등). update-context.ts와 같은 방식이다.

/** 셸 명령을 부르는 invoke. 트레이와 의도 다리가 좁은 모양으로 받는다 */
type DesktopInvoke = (
  command: string,
  args?: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

export interface DesktopShell {
  readonly invoke: DesktopInvoke;
  readonly subscribeIntent: SubscribeShellIntent;
  readonly notifier: OsNotifier;
  readonly prefs: NotifyPrefsPort;
  /** 움직임 줄이기와 확대(설정 "외관"의 접근성 묶음) */
  readonly appearance: AppearancePort;
}

export const DesktopShellContext: Context<DesktopShell | null> = createContext<DesktopShell | null>(
  null,
);

export function useDesktopShell(): DesktopShell | null {
  return useContext(DesktopShellContext);
}
