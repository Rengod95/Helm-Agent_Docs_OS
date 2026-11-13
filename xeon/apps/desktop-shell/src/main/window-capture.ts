// 창 찍기(L4.desktop.spec §11.5, L4.desktop-ux.spec DP-166). 화면 전체 물결이 렌즈 굴절·흐림을 그리려고 부른 창의 보이는 영역을 한 장 찍는다.
// 답은 날 비트맵(BGRA, 장치 px)이다: PNG로 굳히고 renderer에서 다시 푸는 시간(창 하나에 수십 ms)을 아낀다.
// 찍은 그림은 renderer 메모리에만 머물고 파일로 남지 않는다. 웹 탭에는 창이 없어 `unsupported-on-web`으로 거절한다(게이트웨이 표 `hidden`).
// electron 값을 가져오지 않는다. 창은 ctx.windows()에서 찾고 이 파일이 쓰는 면만 `CaptureWindow`로 좁힌다.
import { attemptAsync } from "@fresnel/contracts";
import { ShellError } from "./commands.ts";
import type { IpcCaller, ShellModule } from "./context.ts";

/** `capturePage`가 돌려주는 그림 가운데 쓰는 면. Electron `NativeImage`가 이것을 만족한다 */
export interface CapturedBitmap {
  isEmpty(): boolean;
  getSize(): { readonly width: number; readonly height: number };
  /** 날 픽셀(BGRA 8비트, 위 줄부터) */
  toBitmap(): Uint8Array;
}

/** 이 모듈이 쓰는 창의 면. Electron `BrowserWindow`가 이것을 만족한다 */
export interface CaptureWindow {
  readonly webContents: object & { capturePage(): Promise<CapturedBitmap> };
  isDestroyed(): boolean;
}

/** `window_capture`의 답 */
export interface WindowCapture {
  /** 장치 px */
  readonly width: number;
  readonly height: number;
  readonly format: "bgra";
  readonly bytes: Uint8Array;
}

/** 부른 화면의 창을 찍는다. 웹 탭이면 `unsupported-on-web`, 창이 없으면 `no-window`, 찍지 못하면 `capture-failed`로 던진다 */
export async function captureFor(
  caller: IpcCaller,
  windows: readonly CaptureWindow[],
): Promise<WindowCapture> {
  if ("kind" in caller.sender) throw new ShellError("unsupported-on-web");
  const win = windows.find((candidate) => candidate.webContents === caller.sender);
  if (win === undefined || win.isDestroyed()) throw new ShellError("no-window");
  const captured = await attemptAsync(() => win.webContents.capturePage());
  if (!captured.ok || captured.value.isEmpty()) throw new ShellError("capture-failed");
  const size = captured.value.getSize();
  const bytes = captured.value.toBitmap();
  if (bytes.byteLength !== size.width * size.height * 4) throw new ShellError("capture-failed");
  return { width: size.width, height: size.height, format: "bgra", bytes };
}

export const windowCaptureModule: ShellModule = {
  name: "window-capture",
  register(ctx) {
    ctx.handle("window_capture", (caller) => captureFor(caller, ctx.windows()));
  },
};
