// 단일 인스턴스(한 번에 한 창). 두 번째로 켜진 앱은 첫 인스턴스의 창을 앞으로 가져오고 끝난다.
// 잠금과 이벤트 연결은 single-instance-shell.ts가 Electron에 맡긴다. 이 파일은 순서만 정한다.
import type { ShellContext, ShellModule } from "./context.ts";

export interface SingleInstancePorts {
  /** 잠금을 잡는다. 다른 인스턴스가 쥐고 있으면 false */
  requestLock(): boolean;
  /** 두 번째 인스턴스가 켜졌을 때 부른다 */
  onSecondInstance(listener: () => void): void;
  /** macOS 딥 링크(open-url)가 왔을 때 부른다. 기본 처리는 어댑터가 막는다 */
  onOpenUrl(listener: () => void): void;
  exit(code: number): void;
}

export function createSingleInstanceModule(ports: SingleInstancePorts): ShellModule {
  // 잠금은 ready 전에 잡는다(두 번째 실행이 창이나 다른 초기화를 하기 전에 끝나야 한다)
  let held = false;
  return {
    name: "single-instance",
    beforeReady() {
      held = ports.requestLock();
      if (!held) ports.exit(0);
    },
    register(ctx: ShellContext) {
      if (!held) return;
      // 두 번째 실행의 요청은 창을 앞으로 가져오는 것뿐이다. 의도 큐에는 넣지 않는다
      ports.onSecondInstance(() => {
        ctx.showMainWindow();
      });
      // URL 스킴은 아직 없다. 열리는 대상이 없으니 창만 연다
      ports.onOpenUrl(() => {
        ctx.showMainWindow();
      });
    },
  };
}
