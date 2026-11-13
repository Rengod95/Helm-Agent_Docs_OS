import { describe, expect, test } from "bun:test";
import type { IpcCaller } from "../src/main/context.ts";
import {
  captureFor,
  windowCaptureModule,
  type CapturedBitmap,
  type CaptureWindow,
} from "../src/main/window-capture.ts";
import { createFakeContext } from "./fake-context.ts";

function bitmap(
  width: number,
  height: number,
  bytes = new Uint8Array(width * height * 4),
): CapturedBitmap {
  return {
    isEmpty: () => width === 0 || height === 0,
    getSize: () => ({ width, height }),
    toBitmap: () => bytes,
  };
}

/** 창 하나와 그 창의 화면이 부른 것으로 보이는 발신자 */
function windowOf(
  capture: () => Promise<CapturedBitmap>,
  destroyed = false,
): { readonly win: CaptureWindow; readonly caller: IpcCaller } {
  const caller: IpcCaller = { sender: Object.create(null) };
  const webContents = Object.assign(caller.sender, { capturePage: capture });
  return { win: { webContents, isDestroyed: () => destroyed }, caller };
}

async function rejection(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => "resolved",
    (cause: unknown) => (cause instanceof Error && "payload" in cause ? cause.payload : cause),
  );
}

describe("captureFor", () => {
  test("부른 화면의 창을 찍어 장치 px 크기와 BGRA 바이트를 돌려준다", async () => {
    const pixels = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
    const other = windowOf(() => Promise.resolve(bitmap(9, 9)));
    const mine = windowOf(() => Promise.resolve(bitmap(2, 1, pixels)));
    expect(await captureFor(mine.caller, [other.win, mine.win])).toEqual({
      width: 2,
      height: 1,
      format: "bgra",
      bytes: pixels,
    });
  });

  test("웹 탭은 찍을 창이 없다", async () => {
    const caller: IpcCaller = { sender: { kind: "web-tab" } };
    expect(await rejection(captureFor(caller, []))).toBe("unsupported-on-web");
  });

  test("창을 못 찾거나 닫혔으면 no-window", async () => {
    const open = windowOf(() => Promise.resolve(bitmap(1, 1)));
    const closed = windowOf(() => Promise.resolve(bitmap(1, 1)), true);
    expect(await rejection(captureFor(open.caller, []))).toBe("no-window");
    expect(await rejection(captureFor(closed.caller, [closed.win]))).toBe("no-window");
  });

  test("찍기가 던지거나 빈 그림이거나 바이트 수가 크기와 맞지 않으면 capture-failed", async () => {
    const failing = windowOf(() => Promise.reject(new Error("gpu lost")));
    const empty = windowOf(() => Promise.resolve(bitmap(0, 0)));
    const short = windowOf(() => Promise.resolve(bitmap(2, 2, new Uint8Array(4))));
    const outcomes = await Promise.all(
      [failing, empty, short].map((one) => rejection(captureFor(one.caller, [one.win]))),
    );
    expect(outcomes).toEqual(["capture-failed", "capture-failed", "capture-failed"]);
  });
});

test("모듈은 window_capture 하나를 등록한다", async () => {
  const fake = createFakeContext();
  windowCaptureModule.register(fake.ctx);
  // 가짜 문맥에는 창이 없다
  expect(await fake.dispatch("window_capture", undefined)).toEqual({
    ok: false,
    error: "no-window",
  });
  expect(await fake.dispatch("window_capture_x", undefined)).toEqual({
    ok: false,
    error: "unknown-command",
  });
});
