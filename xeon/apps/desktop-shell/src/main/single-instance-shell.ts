// 단일 인스턴스의 Electron 어댑터. 잠금은 Electron 것이라 이 앱의 userData 폴더 기준이다.
// 순서와 시험은 single-instance.ts와 test/single-instance.test.ts에 있다.
import { app } from "electron";
import type { ShellModule } from "./context.ts";
import { createSingleInstanceModule } from "./single-instance.ts";

export const singleInstanceShellModule: ShellModule = createSingleInstanceModule({
  requestLock: () => app.requestSingleInstanceLock(),
  onSecondInstance: (listener) => {
    app.on("second-instance", () => {
      listener();
    });
  },
  onOpenUrl: (listener) => {
    app.on("open-url", (event) => {
      // 기본 처리를 막고 창만 연다(URL 스킴은 아직 없다)
      event.preventDefault();
      listener();
    });
  },
  exit: (code) => {
    app.exit(code);
  },
});
